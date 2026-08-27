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

`SIMILARITY_THRESHOLD` (default `0.8`) is a floor, and it was measured rather
than guessed. gte-small scores 0.69–0.78 even for questions the document has
nothing to say about, and 0.84–0.90 for ones it does. A naive low threshold
would make the "no passage above threshold" state unreachable and every
off-topic question would get a confident answer assembled from unrelated
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

## Design

The interface follows the Industry design system in
`design_handoff_document_chat/`: square corners, hairline borders, no filled
card surfaces, `+` registration marks on every framed object, and one solid
accent fill — the send button. Tokens are ported into `src/app/globals.css`
and consumed as CSS custom properties.

## Not done yet

Known gaps, roughly in priority order:

- **Test scripts.** There is no `pnpm test`, no test files and no CI. The
  parts that most want coverage: the two-sided schema validation and
  plain-prose fallback in `src/lib/structured.ts`, citation resolution and
  the "marker outside the retrieved set is dropped" rule in
  `src/lib/retrieval.ts`, chunking on section boundaries in
  `src/lib/chunk.ts`, and `src/lib/errors.ts` — the rate-limit / 5xx / 4xx
  classifier and the guarantee that no raw provider text reaches the client.
- **API auth and in-app rate limiting.** Every route is open. The error copy
  speaks of a per-agent request limit, but enforcement lives upstream at the
  AI Gateway, not in this app.
- **Retry/backoff on transient model errors.** A rate-limited or dropped
  answer surfaces an error card immediately; there is no automatic retry.
- **Observability.** Failures are `console.error` only — no structured logs,
  no error reporting sink.
