# Docdesk — document chat

Upload a PDF, TXT or Markdown file and ask questions about it. Answers stream
back grounded in the document, cite the section and lines they came from, and
carry a structured component — a table, timeline, key figures, checklist or
evidence cards — when the answer's shape calls for one.

The conversation lives in Postgres, so a reload restores it.

---

## Run it

Prerequisites: **Node 20.12+** (22 LTS recommended) and **pnpm 11**
(`corepack enable`). You also need a Postgres database with pgvector and a way
to reach a chat model — both covered in [SETUP.md](./SETUP.md).

```bash
cp .env.example .env.local     # then fill in DATABASE_URL — see SETUP.md for the rest
pnpm install
pnpm migrate                   # create the schema: documents · chunks · embeddings · chats · messages
pnpm dev                       # http://localhost:3000
```

The first upload downloads the embedding weights (~35 MB, one time) and takes
about 15 seconds longer than later ones; after that the model stays warm in
the process.

### Database scripts

| Command | What it does |
| --- | --- |
| `pnpm migrate` | Apply every pending migration in `db/migrations/`, in order. Idempotent — a second run is a no-op. |
| `pnpm migrate:status` | List which migrations are applied and which are pending. |
| `pnpm db:reset -- --yes` | Drop every table in the `public` schema. Add `--truncate` to keep the schema and only delete rows. |
| `pnpm db:reset:migrate` | Drop everything and rebuild from migrations in one step. |

The runner prefers `DATABASE_URL_UNPOOLED` (a direct connection for DDL) and
falls back to `DATABASE_URL`.

**Full walkthrough** — local Postgres via Docker, the LM Studio local-model
option, and deploying to Vercel: **[SETUP.md](./SETUP.md).**

---

## How it works

**Indexing.** The file is extracted server-side (`unpdf` for PDF, UTF-8 read
for text), split on its own section boundaries with overlap, embedded, and
written to Postgres. Every chunk records the section and the page or line
range it came from — while the text is still next to its source.

Progress is streamed as newline-delimited JSON, so the five stages in the
right pane report work that actually happened rather than a timer.

**Answering.** The question is embedded with the same model, matched against
pgvector by cosine distance, and the surviving chunks are passed to the model
as numbered sources. The prose streams. When it finishes, a second, cheaper
call picks at most one structured component for it.

## Citations cannot be wrong about where they came from

The model never writes a location. It sees sources numbered `[1]`, `[2]` and
can only reference those numbers; the filename, section, line range and
excerpt are all read back from the chunk row. A marker pointing outside the
retrieved set is dropped rather than rendered.

This is the difference between a citation and a plausible-looking citation.
Asked to write "page 14", a model will write something whether or not it is
true.

## Not finding an answer is an answer

`SIMILARITY_THRESHOLD` (default `0.72`) is a floor, and it was measured rather
than guessed. gte-small scores 0.685–0.781 even for questions the document has
nothing to say about, and 0.836–0.897 for ones it does. A naive low threshold
like `0.3` would make the "no passage above threshold" state unreachable and
every off-topic question would get a confident answer assembled from unrelated
passages.

Below the floor the app returns a normal answer saying so — no citations, no
component, no apology.

## Structured components

Five, as a discriminated union in `src/lib/structured.ts`: comparison table,
timeline, key figures, checklist, evidence cards. The model picks at most one.

The schema is validated on the server before anything is stored, and **again**
in the browser before rendering — a payload can equally arrive from the
database, where a row written by an older build may carry a shape this one no
longer understands. Anything that fails validation renders as plain prose,
which is always correct.

Checklist ticks and expanded evidence cards are the user's own state, so they
persist per message rather than resetting on reload.

## Stack

TypeScript · Next.js 16 App Router · React 19 · AI SDK v7 through the Vercel
AI Gateway · Postgres + pgvector · Transformers.js for embeddings.

Embeddings are free and local: `Supabase/gte-small`, 384-dimensional, running
in-process. No embedding API, no per-token cost. The dimension is mirrored in
`EMBEDDING_DIMENSIONS` and the `vector(384)` column, and the two must move
together.

Deploys on Vercel Hobby and Neon's free tier.

## Layout

