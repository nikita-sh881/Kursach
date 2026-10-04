CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE copies(id bigserial PRIMARY KEY, book_id bigint NOT NULL, barcode text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
CREATE TABLE bookings(
 id bigserial PRIMARY KEY, copy_id bigint NOT NULL REFERENCES copies, user_id bigint NOT NULL,
 email text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','loaned','returned','cancelled','expired')),
 returned_at timestamptz, CHECK(ends_at>starts_at),
 EXCLUDE USING gist(copy_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('reserved','loaned'))
);
CREATE UNIQUE INDEX one_open_loan ON bookings(copy_id) WHERE status='loaned';
CREATE INDEX bookings_due ON bookings(ends_at) WHERE status IN ('reserved','loaned');
CREATE TABLE outbox(id bigserial PRIMARY KEY, event_key text UNIQUE NOT NULL, email text NOT NULL, subject text NOT NULL, body text NOT NULL, delivered_at timestamptz);
