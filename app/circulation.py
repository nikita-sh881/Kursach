import os
from datetime import datetime, timedelta
import httpx
from fastapi import Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field, AwareDatetime, model_validator
from psycopg.errors import IntegrityError
from app.common import application, pool, staff, user, now, require_internal

app = application('Circulation service')
@app.get('/internal/history/{uid}')
def history(uid: int, x_internal_token: str = Header(default='')):
    require_internal(x_internal_token)
    with pool.connection() as c:
        rows = c.execute("SELECT DISTINCT c.book_id FROM bookings b JOIN copies c ON c.id=b.copy_id WHERE b.user_id=%s AND b.status IN ('loaned','returned')", (uid,)).fetchall()
        return {'book_ids': [r['book_id'] for r in rows]}

class Copy(BaseModel):
    book_id: int = Field(gt=0)
    barcode: str = Field(min_length=1, max_length=100)
class Reservation(BaseModel):
    copy_id: int = Field(gt=0)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    @model_validator(mode='after')
    def interval(self):
        if self.ends_at <= self.starts_at or self.ends_at - self.starts_at > timedelta(days=60):
            raise ValueError('Interval must be positive and at most 60 days')
        return self

def catalog(bid):
    try:
        r = httpx.get(os.getenv('CATALOG_URL', 'http://catalog:8000') + f'/internal/books/{bid}', headers={'X-Internal-Token': os.environ['INTERNAL_TOKEN']}, timeout=5)
        if r.status_code == 404:
            raise HTTPException(404, 'Book not found')
        r.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(503, 'Catalog unavailable')

def event(c, key, email, subject, body):
    c.execute('INSERT INTO outbox(event_key,email,subject,body) VALUES(%s,%s,%s,%s) ON CONFLICT(event_key) DO NOTHING', (key, email, subject, body))

def expire(c):
    rows = c.execute("UPDATE bookings SET status='expired' WHERE status='reserved' AND ends_at<=now() RETURNING *").fetchall()
    for b in rows:
        event(c, f"expired:{b['id']}", b['email'], 'Бронирование истекло', f"Срок бронирования №{b['id']} истек.")

@app.post('/circulation/copies', status_code=201, dependencies=[Depends(staff)])
def add_copy(data: Copy):
    catalog(data.book_id)
    try:
        with pool.connection() as c:
            return c.execute('INSERT INTO copies(book_id,barcode) VALUES(%s,%s) RETURNING *', (data.book_id, data.barcode)).fetchone()
    except IntegrityError:
        raise HTTPException(409, 'Barcode already exists')

@app.delete('/circulation/copies/{cid}', status_code=204, dependencies=[Depends(staff)])
def retire_copy(cid: int):
    with pool.connection() as c:
        if not c.execute('SELECT id FROM copies WHERE id=%s AND active FOR UPDATE', (cid,)).fetchone():
            raise HTTPException(404, 'Copy not found')
        expire(c)
        if c.execute("SELECT id FROM bookings WHERE copy_id=%s AND status IN ('reserved','loaned') LIMIT 1", (cid,)).fetchone():
            raise HTTPException(409, 'Copy has active bookings or loans')
        c.execute('UPDATE copies SET active=false WHERE id=%s', (cid,))

@app.get('/circulation/copies')
def copies(book_id: int, starts_at: AwareDatetime, ends_at: AwareDatetime):
    if ends_at <= starts_at:
        raise HTTPException(422, 'Invalid interval')
    with pool.connection() as c:
        return c.execute("SELECT c.*, NOT EXISTS(SELECT 1 FROM bookings b WHERE b.copy_id=c.id AND ((b.status IN ('reserved','loaned') AND tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(%s,%s,'[)')) OR (b.status='loaned' AND b.ends_at<=now()))) AS available FROM copies c WHERE book_id=%s AND active ORDER BY id", (starts_at, ends_at, book_id)).fetchall()

@app.post('/circulation/reservations', status_code=201)
def reserve(data: Reservation, u=Depends(user)):
    if data.starts_at < now() - timedelta(seconds=5):
        raise HTTPException(422, 'Reservation must start in the future')
    try:
        with pool.connection() as c:
            cp = c.execute('SELECT * FROM copies WHERE id=%s AND active FOR UPDATE', (data.copy_id,)).fetchone()
            if not cp:
                raise HTTPException(404, 'Copy not found')
            catalog(cp['book_id'])
            expire(c)
            if c.execute("SELECT id FROM bookings WHERE copy_id=%s AND status='loaned' AND ends_at<=now()", (data.copy_id,)).fetchone():
                raise HTTPException(409, 'Copy is overdue and not yet returned')
            return c.execute('INSERT INTO bookings(copy_id,user_id,email,starts_at,ends_at) VALUES(%s,%s,%s,%s,%s) RETURNING *', (data.copy_id, u['id'], u['email'], data.starts_at, data.ends_at)).fetchone()
    except IntegrityError:
        raise HTTPException(409, 'Copy already reserved during this interval')

