import os
from pathlib import Path
import psycopg

for service in ('auth', 'catalog', 'circulation', 'notifications', 'recommendations'):
    with psycopg.connect(os.environ[service.upper() + '_DATABASE_URL']) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
        conn.execute('SELECT pg_advisory_xact_lock(456789)')
        for path in sorted(Path('sql').glob(service + '*.sql')):
            if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=%s', (path.name,)).fetchone():
                conn.execute(path.read_text(encoding='utf-8'))
                conn.execute('INSERT INTO schema_migrations(version) VALUES(%s)', (path.name,))
                print('Applied', path.name)
