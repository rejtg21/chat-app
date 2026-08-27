# Setup

Two things have to exist before the app works: a Postgres database with
pgvector, and a way to reach a chat model. Embeddings need neither — they run
locally and cost nothing.

**Prerequisites:** Node 20.12+ (22 LTS recommended — the scripts use
`node --env-file-if-exists`) and pnpm 11 (`corepack enable`). Docker is only
needed for the local-Postgres option below.

---

## 1. Database

### Option A — Neon (free tier, what this is built for)

1. Create a project at <https://console.neon.tech>. The free plan is enough.
2. pgvector ships with Neon; the migration enables it with
   `CREATE EXTENSION IF NOT EXISTS vector`, so there is nothing to click.
3. Copy the **pooled** connection string — the host contains `-pooler` — into
   `DATABASE_URL`. The app's routes run on the Node runtime with a real
   connection pool, so the pooled endpoint is the right one for them.
4. Optionally also copy the **direct** (non-pooler) string into
   `DATABASE_URL_UNPOOLED`. The migration runner prefers it — DDL is happier
   over a direct connection — and falls back to `DATABASE_URL` when it is
   unset.
5. Apply the migrations:

   ```bash
   pnpm migrate            # applies every file in db/migrations/, in order
   pnpm migrate:status     # shows what is applied vs pending
   ```

   `pnpm migrate` loads `.env` then `.env.local`, is idempotent (a re-run is a
   no-op), and records each file in a `schema_migrations` table. No Node to
   hand? Paste `db/migrations/0001_init.sql` then `0002_system_messages.sql`
   into the Neon SQL Editor instead.

### Option B — local Postgres (how the pipeline was tested)

```bash
docker run -d --name docdesk-pg \
  -e POSTGRES_PASSWORD=docdesk -e POSTGRES_DB=docdesk \
  -p 55432:5432 pgvector/pgvector:pg16
```

Then set `DATABASE_URL=postgresql://postgres:docdesk@localhost:55432/docdesk`
in `.env.local` and run `pnpm migrate`.

The driver is plain `pg`, so both work with the same code — TLS is turned on
automatically for anything that is not localhost.

### Resetting

`pnpm db:reset -- --yes` drops every table in the `public` schema; add
`--truncate` to keep the schema and only delete rows. `pnpm db:reset:migrate`
drops everything and rebuilds from migrations in one step. Both refuse to run
without the confirmation flag.

---

## 2. Model access

Answers go through the [Vercel AI Gateway](https://vercel.com/ai-gateway),
which reaches every provider behind one key and lets models be named as plain
`provider/model` strings.

Either:

- set `AI_GATEWAY_API_KEY` in `.env.local`, or
- run `vercel link` then `vercel env pull`, which writes a `VERCEL_OIDC_TOKEN`
  the SDK will use instead. The token is short-lived; re-pull when it expires.

Embeddings do **not** use the gateway. `Supabase/gte-small` runs in-process
through Transformers.js — free, offline after the first download, 384-d.

### Local model, no gateway (optional)

Set `LMSTUDIO_BASE_URL` to any OpenAI-compatible server (LM Studio, Ollama,
llama.cpp — e.g. `http://localhost:1234/v1`) and every LLM call routes there
instead of the gateway. `AI_GATEWAY_API_KEY` is then unused, and
`CHAT_MODEL` / `ANNOTATION_MODEL` become the ids of the models loaded in that
server. `LMSTUDIO_API_KEY` is optional (most local servers ignore it).

---

## 3. Run it

```bash
cp .env.example .env.local   # then fill in DATABASE_URL
pnpm install
pnpm migrate                 # create / update the schema
pnpm dev                     # http://localhost:3000
```

The first upload downloads the embedding weights (~35 MB) and takes about
15 seconds longer than later ones. After that the model stays warm in the
process.

---

## 4. Deploy to Vercel (Hobby)

```bash
vercel link
vercel env add DATABASE_URL           # paste the pooled Neon string
vercel env add AI_GATEWAY_API_KEY     # skip if using the OIDC flow
pnpm migrate                          # run once against the production DB
vercel deploy --prod
```

`pnpm migrate` reads `DATABASE_URL_UNPOOLED` / `DATABASE_URL` from your local
env files, so point them at the production database (or `vercel env pull`
first) before running it. Re-run it whenever a new file lands in
`db/migrations/`.

`vercel.json` raises `maxDuration` to 300s on the two routes that need it —
`api/documents` (indexing a large PDF) and `api/chat` (streaming a long
answer). Both stay inside Hobby's limits.

Nothing else needs configuring. Streaming works on the Node runtime with no
extra setup, and `next.config.ts` already keeps the ONNX runtime out of the
bundle so its native binary resolves at runtime.

---

## Troubleshooting

**`DATABASE_URL is not set`** — the app renders and says so rather than
crashing. Fill it in and reload.

**Embeddings fail with a missing `.node` binary** — pnpm skips postinstall
scripts unless a package is allow-listed. `pnpm-workspace.yaml` already sets
`allowBuilds: onnxruntime-node: true`; if the binary is still missing, run
`pnpm rebuild onnxruntime-node`.

**Every question returns "no passage above threshold"** — `SIMILARITY_THRESHOLD`
(default `0.8`) is tuned for gte-small, which has a high similarity floor.
A different embedding model will need a different value; set it in the
environment rather than editing code.

**Changing the embedding model** — `EMBEDDING_DIMENSIONS` in
`src/lib/config.ts` and the `vector(384)` column in the migration must match,
and every document has to be re-indexed. Vectors from two models are not
comparable.
