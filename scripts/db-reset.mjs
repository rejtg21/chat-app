/**
 * Wipe the database.
 *
 * Two modes:
 *   (default)     DROP every table in the `public` schema (CASCADE), including
 *                 schema_migrations — a clean slate. Follow with `pnpm migrate`
 *                 to rebuild the schema.
 *   --truncate    Keep the schema, just delete every row (TRUNCATE ... CASCADE
 *                 with identity restart). No migration needed afterwards.
 *
 * This is destructive and irreversible, so it refuses to run without an
 * explicit confirmation flag:
 *
 *   node --env-file=.env scripts/db-reset.mjs --yes
 *   node --env-file=.env scripts/db-reset.mjs --truncate --yes
 *
 * Connection string: DATABASE_URL_UNPOOLED is preferred, falling back to
 * DATABASE_URL.
 */

import pg from "pg";

const truncate = process.argv.includes("--truncate");
const confirmed =
  process.argv.includes("--yes") ||
  process.argv.includes("-y") ||
  process.env.CONFIRM === "1";

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Run with `node --env-file=.env scripts/db-reset.mjs` " +
      "or see SETUP.md.",
  );
  process.exit(1);
}

let host = "the database";
try {
  host = new URL(connectionString).host;
} catch {
  /* keep the generic label */
}

if (!confirmed) {
  console.error(
    `Refusing to ${truncate ? "truncate" : "drop"} every table on ${host} ` +
      "without confirmation.\n\n" +
      `  pnpm db:reset -- --yes${truncate ? " --truncate" : ""}\n` +
      "  # or: CONFIRM=1 pnpm db:reset\n",
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

const run = async () => {
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT tablename
        FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename
    `);
    const tables = rows.map((r) => r.tablename);

    if (tables.length === 0) {
      console.log(`Nothing to do — ${host} has no tables in the public schema.`);
      return;
    }

    const identifiers = tables.map((name) => `"${name}"`).join(", ");
    const verb = truncate ? "Truncating" : "Dropping";
    console.log(`${verb} ${tables.length} table(s) on ${host}: ${tables.join(", ")}`);

    await client.query("BEGIN");
    try {
      if (truncate) {
        await client.query(
          `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`,
        );
      } else {
        await client.query(`DROP TABLE IF EXISTS ${identifiers} CASCADE`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      truncate
        ? "Done — every row deleted, schema kept."
        : "Done — every table dropped. Run `pnpm migrate` to rebuild the schema.",
    );
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
