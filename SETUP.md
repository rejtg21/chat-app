# Setup

Two things have to exist before the app works: a Postgres database with
pgvector, and a way to reach a chat model. Embeddings need neither — they run
locally and cost nothing.

---

## 1. Database

### Option A — Neon (free tier, what this is built for)

1. Create a project at <https://console.neon.tech>. The free plan is enough.
2. pgvector ships with Neon; the migration enables it with
   `CREATE EXTENSION IF NOT EXISTS vector`, so there is nothing to click.
3. Copy the **pooled** connection string — the host contains `-pooler`. These
   routes run on the Node runtime with a real connection pool, so the pooled
   endpoint is the right one.
4. Run the migration:

   ```bash
   psql "$DATABASE_URL" -f db/migrations/0001_init.sql
   ```

   No `psql` to hand? Paste the file into the Neon SQL Editor instead.

### Option B — local Postgres (how the pipeline was tested)

```bash
docker run -d --name docdesk-pg \
  -e POSTGRES_PASSWORD=docdesk -e POSTGRES_DB=docdesk \
  -p 55432:5432 pgvector/pgvector:pg16

docker exec -i docdesk-pg psql -U postgres -d docdesk \
  < db/migrations/0001_init.sql
```

Then `DATABASE_URL=postgresql://postgres:docdesk@localhost:55432/docdesk`.

The driver is plain `pg`, so both work with the same code — TLS is turned on
automatically for anything that is not localhost.

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

---

## 3. Run it

```bash
cp .env.example .env.local   # then fill in DATABASE_URL
pnpm install
pnpm dev
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
vercel deploy --prod
```

`vercel.json` raises `maxDuration` to 300s on the two routes that need it —
indexing a large PDF and streaming a long answer. Both stay inside Hobby's
limits.

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
