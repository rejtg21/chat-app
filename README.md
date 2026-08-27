# Docdesk — document chat

Upload a PDF, TXT or Markdown file and ask questions about it. Answers stream
back grounded in the document, cite the section and lines they came from, and
carry a structured component — a table, timeline, key figures, checklist or
evidence cards — when the answer's shape calls for one.

The conversation lives in Postgres, so a reload restores it.

**Setup and deployment: [SETUP.md](./SETUP.md).**

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
db/migrations/0001_init.sql   documents · chunks · embeddings · chats · messages
db/migrations/0002_*.sql      widen messages.role to allow 'system'
src/lib/                      config, db, extraction, chunking, embeddings,
                              retrieval, prompting, schemas, repository
src/app/api/                  documents (index) · chat (RAG) · session
                              (restore) · messages/ui-state · messages/system
src/components/               the UI, and structured/ for the five components
public/sample/                a real sample document, indexed through the
                              same pipeline as an upload
```

## Design

The interface follows the Industry design system in
`design_handoff_document_chat/`: square corners, hairline borders, no filled
card surfaces, `+` registration marks on every framed object, and one solid
accent fill — the send button. Tokens are ported into `src/app/globals.css`
and consumed as CSS custom properties.
