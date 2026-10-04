"""Security/validation tests that do not require a running database."""
import os
from datetime import datetime, timezone, timedelta

os.environ.setdefault('DATABASE_URL', 'postgresql://unused:unused@localhost/unused')
os.environ.setdefault('JWT_SECRET', 'test-secret-only-12345678901234567890')
os.environ.setdefault('INTERNAL_TOKEN', 'test-internal-secret')

import jwt
import pytest
from fastapi.testclient import TestClient
from app import auth, catalog, circulation, recommendations
from app.common import user

@pytest.fixture
def reader_clients():
    apps = (catalog.app, circulation.app, recommendations.app)
    for a in apps:
        a.dependency_overrides[user] = lambda: {'id': 1, 'email': 'reader@example.com', 'role': 'reader'}
    # Deliberately no context manager: these cases must reject before DB access.
    yield tuple(TestClient(a) for a in apps)
    for a in apps:
        a.dependency_overrides.clear()

def test_registration_requires_valid_email_and_strong_length():
    client = TestClient(auth.app)
    for data in ({'email': 'invalid', 'password': 'long-password-123'}, {'email': 'a@example.com', 'password': 'short'}):
        assert client.post('/auth/register', json=data).status_code == 422

@pytest.mark.parametrize('claim', ['expired', 'audience', 'issuer', 'missing_subject', 'signature'])
def test_invalid_jwt_rejected_before_database(claim):
    t = datetime.now(timezone.utc)
    payload = {'sub': '1', 'ver': 0, 'iat': t, 'exp': t + timedelta(minutes=30), 'aud': 'library', 'iss': 'library-auth'}
    key = os.environ['JWT_SECRET']
    if claim == 'expired':
        payload['exp'] = t - timedelta(minutes=1)
    elif claim == 'audience':
        payload['aud'] = 'another-application'
    elif claim == 'issuer':
        payload['iss'] = 'another-issuer'
    elif claim == 'missing_subject':
        del payload['sub']
    else:
        key = 'wrong-secret-12345678901234567890123'
    token = jwt.encode(payload, key, algorithm='HS256')
    assert TestClient(auth.app).get('/auth/me', headers={'Authorization': 'Bearer ' + token}).status_code == 401

def test_reader_cannot_modify_catalog_or_issue_books(reader_clients):
    cat, circ, ai = reader_clients
    assert cat.post('/catalog/books', json={'title': 'Forbidden'}).status_code == 403
    assert cat.delete('/catalog/books/1').status_code == 403
    assert cat.post('/catalog/authors', json={'name': 'Forbidden'}).status_code == 403
    assert circ.post('/circulation/reservations/1/checkout').status_code == 403
    assert circ.post('/circulation/loans/1/return').status_code == 403
    assert ai.post('/recommendations/reindex').status_code == 403

def test_internal_routes_reject_missing_secret():
    client = TestClient(circulation.app)
    assert client.post('/internal/tick').status_code == 403
    assert client.get('/internal/events').status_code == 403
    assert client.get('/internal/history/1').status_code == 403

@pytest.mark.parametrize('case', ['naive', 'reversed', 'too_long'])
def test_invalid_reservation_intervals(reader_clients, case):
    _, client, _ = reader_clients
    start = datetime.now(timezone.utc) + timedelta(days=1)
    data = {'copy_id': 1, 'starts_at': start.isoformat(), 'ends_at': (start + timedelta(days=7)).isoformat()}
    if case == 'naive':
        data['starts_at'] = start.replace(tzinfo=None).isoformat()
    elif case == 'reversed':
        data['ends_at'] = (start - timedelta(days=1)).isoformat()
    else:
        data['ends_at'] = (start + timedelta(days=61)).isoformat()
    assert client.post('/circulation/reservations', json=data).status_code == 422