```
db/migrations/0001_init.sql             documents · chunks · embeddings · chats · messages
db/migrations/0002_system_messages.sql  widen messages.role to allow 'system'
scripts/migrate.mjs                     migration runner (pnpm migrate / migrate:status)
scripts/db-reset.mjs                    drop or truncate every table (pnpm db:reset)
src/lib/                                config, db, extraction, chunking, embeddings,
                                        retrieval, prompting, schemas, repository
src/app/api/                            documents (index) · chat (RAG) · session
                                        (restore) · messages/ui-state · messages/system
src/components/                         the UI, and structured/ for the five components
public/sample/                          a real sample document, indexed through the
                                        same pipeline as an upload
```

## Architecture & data model

One Next.js 16 App Router process on the Node runtime. No worker, no queue, no
separate vector service — everything is the app plus one Postgres database.

**Request flow**

```
Upload (multipart)                        Ask a question
  │                                         │
  ▼  POST /api/documents                    ▼  POST /api/chat
  extract  (unpdf / UTF-8)                  embed question (gte-small, in-process)
  chunk    (section boundaries + overlap)   pgvector cosine search  (HNSW, <=>)
  embed    (gte-small, in-process)          similarity gates  (abs 0.72 · rel 0.1)
  store    documents · chunks · embeddings  stream prose  (CHAT_MODEL via AI Gateway)
  │  progress streamed as NDJSON            annotate  (ANNOTATION_MODEL: citations
  ▼                                         │           + ≤1 structured component)
  documents.status = ready                  ▼  resolve citations from chunk rows
                                            persist message (structured · citations
                                            · retrieval · ui_state) → chats/messages
```

`src/lib/` holds the pipeline (`extract` · `chunk` · `embeddings` · `retrieval`
· `answer` · `structured` · `errors` · `repository` · `db` · `config`); the
five API routes under `src/app/api/` are thin wrappers over it. Embeddings run
through Transformers.js in the same process — no network call, no key.

### Database schema

Five tables (`db/migrations/0001_init.sql`, `0002_system_messages.sql`).
Everything cascades from `documents` on delete.

| Table | Grain | Notable columns |
| --- | --- | --- |
| `documents` | one per upload | `kind` (`pdf`/`txt`/`md`), `status` (`parsing`→`ready`/`failed`), `page_count` **or** `line_count`, denormalised `chunk_count`, `error_message` |
| `chunks` | one per chunk | `ordinal`, `section_ordinal` / `section_label`, `page` or `line_start` / `line_end`, `token_count`, `text`; `UNIQUE (document_id, ordinal)`. The location columns are what make a citation nameable — recorded at chunk time, never invented by the model. |
| `embeddings` | one per chunk (PK = `chunk_id`) | `vector(384)`, `model`, denormalised `document_id` so top-k filters without a join. HNSW index on `vector_cosine_ops`; vectors are L2-normalised, so cosine similarity = `1 - (a <=> b)`. |
| `chats` | one per document (`document_id` UNIQUE) | Loading a chat by `document_id` is what restores the whole conversation on reload. |
| `messages` | one per turn | `seq` (identity) orders replay — not `created_at`, which collides at ms resolution. `role` ∈ `user`/`assistant`/`note`/`system`. `structured` jsonb (validated component or NULL), `citations` jsonb (resolved, carrying filename/section/lines), `retrieval` jsonb (chunk count, score range, threshold flag), `ui_state` jsonb (per-message user state — checklist ticks, expanded evidence cards). |

`vector(384)` must equal `EMBEDDING_DIMENSIONS` in `src/lib/config.ts`; the two
move together and changing them means re-indexing every document. `pnpm
migrate` applies `db/migrations/` in order and records each file in a
`schema_migrations` table.

## Design

The interface follows the Industry design system in
`design_handoff_document_chat/`: square corners, hairline borders, no filled
card surfaces, `+` registration marks on every framed object, and one solid
accent fill — the send button. Tokens are ported into `src/app/globals.css`
and consumed as CSS custom properties.

## Key trade-offs

- **Local embeddings, not an embedding API.** `Supabase/gte-small` runs
  in-process: zero cost, offline after one ~35 MB download, no key, no
  per-token billing. The price is a cold first request, 384-d vectors (less
  expressive than large hosted models), and a high similarity floor that had
  to be measured. For a tool where the corpus is a single document, the
  quality ceiling is fine and the operational simplicity wins.
- **Postgres + pgvector as the only store.** Documents, chunks, vectors and
  the whole conversation live in one database with one migration path and one
  connection. No dedicated vector DB to run. HNSW on Neon's free tier is
  comfortably fast at this scale; a million-chunk corpus would force a rethink.
