import os
from datetime import timedelta
import jwt
from pwdlib import PasswordHash
from fastapi import Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from psycopg.errors import UniqueViolation
from app.common import application, pool, bearer, now

app = application('Identity service')
hasher = PasswordHash.recommended()
class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
class Role(BaseModel):
    role: str = Field(pattern='^(reader|staff|admin)$')
class UserState(BaseModel):
    active: bool

def current(token=Depends(bearer)):
    try:
        p = jwt.decode(token.credentials, os.environ['JWT_SECRET'], algorithms=['HS256'], audience='library', issuer='library-auth', options={'require': ['sub', 'exp', 'iat', 'ver']})
        with pool.connection() as c:
            u = c.execute('SELECT id,email,role,active,token_version FROM users WHERE id=%s', (int(p['sub']),)).fetchone()
        if not u or not u['active'] or u['token_version'] != p['ver']:
            raise ValueError()
        return u
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, 'Invalid or expired token')

@app.post('/auth/register', status_code=201)
def register(data: Credentials):
    try:
        with pool.connection() as c:
            return c.execute("INSERT INTO users(email,password_hash) VALUES (%s,%s) RETURNING id,email,role", (str(data.email).lower(), hasher.hash(data.password))).fetchone()
    except UniqueViolation:
        raise HTTPException(409, 'Email already registered')

@app.post('/auth/login')
def login(data: Credentials):
    with pool.connection() as c:
        u = c.execute('SELECT * FROM users WHERE email=%s', (str(data.email).lower(),)).fetchone()
    if not u or not u['active'] or not hasher.verify(data.password, u['password_hash']):
        raise HTTPException(401, 'Invalid credentials')
    t = now()
    return {'access_token': jwt.encode({'sub': str(u['id']), 'ver': u['token_version'], 'iat': t, 'exp': t + timedelta(minutes=30), 'aud': 'library', 'iss': 'library-auth'}, os.environ['JWT_SECRET'], algorithm='HS256'), 'token_type': 'bearer', 'expires_in': 1800}

@app.get('/auth/me')
def me(u=Depends(current)):
    return {k: u[k] for k in ('id', 'email', 'role')}

@app.post('/auth/logout', status_code=204)
def logout(u=Depends(current)):
    with pool.connection() as c:
        c.execute('UPDATE users SET token_version=token_version+1 WHERE id=%s', (u['id'],))

def admin(u=Depends(current)):
    if u['role'] != 'admin':
        raise HTTPException(403, 'Administrator required')
    return u

@app.get('/auth/users', dependencies=[Depends(admin)])
def users():
    with pool.connection() as c:
        return c.execute('SELECT id,email,role,active FROM users ORDER BY id LIMIT 500').fetchall()

@app.patch('/auth/users/{uid}/role', dependencies=[Depends(admin)])
def change_role(uid: int, data: Role):
    with pool.connection() as c:
        c.execute('SELECT pg_advisory_xact_lock(123456)')
        target = c.execute('SELECT role FROM users WHERE id=%s FOR UPDATE', (uid,)).fetchone()
        if not target:
            raise HTTPException(404, 'User not found')
        if target['role'] == 'admin' and data.role != 'admin' and c.execute("SELECT count(*) n FROM users WHERE role='admin' AND active").fetchone()['n'] <= 1:
            raise HTTPException(409, 'Cannot remove the last administrator')
        return c.execute('UPDATE users SET role=%s,token_version=token_version+1 WHERE id=%s RETURNING id,email,role', (data.role, uid)).fetchone()

@app.patch('/auth/users/{uid}/state', dependencies=[Depends(admin)])
def change_state(uid: int, data: UserState):
    with pool.connection() as c:
        c.execute('SELECT pg_advisory_xact_lock(123456)')
        target = c.execute('SELECT role,active FROM users WHERE id=%s FOR UPDATE', (uid,)).fetchone()
        if not target:
            raise HTTPException(404, 'User not found')
        if target['active'] and target['role'] == 'admin' and not data.active and c.execute("SELECT count(*) n FROM users WHERE role='admin' AND active").fetchone()['n'] <= 1:
            raise HTTPException(409, 'Cannot disable the last administrator')
        return c.execute('UPDATE users SET active=%s,token_version=token_version+1 WHERE id=%s RETURNING id,email,role,active', (data.active, uid)).fetchone()
