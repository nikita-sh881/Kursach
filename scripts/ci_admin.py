"""Create a public-known test admin only inside an isolated CI stack."""
import os
import psycopg
from pwdlib import PasswordHash

if os.getenv('ALLOW_CI_ADMIN') != 'true':
    raise SystemExit('Set ALLOW_CI_ADMIN=true only on an isolated test stack')
with psycopg.connect(os.environ['DATABASE_URL']) as c:
    c.execute("INSERT INTO users(email,password_hash,role) VALUES(%s,%s,'admin') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin',active=true,token_version=users.token_version+1", ('ci-admin@example.com', PasswordHash.recommended().hash('Ci-only-password-123!')))
print('Isolated CI administrator ready')
