CREATE TABLE users (
 id bigserial PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'reader' CHECK(role IN ('reader','staff','admin')),
 active boolean NOT NULL DEFAULT true, token_version integer NOT NULL DEFAULT 0
);
