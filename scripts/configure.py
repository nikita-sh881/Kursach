"""Create local development secrets without printing them or overwriting .env."""
from pathlib import Path
import secrets

target = Path('.env')
text = Path('.env.example').read_text(encoding='utf-8')
for key in ('POSTGRES_PASSWORD', 'SERVICE_DB_PASSWORD', 'JWT_SECRET', 'INTERNAL_TOKEN'):
    lines = text.splitlines()
    text = '\n'.join(key + '=' + secrets.token_hex(32) if line.startswith(key + '=') else line for line in lines) + '\n'
try:
    with target.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)
except FileExistsError:
    raise SystemExit('.env already exists; left unchanged')
print('Created .env with independent random secrets. Keep it private.')
