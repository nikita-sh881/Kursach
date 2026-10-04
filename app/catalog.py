from typing import Literal
from fastapi import Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field
from psycopg.errors import IntegrityError
from app.common import application, pool, staff, require_internal

app = application('Catalog service')
class Name(BaseModel):
    name: str = Field(min_length=1, max_length=200)
class Book(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default='', max_length=20000)
    isbn: str | None = Field(default=None, max_length=32)
    author_ids: list[int] = Field(default_factory=list, max_length=100)
    genre_ids: list[int] = Field(default_factory=list, max_length=100)

def book(c, bid):
    b = c.execute('SELECT * FROM books WHERE id=%s AND active', (bid,)).fetchone()
    if not b:
        raise HTTPException(404, 'Book not found')
    for kind in ('authors', 'genres'):
        singular = kind[:-1]
        b[kind] = c.execute(f'SELECT x.id,x.name FROM {kind} x JOIN book_{kind} j ON j.{singular}_id=x.id WHERE j.book_id=%s', (bid,)).fetchall()
    return b

@app.get('/catalog/books')
def books(q: str = '', offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), genre_id: int | None = Query(None, gt=0)):
    with pool.connection() as c:
        ids = c.execute('SELECT id FROM books WHERE active AND title ILIKE %s AND (%s::bigint IS NULL OR EXISTS(SELECT 1 FROM book_genres bg WHERE bg.book_id=books.id AND bg.genre_id=%s)) ORDER BY id LIMIT %s OFFSET %s', ('%' + q + '%', genre_id, genre_id, limit, offset)).fetchall()
        return [book(c, x['id']) for x in ids]

@app.get('/catalog/books/{bid}')
def get_book(bid: int):
    with pool.connection() as c:
        return book(c, bid)

@app.get('/internal/books/{bid}')
def internal_book(bid: int, x_internal_token: str = Header(default='')):
    require_internal(x_internal_token)
    return get_book(bid)

def save(bid, data):
    try:
        with pool.connection() as c:
            if bid is None:
                bid = c.execute('INSERT INTO books(title,description,isbn) VALUES(%s,%s,%s) RETURNING id', (data.title, data.description, data.isbn)).fetchone()['id']
            else:
                if not c.execute('UPDATE books SET title=%s,description=%s,isbn=%s,revision=revision+1 WHERE id=%s AND active RETURNING id', (data.title, data.description, data.isbn, bid)).fetchone():
                    raise HTTPException(404, 'Book not found')
            for kind, ids in [('authors', data.author_ids), ('genres', data.genre_ids)]:
                c.execute(f'DELETE FROM book_{kind} WHERE book_id=%s', (bid,))
                for item in set(ids):
                    c.execute(f'INSERT INTO book_{kind}(book_id,{kind[:-1]}_id) VALUES(%s,%s)', (bid, item))
            return book(c, bid)
    except IntegrityError:
        raise HTTPException(409, 'Duplicate ISBN or invalid author/genre')

@app.post('/catalog/books', status_code=201, dependencies=[Depends(staff)])
def create_book(data: Book):
    return save(None, data)
@app.put('/catalog/books/{bid}', dependencies=[Depends(staff)])
def update_book(bid: int, data: Book):
    return save(bid, data)
@app.delete('/catalog/books/{bid}', status_code=204, dependencies=[Depends(staff)])
def delete_book(bid: int):
    with pool.connection() as c:
        if not c.execute('UPDATE books SET active=false,revision=revision+1 WHERE id=%s AND active RETURNING id', (bid,)).fetchone():
            raise HTTPException(404, 'Book not found')

@app.get('/catalog/{kind}')
def names(kind: Literal['authors', 'genres']):
    with pool.connection() as c:
        return c.execute(f'SELECT * FROM {kind} ORDER BY id').fetchall()
@app.post('/catalog/{kind}', status_code=201, dependencies=[Depends(staff)])
def create_name(kind: Literal['authors', 'genres'], data: Name):
    try:
        with pool.connection() as c:
            return c.execute(f'INSERT INTO {kind}(name) VALUES(%s) RETURNING *', (data.name,)).fetchone()
    except IntegrityError:
        raise HTTPException(409, 'Name already exists')
@app.put('/catalog/{kind}/{item}', dependencies=[Depends(staff)])
def update_name(kind: Literal['authors', 'genres'], item: int, data: Name):
    try:
        with pool.connection() as c:
            row = c.execute(f'UPDATE {kind} SET name=%s WHERE id=%s RETURNING *', (data.name, item)).fetchone()
            if not row:
                raise HTTPException(404, 'Not found')
            return row
    except IntegrityError:
        raise HTTPException(409, 'Name already exists')
@app.delete('/catalog/{kind}/{item}', status_code=204, dependencies=[Depends(staff)])
def delete_name(kind: Literal['authors', 'genres'], item: int):
    try:
        with pool.connection() as c:
            if not c.execute(f'DELETE FROM {kind} WHERE id=%s RETURNING id', (item,)).fetchone():
                raise HTTPException(404, 'Not found')
    except IntegrityError:
        raise HTTPException(409, 'Author/genre is used by a book')
