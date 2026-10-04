import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

pool = ConnectionPool(os.environ['DATABASE_URL'], kwargs={'row_factory': dict_row}, open=False)
bearer = HTTPBearer()

@asynccontextmanager
async def lifespan(app):
    pool.open(wait=True)
    yield
    pool.close()

def application(name):
    app = FastAPI(title=name, lifespan=lifespan)
    @app.get('/health')
    def health():
        with pool.connection() as c:
            c.execute('SELECT 1')
        return {'status': 'ok'}
    return app

def user(token=Depends(bearer)):
    try:
        r = httpx.get(os.getenv('AUTH_URL', 'http://auth:8000') + '/auth/me', headers={'Authorization': 'Bearer ' + token.credentials}, timeout=5)
        if r.status_code == 401:
            raise HTTPException(401, 'Invalid or expired token')
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError:
        raise HTTPException(503, 'Authentication service unavailable')

def roles(*allowed):
    def check(u=Depends(user)):
        if u['role'] not in allowed:
            raise HTTPException(403, 'Insufficient permissions')
        return u
    return check

staff = roles('staff', 'admin')
def now():
    return datetime.now(timezone.utc)

def require_internal(value):
    import secrets
    if not value or not secrets.compare_digest(value, os.environ['INTERNAL_TOKEN']):
        raise HTTPException(403, 'Internal access required')
