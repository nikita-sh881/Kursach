#!/bin/sh
set -eu
for name in auth catalog circulation notifications recommendations; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db_password="$SERVICE_DB_PASSWORD" -v db_name="$name" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_name', :'db_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_name') \gexec
SQL
done
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname circulation -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;'
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname recommendations -c 'CREATE EXTENSION IF NOT EXISTS vector;'
