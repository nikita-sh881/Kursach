CREATE TABLE authors(id bigserial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE genres(id bigserial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE books(id bigserial PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '', isbn text UNIQUE, active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1);
CREATE TABLE book_authors(book_id bigint REFERENCES books ON DELETE CASCADE, author_id bigint REFERENCES authors, PRIMARY KEY(book_id,author_id));
CREATE TABLE book_genres(book_id bigint REFERENCES books ON DELETE CASCADE, genre_id bigint REFERENCES genres, PRIMARY KEY(book_id,genre_id));