- **Node runtime, not Edge.** Keeps a real `pg` pool, lets Transformers.js
  load its native ONNX binary, and allows 300 s streaming durations — at the
  cost of the sub-50 ms cold starts Edge would give.
- **Two model calls per answer.** Prose streams from `CHAT_MODEL`; a second,
  cheaper `ANNOTATION_MODEL` call then picks citations and at most one
  structured component. Simpler streaming and isolated failure modes, for one
  extra round-trip of latency.
- **Structured output validated twice, prose as the floor.** Every component
  payload is schema-checked on the server and again in the browser; anything
  that fails renders as plain prose. Cheaper than making the pipeline
  bulletproof, and plain prose is never wrong.
- **Citations resolved from chunk rows, never written by the model.** The
  model only ever references source numbers; filename, section and line range
  are read back from the row. Removes a whole class of confident-but-wrong
  location strings, at the cost of never citing outside the retrieved set.
- **Synchronous indexing inside the request.** Upload blocks until the
  document is parsed, chunked, embedded and stored, with progress streamed as
  NDJSON. No job queue to operate; a very large PDF can approach the 300 s
  ceiling.

## Build notes

**Time spent:** ~4–6 hours.

**AI tools used:** Claude Code (Anthropic's agentic CLI) for essentially all
of the implementation — schema, RAG pipeline, API routes, React components,
and this README. Its configuration lives in the repo as `AGENTS.md`,
`CLAUDE.md` and `.claude/`. Design tokens came from the
`design_handoff_document_chat/` handoff and were wired in by hand.

**One correction of AI output — the similarity threshold.** Asked for a
retrieval filter, the model reached for a low cosine cutoff (~0.2–0.3), on the
usual assumption that similarity scores spread across the full 0–1 range. With
`Supabase/gte-small` that assumption is false. Measuring against the bundled
sample: questions the document cannot answer ("What is the capital of Peru?")
still score **0.685–0.781**, while genuinely on-topic questions score
**0.836–0.897** at the top chunk. A 0.3 floor sits below every real score, so
the "no passage above threshold" branch — the entire mechanism that lets the
app say *this document doesn't cover that* — becomes dead code, and every
off-topic question gets a confident answer stitched from unrelated passages.
I rejected the generated value, set `SIMILARITY_THRESHOLD` to a measured
`0.72` (just above the off-topic band), documented the score ranges beside it
in `src/lib/config.ts`, and made it an environment variable so a different
embedding model can be retuned without a code change. See
[Not finding an answer is an answer](#not-finding-an-answer-is-an-answer).

## Not done yet

Known gaps, roughly in priority order:
- **Context Aware Suggestions** currently the suggestion are static for intro and followup
- **Architectural decomposition and separation of concerns**
- **Solidify validation and guardrails.** The structured-output pipeline currently relies too heavily on model compliance. The classifier and component builder need stricter schema validation and explicit guardrails at each boundary: validate the classifier output against the allowed component types, validate every builder payload against its component schema, reject unsupported or malformed fields, enforce source/chunk provenance for evidence cards, prevent unsupported values or hallucinated data from entering structured components, and fall back safely to the original plain-prose answer whenever validation fails. Validation should happen both before and after model output is processed so malformed model responses never reach the client.
- **Test scripts.** There is no `pnpm test`, no test files and no CI. The parts that most want coverage: the two-sided schema validation and plain-prose fallback in `src/lib/structured.ts`, citation resolution and the "marker outside the retrieved set is dropped" rule in `src/lib/retrieval.ts`, chunking on section boundaries in `src/lib/chunk.ts`, and `src/lib/errors.ts` — the rate-limit / 5xx / 4xx classifier and the guarantee that no raw provider text reaches the client. Tests should also cover the new validation/guardrail rules, including malformed classifier output, invalid component payloads, unsupported fields, missing required fields, invalid `chunkId` values, unsupported evidence, and fallback behavior.
- **In-app rate limiting.** Every route is open. The error copy speaks of a per-agent request limit, but enforcement lives upstream at the AI Gateway, not in this app.
- **Retry/backoff on transient model errors.** A rate-limited or dropped answer surfaces an error card immediately; there is no automatic retry.
- **Observability.** Failures are `console.error` only — no structured logs, no error reporting sink.