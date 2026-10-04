"""Import and generate every OpenAPI schema without contacting databases."""
import importlib
import os

os.environ.setdefault('DATABASE_URL', 'postgresql://unused:unused@localhost/unused')
os.environ.setdefault('JWT_SECRET', 'check-only-never-use-this-secret-in-production')
os.environ.setdefault('INTERNAL_TOKEN', 'check-only')
for service in ('auth', 'catalog', 'circulation', 'recommendations'):
    module = importlib.import_module('app.' + service)
    schema = module.app.openapi()
    print(service, len(schema['paths']), 'paths; schema OK')
from app.auth import hasher
password = 'Check-password-123!'
assert hasher.verify(password, hasher.hash(password))
print('Argon2 hash/verify OK')
