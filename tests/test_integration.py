"""Run only on an isolated test stack: fixtures write real service databases."""
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import httpx
import psycopg
import pytest

AUTH = 'http://auth:8000'
CAT = 'http://catalog:8000'
CIRC = 'http://circulation:8000'
AI = 'http://recommendations:8000'
PASSWORD = 'Reader-password-123!'
INTERNAL = {'X-Internal-Token': os.environ['INTERNAL_TOKEN']}

def request(method, base, path, token=None, **kw):
    headers = kw.pop('headers', {})
    if token:
        headers['Authorization'] = 'Bearer ' + token
    return httpx.request(method, base + path, headers=headers, timeout=300, **kw)

def login(email):
    r = request('POST', AUTH, '/auth/login', json={'email': email, 'password': PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()['access_token']

@pytest.fixture(scope='session')
def accounts():
    result = {}
    for role in ('reader', 'other', 'staff', 'admin'):
        email = f'{role}-{uuid.uuid4().hex}@example.com'
        r = request('POST', AUTH, '/auth/register', json={'email': email, 'password': PASSWORD})
        assert r.status_code == 201, r.text
        assert r.json()['role'] == 'reader'
        uid = r.json()['id']
        if role in ('staff', 'admin'):
            with psycopg.connect(os.environ['AUTH_DATABASE_URL']) as c:
                c.execute('UPDATE users SET role=%s WHERE id=%s', (role, uid))
        result[role] = {'id': uid, 'email': email, 'token': login(email)}
    return result

@pytest.fixture
def copy(accounts):
    t = accounts['staff']['token']
    r = request('POST', CAT, '/catalog/books', t, json={'title': 'Космос ' + uuid.uuid4().hex, 'description': 'Научная фантастика о путешествии к звездам'})
    assert r.status_code == 201, r.text
    book = r.json()
    r = request('POST', CIRC, '/circulation/copies', t, json={'book_id': book['id'], 'barcode': uuid.uuid4().hex})
    assert r.status_code == 201, r.text
    return r.json()

def interval(copy, minutes=0, days=7):
    start = datetime.now(timezone.utc) + timedelta(minutes=minutes, seconds=1)
    return {'copy_id': copy['id'], 'starts_at': start.isoformat(), 'ends_at': (start + timedelta(days=days)).isoformat()}

def reserve(copy, accounts, data=None):
    r = request('POST', CIRC, '/circulation/reservations', accounts['reader']['token'], json=data or interval(copy))
    assert r.status_code == 201, r.text
    return r.json()

def ready(bid):
    # Advance fixture state without waiting days; all production operations use HTTP.
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        c.execute("UPDATE bookings SET starts_at=now()-interval '1 minute' WHERE id=%s", (bid,))

def test_rbac_and_invalid_credentials(accounts):
    assert request('GET', CAT, '/catalog/books').status_code == 200
    assert request('POST', CAT, '/catalog/books', json={'title': 'Forbidden'}).status_code in (401, 403)
    assert request('POST', CAT, '/catalog/books', accounts['reader']['token'], json={'title': 'Forbidden'}).status_code == 403
    assert request('GET', AUTH, '/auth/users', accounts['staff']['token']).status_code == 403
    assert request('GET', AUTH, '/auth/users', accounts['admin']['token']).status_code == 200
    assert request('GET', AUTH, '/auth/me', 'invalid').status_code == 401
    assert request('POST', AUTH, '/auth/login', json={'email': accounts['reader']['email'], 'password': 'wrong-password-123'}).status_code == 401
    assert request('POST', AUTH, '/auth/register', json={'email': accounts['reader']['email'], 'password': PASSWORD}).status_code == 409
    assert request('POST', CIRC, '/internal/tick').status_code == 403

def test_catalog_crud(accounts):
    t = accounts['staff']['token']
    aid = request('POST', CAT, '/catalog/authors', t, json={'name': uuid.uuid4().hex}).json()['id']
    gid = request('POST', CAT, '/catalog/genres', t, json={'name': uuid.uuid4().hex}).json()['id']
    data = {'title': 'Test', 'author_ids': [aid], 'genre_ids': [gid]}
    b = request('POST', CAT, '/catalog/books', t, json=data).json()
    assert b['authors'][0]['id'] == aid
    assert request('DELETE', CAT, f'/catalog/authors/{aid}', t).status_code == 409
    data['title'] = 'Updated'
    assert request('PUT', CAT, f"/catalog/books/{b['id']}", t, json=data).json()['title'] == 'Updated'
    assert request('PUT', CAT, f'/catalog/genres/{gid}', t, json={'name': uuid.uuid4().hex}).status_code == 200
    assert request('DELETE', CAT, f"/catalog/books/{b['id']}", t).status_code == 204
    assert request('GET', CAT, f"/catalog/books/{b['id']}").status_code == 404

def test_simultaneous_reservations(copy, accounts):
    data = interval(copy, minutes=10)
    def submit(_):
        return request('POST', CIRC, '/circulation/reservations', accounts['reader']['token'], json=data).status_code
    with ThreadPoolExecutor(max_workers=8) as executor:
        statuses = list(executor.map(submit, range(8)))
    assert statuses.count(201) == 1, statuses
    assert statuses.count(409) == 7, statuses

def test_adjacent_intervals_and_cancellation(copy, accounts):
    data = interval(copy, minutes=10)
    first = reserve(copy, accounts, data)
    second_data = {'copy_id': copy['id'], 'starts_at': data['ends_at'], 'ends_at': (datetime.fromisoformat(data['ends_at']) + timedelta(days=1)).isoformat()}
    reserve(copy, accounts, second_data)
    assert request('POST', CIRC, f"/circulation/reservations/{first['id']}/cancel", accounts['other']['token']).status_code == 403
    assert request('POST', CIRC, f"/circulation/reservations/{first['id']}/cancel", accounts['reader']['token']).status_code == 200
    reserve(copy, accounts, data)

def test_checkout_return_and_ready_notification(copy, accounts):
    b = reserve(copy, accounts)
    bid = b['id']
    assert request('POST', CIRC, f'/circulation/reservations/{bid}/checkout', accounts['reader']['token']).status_code == 403
    ready(bid)
    assert request('POST', CIRC, '/internal/tick', headers=INTERNAL).status_code == 200
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        assert c.execute('SELECT count(*) FROM outbox WHERE event_key=%s', (f'ready:{bid}',)).fetchone()[0] == 1
    assert request('POST', CIRC, f'/circulation/reservations/{bid}/checkout', accounts['staff']['token']).json()['status'] == 'loaned'
    assert request('POST', CIRC, f'/circulation/reservations/{bid}/checkout', accounts['staff']['token']).status_code == 409
    assert request('POST', CIRC, f'/circulation/loans/{bid}/return', accounts['staff']['token']).json()['status'] == 'returned'
    assert request('POST', CIRC, f'/circulation/loans/{bid}/return', accounts['staff']['token']).status_code == 409

def test_overdue_blocks_checkout_and_sends_email(copy, accounts):
    b = reserve(copy, accounts)
    ready(b['id'])
    assert request('POST', CIRC, f"/circulation/reservations/{b['id']}/checkout", accounts['staff']['token']).status_code == 200
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        c.execute("UPDATE bookings SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=%s", (b['id'],))
    assert request('POST', CIRC, '/circulation/reservations', accounts['reader']['token'], json=interval(copy)).status_code == 409
    request('POST', CIRC, '/internal/tick', headers=INTERNAL)
    request('POST', CIRC, '/internal/tick', headers=INTERNAL)
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        assert c.execute('SELECT count(*) FROM outbox WHERE event_key=%s', (f"overdue:{b['id']}",)).fetchone()[0] == 1
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        r = httpx.get('http://mailpit:8025/api/v1/messages', timeout=10)
        r.raise_for_status()
        messages = r.json()['messages']
        if any(m['Subject'] == 'Срок возврата истек' and any(a['Address'] == accounts['reader']['email'] for a in m['To']) for m in messages):
            break
        time.sleep(2)
    else:
        pytest.fail('Overdue notification did not arrive in Mailpit within 90 seconds')
    assert request('POST', CIRC, f"/circulation/loans/{b['id']}/return", accounts['staff']['token']).status_code == 200

def test_validation(copy, accounts):
    data = interval(copy)
    data['ends_at'] = data['starts_at']
    assert request('POST', CIRC, '/circulation/reservations', accounts['reader']['token'], json=data).status_code == 422

def test_database_constraint_prevents_direct_overlap(copy, accounts):
    b = reserve(copy, accounts, interval(copy, minutes=10))
    with pytest.raises(psycopg.errors.ExclusionViolation):
        with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
            c.execute('INSERT INTO bookings(copy_id,user_id,email,starts_at,ends_at) VALUES(%s,%s,%s,%s,%s)', (copy['id'], accounts['other']['id'], accounts['other']['email'], b['starts_at'], b['ends_at']))

def test_expired_reservation_releases_copy(copy, accounts):
    b = reserve(copy, accounts)
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        c.execute("UPDATE bookings SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=%s", (b['id'],))
    request('POST', CIRC, '/internal/tick', headers=INTERNAL)
    assert request('POST', CIRC, f"/circulation/reservations/{b['id']}/checkout", accounts['staff']['token']).status_code == 409
    reserve(copy, accounts)
    with psycopg.connect(os.environ['CIRCULATION_DATABASE_URL']) as c:
        assert c.execute('SELECT status FROM bookings WHERE id=%s', (b['id'],)).fetchone()[0] == 'expired'
    data = interval(copy)
    data['starts_at'] = '2026-01-01T00:00:00' # naive time prohibited
    assert request('POST', CIRC, '/circulation/reservations', accounts['reader']['token'], json=data).status_code == 422

def test_logout_revokes_tokens():
    email = uuid.uuid4().hex + '@example.com'
    assert request('POST', AUTH, '/auth/register', json={'email': email, 'password': PASSWORD}).status_code == 201
    token = login(email)
    assert request('POST', AUTH, '/auth/logout', token).status_code == 204
    assert request('GET', AUTH, '/auth/me', token).status_code == 401

@pytest.mark.skipif(os.getenv('RUN_AI_TESTS') != 'true', reason='Set RUN_AI_TESTS=true; downloads actual neural model')
def test_real_neural_search(copy, accounts):
    r = request('POST', AI, '/recommendations/reindex', accounts['staff']['token'])
    assert r.status_code == 200, r.text
    assert r.json()['indexed'] > 0
    r = request('POST', AI, '/recommendations/search', json={'query': 'путешествие в космос'})
    assert r.status_code == 200, r.text
    assert r.json()
    assert all(-1.01 <= x['score'] <= 1.01 for x in r.json())
    r = request('GET', AI, '/recommendations/me?interests=space', accounts['other']['token'])
    assert r.status_code == 200, r.text
    assert r.json()['basis'] == 'interests'
    assert r.json()['items']
    assert all(isinstance(x['score'], (int, float)) for x in r.json()['items'])