@app.get('/circulation/reservations')
def reservations(u=Depends(user), limit: int = Query(100, ge=1, le=500)):
    with pool.connection() as c:
        return c.execute('SELECT b.*,c.book_id,c.barcode FROM bookings b JOIN copies c ON c.id=b.copy_id WHERE user_id=%s ORDER BY b.id DESC LIMIT %s', (u['id'], limit)).fetchall()

@app.get('/circulation/bookings', dependencies=[Depends(staff)])
def all_bookings(limit: int = Query(100, ge=1, le=500)):
    with pool.connection() as c:
        return c.execute('SELECT b.*,c.book_id,c.barcode FROM bookings b JOIN copies c ON c.id=b.copy_id ORDER BY b.id DESC LIMIT %s', (limit,)).fetchall()

def locked(c, bid):
    row = c.execute('SELECT copy_id FROM bookings WHERE id=%s', (bid,)).fetchone()
    if not row:
        raise HTTPException(404, 'Booking not found')
    c.execute('SELECT id FROM copies WHERE id=%s FOR UPDATE', (row['copy_id'],))
    return c.execute('SELECT * FROM bookings WHERE id=%s FOR UPDATE', (bid,)).fetchone()

@app.post('/circulation/reservations/{bid}/cancel')
def cancel(bid: int, u=Depends(user)):
    with pool.connection() as c:
        b = locked(c, bid)
        if b['user_id'] != u['id'] and u['role'] not in ('staff', 'admin'):
            raise HTTPException(403, 'Not your reservation')
        if b['status'] != 'reserved':
            raise HTTPException(409, 'Only reserved bookings can be cancelled')
        return c.execute("UPDATE bookings SET status='cancelled' WHERE id=%s RETURNING *", (bid,)).fetchone()

@app.post('/circulation/reservations/{bid}/checkout', dependencies=[Depends(staff)])
def checkout(bid: int):
    try:
        with pool.connection() as c:
            b = locked(c, bid)
            if b['status'] != 'reserved' or not b['starts_at'] <= now() < b['ends_at']:
                raise HTTPException(409, 'Booking is not ready for checkout')
            if c.execute("SELECT id FROM bookings WHERE copy_id=%s AND status='loaned'", (b['copy_id'],)).fetchone():
                raise HTTPException(409, 'Previous reader has not returned the copy')
            result = c.execute("UPDATE bookings SET status='loaned' WHERE id=%s RETURNING *", (bid,)).fetchone()
            event(c, f'checkout:{bid}', b['email'], 'Книга выдана', f"Верните экземпляр №{b['copy_id']} до {b['ends_at'].isoformat()}.")
            return result
    except IntegrityError:
        raise HTTPException(409, 'Copy already on loan')

@app.post('/circulation/loans/{bid}/return', dependencies=[Depends(staff)])
def return_book(bid: int):
    with pool.connection() as c:
        b = locked(c, bid)
        if b['status'] != 'loaned':
            raise HTTPException(409, 'Booking is not an active loan')
        result = c.execute("UPDATE bookings SET status='returned',returned_at=now() WHERE id=%s RETURNING *", (bid,)).fetchone()
        event(c, f'return:{bid}', b['email'], 'Книга возвращена', f"Возврат экземпляра №{b['copy_id']} зарегистрирован.")
        return result

@app.post('/internal/tick')
def tick(x_internal_token: str = Header(default='')):
    require_internal(x_internal_token)
    with pool.connection() as c:
        c.execute('SELECT pg_advisory_xact_lock(234567)')
        expire(c)
        rows = c.execute("SELECT b.* FROM bookings b WHERE (b.status='reserved' AND b.starts_at<=now() AND b.ends_at>now() AND NOT EXISTS(SELECT 1 FROM bookings l WHERE l.copy_id=b.copy_id AND l.status='loaned')) OR (b.status='loaned' AND b.ends_at<=now())").fetchall()
        for b in rows:
            ready = b['status'] == 'reserved'
            event(c, f"{'ready' if ready else 'overdue'}:{b['id']}", b['email'], 'Наступило время бронирования' if ready else 'Срок возврата истек', f"Бронирование №{b['id']}, экземпляр №{b['copy_id']}. " + ('Можно получить книгу.' if ready else 'Пожалуйста, верните книгу.'))
    return {'processed': len(rows)}

@app.get('/internal/events')
def pending(x_internal_token: str = Header(default='')):
    require_internal(x_internal_token)
    with pool.connection() as c:
        return c.execute('SELECT * FROM outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 100').fetchall()

@app.post('/internal/events/{eid}/ack', status_code=204)
def ack(eid: int, x_internal_token: str = Header(default='')):
    require_internal(x_internal_token)
    with pool.connection() as c:
        c.execute('UPDATE outbox SET delivered_at=now() WHERE id=%s', (eid,))
