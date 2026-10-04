import os
from functools import lru_cache
import httpx
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.common import application, pool, staff, user

app = application('Neural recommendations service')
MODEL = os.getenv('EMBEDDING_MODEL', 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')

@lru_cache
def encoder():
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL, device=os.getenv('AI_DEVICE', 'cpu'))
    if model.get_sentence_embedding_dimension() != 384:
        raise RuntimeError('Model dimension must be 384; migrate DB before switching models')
    return model

def vector(text):
    return '[' + ','.join(map(str, encoder().encode(text, normalize_embeddings=True).tolist())) + ']'

def fetch_books():
    base = os.getenv('CATALOG_URL', 'http://catalog:8000')
    result = []
    with httpx.Client(timeout=20) as client:
        offset = 0
        while True:
            r = client.get(base + '/catalog/books', params={'offset': offset, 'limit': 100})
            r.raise_for_status()
            rows = r.json()
            result.extend(rows)
            if len(rows) < 100:
                return result
            offset += 100

def search(text, limit, excluded=None):
    try:
        live = {b['id']: b for b in fetch_books()}
    except httpx.HTTPError:
        raise HTTPException(503, 'Catalog unavailable')
    ids = list(set(live) - set(excluded or []))
    if not ids:
        return []
    with pool.connection() as c:
        if not c.execute('SELECT 1 FROM embeddings WHERE model=%s AND book_id=ANY(%s) LIMIT 1', (MODEL, ids)).fetchone():
            raise HTTPException(503, 'Neural index is not ready; ask staff to reindex the catalog')
    embedding = vector(text)
    with pool.connection() as c:
        rows = c.execute('SELECT book_id,1-(embedding <=> %s::vector) AS score FROM embeddings WHERE model=%s AND book_id=ANY(%s) ORDER BY embedding <=> %s::vector LIMIT %s', (embedding, MODEL, ids, embedding, limit)).fetchall()
    return [{'book': live[r['book_id']], 'score': r['score']} for r in rows]

class Search(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=10, ge=1, le=50)

@app.get('/recommendations/status')
def index_status():
    with pool.connection() as c:
        count = c.execute('SELECT count(*) AS n FROM embeddings WHERE model=%s', (MODEL,)).fetchone()['n']
    return {'indexed': count, 'ready': count > 0, 'model': MODEL}

@app.post('/recommendations/search')
def semantic_search(data: Search):
    return search(data.query, data.limit)

@app.post('/recommendations/reindex', dependencies=[Depends(staff)])
def reindex():
    try:
        books = fetch_books()
    except httpx.HTTPError:
        raise HTTPException(503, 'Catalog unavailable')
    rows = []
    for b in books:
        text = ' '.join([b['title'], b['description']] + [x['name'] for x in b['authors'] + b['genres']])
        rows.append((b['id'], text, vector(text), MODEL))
    with pool.connection() as c:
        c.execute('SELECT pg_advisory_xact_lock(345678)')
        c.execute('DELETE FROM embeddings')
        for row in rows:
            c.execute('INSERT INTO embeddings(book_id,document,embedding,model) VALUES(%s,%s,%s::vector,%s)', row)
    return {'indexed': len(rows), 'model': MODEL}

@app.get('/recommendations/me')
def personal(limit: int = Query(10, ge=1, le=50), interests: str = Query('', max_length=4000), u=Depends(user)):
    try:
        r = httpx.get(os.getenv('CIRCULATION_URL', 'http://circulation:8000') + '/internal/history/' + str(u['id']), headers={'X-Internal-Token': os.environ['INTERNAL_TOKEN']}, timeout=10)
        r.raise_for_status()
        ids = r.json()['book_ids']
        live = {b['id']: b for b in fetch_books()}
    except httpx.HTTPError:
        raise HTTPException(503, 'Dependent service unavailable')
    texts = [live[i]['title'] + ' ' + live[i]['description'] for i in ids if i in live]
    # Every result, including a new reader's results, goes through the neural encoder.
    query = ' '.join(texts)[-10000:]
    if interests.strip():
        query = interests.strip() + ' ' + query
    if not query:
        query = 'Увлекательная литература, истории о людях, открытиях и приключениях'
    basis = 'reading_history' if texts else ('interests' if interests.strip() else 'neural_discovery')
    return {'basis': basis, 'items': search(query, limit, ids)}
