-- 13_hermes_kb.sql — Hermes KB semantic retrieval store (pgvector).
--
-- Upgrades the Hermes support/agent KB from hardcoded lexical snippets
-- (lib/hermes/kb-context.ts) to REAL vector retrieval. The indexer
-- (lib/hermes/kb-index.ts, driven by POST /api/bot/kb/reindex) chunks the KB
-- markdown (content/kb/*.md) plus resolved/closed tickets, embeds each chunk,
-- and upserts the rows here. Retrieval (retrieveKbVector) embeds the query and
-- does a cosine top-k over `embedding`.
--
-- Idempotent + additive. Lives in the SAME dedicated `hermes` schema created by
-- 11_hermes_brain.sql (create schema if not exists is repeated here so this file
-- is self-contained and order-independent).
--
-- ─── pgvector PREREQUISITE ────────────────────────────────────────────────────
-- `create extension vector` requires the pgvector extension to be AVAILABLE in
-- the Postgres image AND requires a role with CREATE privilege on the database
-- (superuser, or a role granted rds_superuser / member of the extension owner).
--
--   * When db/init/*.sql runs during first-container-init it executes as the
--     Postgres SUPERUSER, so the extension is created cleanly.
--   * On the LIVE ytdb / Patroni cluster the migrator role may NOT be able to
--     create the extension. If so, a one-time superuser step is required:
--         CREATE EXTENSION IF NOT EXISTS vector;
--     After that, re-running this migration is a no-op for the extension and
--     proceeds to create the table/index.
--
-- The Postgres image must ship pgvector (e.g. `pgvector/pgvector:pg16`, or the
-- `vector` extension installed into a Spilo/Patroni image). If it does not, this
-- migration fails at the first statement — install pgvector on the cluster first.

create schema if not exists hermes;

-- pgvector — see prerequisite note above. Idempotent.
create extension if not exists vector;

-- ─── kb_chunks ────────────────────────────────────────────────────────────────
-- One row per embedded chunk.
--   source        'kb'  → a content/kb/<slug>.md article
--                 'ticket' → a resolved/closed ops.tickets record
--   source_ref    the KB slug (source='kb') or the ticket ref (source='ticket').
--                 Also used as the citation slug the agents surface, so a 'kb'
--                 row resolves to /v2/kb/<source_ref>.
--   title         human title of the parent document (repeated per chunk).
--   chunk_text    the chunk body that gets embedded + injected into the prompt.
--   embedding     vector(1536) — see EMBEDDING MODEL note.
--   content_hash  sha256 of chunk_text; the idempotency key (skip re-embed of
--                 unchanged chunks; stale chunks are pruned by the indexer).
--
-- ─── EMBEDDING MODEL / DIMENSION ─────────────────────────────────────────────
-- Column dimension MUST match the embedding model (lib/hermes/embeddings.ts):
--   text-embedding-3-small → 1536 dims  ← current default (this column: vector(1536))
--   text-embedding-3-large → 3072 dims
-- If you switch to a model with a different dimension you MUST alter this column
-- (drop/recreate is simplest since the store is a derived cache) and re-run the
-- reindex. HERMES_EMBEDDINGS_MODEL / _DIMS document the choice at runtime.
create table if not exists hermes.kb_chunks (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,                 -- 'kb' | 'ticket'
  source_ref   text not null,                 -- kb slug | ticket ref
  title        text not null default '',
  chunk_text   text not null,
  embedding    vector(1536),
  content_hash text not null,
  updated_at   timestamptz not null default now(),
  -- Idempotent upsert key: the same chunk (identical text) for a given document
  -- is stored once. A changed article yields new hashes (new rows); the indexer
  -- prunes the rows whose hash is no longer produced.
  unique (source, source_ref, content_hash)
);

-- Filter helper (prune / per-document reads).
create index if not exists kb_chunks_source_ref_idx
  on hermes.kb_chunks (source, source_ref);

-- Approximate-nearest-neighbour index for cosine similarity retrieval.
-- HNSW (pgvector >= 0.5.0) needs no training step and handles incremental
-- upserts well. If your pgvector is older, swap for ivfflat, e.g.:
--   create index kb_chunks_embedding_ivf on hermes.kb_chunks
--     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
--   -- (ivfflat also needs an ANALYZE after bulk load to be effective)
create index if not exists kb_chunks_embedding_hnsw
  on hermes.kb_chunks using hnsw (embedding vector_cosine_ops);
