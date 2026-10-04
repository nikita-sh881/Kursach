import os
import getpass
import psycopg
from pwdlib import PasswordHash

email = input('Admin email: ').strip().lower()
password = getpass.getpass('Admin password (at least 12 characters): ')
if len(password) < 12:
    raise SystemExit('Password is too short')
with psycopg.connect(os.environ['DATABASE_URL']) as c:
    c.execute("INSERT INTO users(email,password_hash,role) VALUES(%s,%s,'admin') ON CONFLICT(email) DO UPDATE SET role='admin',password_hash=EXCLUDED.password_hash,token_version=users.token_version+1", (email, PasswordHash.recommended().hash(password)))
print('Administrator created/updated')
