/**
 * Migration runner for the Neon Postgres schema in db/migrations/.
 *
 * Each *.sql file in db/migrations/ is applied once, in filename order, and
 * recorded in a schema_migrations table so a second run is a no-op. The
 * existing files are written with IF NOT EXISTS / guarded DO blocks, so even
 * a database that was migrated by hand before this runner existed can be
 * caught up safely — the already-applied statements just do nothing.
 *
 * Usage (see package.json scripts):
 *   node --env-file=.env scripts/migrate.mjs          apply pending migrations
 *   node --env-file=.env scripts/migrate.mjs status   list applied / pending
 *   node --env-file=.env scripts/migrate.mjs --dry-run show what would run
 *
 * Connection string: DATABASE_URL_UNPOOLED is preferred (DDL over a direct
 * connection), falling back to DATABASE_URL.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations",
);

const command = process.argv[2] ?? "up";
const dryRun = process.argv.includes("--dry-run");

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Run with `node --env-file=.env scripts/migrate.mjs` " +
      "or see SETUP.md.",
  );
  process.exit(1);
}

const needsTls = (() => {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "disable") return false;
    return !["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
      url.hostname,
    );
  } catch {
    return true;
  }
})();

const client = new pg.Client({
  connectionString,
  ssl: needsTls ? { rejectUnauthorized: true } : false,
});

const listMigrationFiles = async () => {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith(".sql")).sort();
};

const appliedIds = async () => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await client.query(
    "SELECT id FROM schema_migrations ORDER BY id",
  );
  return new Set(rows.map((r) => r.id));
};

const run = async () => {
  await client.connect();
  try {
    const files = await listMigrationFiles();
    const applied = await appliedIds();
    const pending = files.filter((f) => !applied.has(f));

    if (command === "status") {
      for (const f of files) {
        console.log(`${applied.has(f) ? "  applied" : "  pending"}  ${f}`);
      }
      console.log(
        `\n${applied.size} applied, ${pending.length} pending.`,
      );
      return;
    }

    if (pending.length === 0) {
      console.log("Database is up to date — no pending migrations.");
      return;
    }

    if (dryRun) {
      console.log("Would apply:");
      for (const f of pending) console.log(`  ${f}`);
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (id) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("failed");
        throw error;
      }
    }

    console.log(`\nDone — ${pending.length} migration(s) applied.`);
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
