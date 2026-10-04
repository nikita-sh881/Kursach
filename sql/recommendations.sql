CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE embeddings(book_id bigint PRIMARY KEY, document text NOT NULL, embedding vector(384) NOT NULL, model text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX embeddings_hnsw ON embeddings USING hnsw(embedding vector_cosine_ops);
