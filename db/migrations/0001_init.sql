-- Document Chat — initial schema (Neon Postgres + pgvector).
--
-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f db/migrations/0001_init.sql
--
-- The vector width below (384) MUST match EMBEDDING_DIMENSIONS in
-- src/lib/config.ts. It is the native width of Supabase/gte-small, the
-- Transformers.js model we embed with. Changing one without the other
-- makes every insert fail.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            text        PRIMARY KEY,
  filename      text        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('pdf', 'txt', 'md')),
  mime_type     text        NOT NULL,
  size_bytes    integer     NOT NULL CHECK (size_bytes >= 0),
  -- page_count is set for PDFs, line_count for TXT/MD. The other stays NULL.
  page_count    integer,
  line_count    integer,
  -- Denormalised for the "N chunks indexed" copy the UI shows everywhere.
  chunk_count   integer     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'parsing'
                            CHECK (status IN ('parsing', 'ready', 'failed')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_created_at_idx
  ON documents (created_at DESC);

-- ---------------------------------------------------------------------------
-- chunks
--
-- section_label / line_start / line_end / page are what make a citation
-- nameable ("report.md · §3 Engagement by format · L44-52"). They are
-- recorded at chunk time; the model never invents them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  id              text    PRIMARY KEY,
  document_id     text    NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  ordinal         integer NOT NULL,
  section_ordinal integer NOT NULL,
  section_label   text    NOT NULL,
  page            integer,
  line_start      integer,
  line_end        integer,
  token_count     integer NOT NULL CHECK (token_count >= 0),
  text            text    NOT NULL,
  UNIQUE (document_id, ordinal)
);

CREATE INDEX IF NOT EXISTS chunks_document_ordinal_idx
  ON chunks (document_id, ordinal);

-- ---------------------------------------------------------------------------
-- embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id    text        PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
  -- Denormalised so top-k can filter by document without joining chunks.
  document_id text        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  embedding   vector(384) NOT NULL,
  model       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- HNSW over cosine distance. Queries use the `<=>` operator; cosine
-- similarity is 1 - (a <=> b) because we store L2-normalised vectors.
CREATE INDEX IF NOT EXISTS embeddings_embedding_hnsw_idx
  ON embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS embeddings_document_id_idx
  ON embeddings (document_id);

-- ---------------------------------------------------------------------------
-- chats
--
-- One chat per document: loading a chat by document_id is what makes a
-- browser reload restore the whole conversation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chats (
  id          text        PRIMARY KEY,
  document_id text        NOT NULL UNIQUE
                          REFERENCES documents (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- messages
--
--   structured — the validated structured component, or NULL for plain prose
--   citations  — resolved citations (already carrying filename/section/lines)
--   retrieval  — retrieval meta: how many chunks, score range, threshold flag
--   ui_state   — per-message USER state: checklist ticks and expanded
--                evidence cards. Persisted so it survives a reload.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         text        PRIMARY KEY,
  chat_id    text        NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  seq        bigint      GENERATED ALWAYS AS IDENTITY,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant', 'note')),
  content    text        NOT NULL DEFAULT '',
  structured jsonb,
  citations  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  retrieval  jsonb,
  ui_state   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- seq, not created_at: two messages written in the same millisecond still
-- need a stable order when the conversation is replayed.
CREATE INDEX IF NOT EXISTS messages_chat_seq_idx
  ON messages (chat_id, seq);
