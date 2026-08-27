/**
 * Postgres access.
 *
 * The `pg` driver speaks the standard wire protocol, so the same code runs
 * against Neon (use the pooled `-pooler` connection string) and against a
 * local Postgres with pgvector. That portability is the point: the retrieval
 * path can be exercised end-to-end on a laptop rather than only in
 * production.
 *
 * These routes run on the Node runtime — required anyway, because the
 * embedding model loads a native ONNX binary — so a real connection pool is
 * available and there is no need for an HTTP-per-query driver.
 */

import { Pool, type PoolConfig } from "pg";
import { ApiError } from "@/lib/errors";
import { EMBEDDING_DIMENSIONS } from "@/lib/config";

/**
 * One pool per process, cached on globalThis so a dev-server hot reload does
 * not leak a new pool on every edit.
 */
const globalForPg = globalThis as unknown as { docdeskPool?: Pool };

export const getPool = (): Pool => {
  if (globalForPg.docdeskPool) return globalForPg.docdeskPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ApiError("ERR_CONFIG", "The database is not configured.", {
      detail: "DATABASE_URL is not set — see SETUP.md",
    });
  }

  const config: PoolConfig = {
    connectionString: normaliseSslMode(connectionString),
    // Serverless invocations are short and concurrent; a small ceiling keeps
    // a burst from exhausting the database's connection limit.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres (Neon included) requires TLS; a local container does
    // not offer it. Decide from the host rather than forcing either way.
    ssl: needsTls(connectionString) ? { rejectUnauthorized: true } : false,
  };

  const pool = new Pool(config);
  // Without a listener, an idle-client error takes the process down.
  pool.on("error", (error) => console.error("[db] idle client error", error));

  globalForPg.docdeskPool = pool;
  return pool;
};

const needsTls = (connectionString: string): boolean => {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get("sslmode") === "disable") return false;
    return !["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
      url.hostname,
    );
  } catch {
    return true;
  }
};

/**
 * Neon's connection string carries `sslmode=require`. Newer `pg` warns that
 * `require` (and `prefer`/`verify-ca`) will switch to weaker libpq semantics
 * in pg v9. TLS here is already pinned by the explicit `ssl` option above
 * (`rejectUnauthorized: true` == full verification), so drop the ambiguous
 * parameter and let that object be the single source of truth. `disable` is
 * left intact — `needsTls` still reads it from the original string.
 */
const normaliseSslMode = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get("sslmode");
    if (mode && ["prefer", "require", "verify-ca"].includes(mode)) {
      url.searchParams.delete("sslmode");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
};

/**
 * Run a parameterised query and name its row shape.
 *
 * The cast goes through `unknown` rather than `any`: the driver genuinely
 * cannot know the column types, so the call site asserts them. Keep the type
 * argument in step with the SELECT list.
 */
export const query = async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
  const result = await getPool().query(text, params as unknown[]);
  return result.rows as unknown as T[];
};

/** Run a statement whose result is not read. */
export const execute = async (text: string, params: unknown[] = []): Promise<void> => {
  await getPool().query(text, params as unknown[]);
};

/**
 * pgvector's text input format: `[0.1,0.2,...]`.
 *
 * Bind it as a normal text parameter and cast in SQL with `$n::vector` —
 * there is no native vector codec.
 */
export const toVectorLiteral = (vector: readonly number[]): string => {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new ApiError(
      "ERR_EMBEDDING_FAILED",
      "The embedding model returned an unexpected vector width.",
      {
        detail: `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`,
      },
    );
  }
  return `[${vector.join(",")}]`;
};

/** Wrap a driver-level failure in the retrieval error the UI can render. */
export const asRetrievalError = (cause: unknown): ApiError => {
  return new ApiError(
    "ERR_RETRIEVAL_FAILED",
    "The vector search did not come back. Your document and this conversation are safe in Neon — only the lookup failed.",
    {
      detail: `pgvector query failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    },
  );
};
