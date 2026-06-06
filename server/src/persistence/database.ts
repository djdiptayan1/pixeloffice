// ---------------------------------------------------------------------------
// PostgreSQL connection wrapper (Layer 4 — Persistence).
//
// A thin wrapper over a `pg` connection Pool. Activated ONLY when the
// DATABASE_URL env var is present; with no env config the office runs entirely
// in-memory (the zero-config path is sacred — see CLAUDE.md / plan Principle 4).
//
// Lifecycle: lazy connect (the Pool connects on first query), health() for the
// readiness probe, and graceful end() on shutdown. At startup the schema in
// db/init.sql is applied idempotently when AUTO_MIGRATE is enabled (default
// true whenever DATABASE_URL is set).
//
// Framework-independent: imports no Colyseus / Express. The only side effect is
// the database connection it owns.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bootstrap schema (server/db/init.sql). */
export const INIT_SQL_PATH = resolve(__dirname, "../../db/init.sql");

export interface DatabaseConfig {
  /** Postgres connection string, e.g. postgres://user:pass@host:5432/pixeloffice */
  connectionString: string;
  /** Run db/init.sql at startup. Defaults to true when a connection string is set. */
  autoMigrate?: boolean;
  /**
   * SSL override. When omitted it is derived from the connection string's
   * `sslmode` and the DATABASE_SSL / PGSSLMODE env (see sslOption). Most managed
   * providers (RDS/Heroku/Supabase/Neon/Render) REQUIRE TLS, so without this the
   * pool would throw and the factory would silently degrade to in-memory.
   */
  ssl?: boolean | { rejectUnauthorized: boolean };
}

/**
 * Resolve the pg `ssl` Pool option from an explicit override, the connection
 * string's `sslmode`, or the DATABASE_SSL / PGSSLMODE env. Returns an object to
 * spread into the Pool config (empty = no ssl key, i.e. plain TCP for local dev).
 *
 *   sslmode=disable        -> ssl: false
 *   sslmode=require        -> ssl: { rejectUnauthorized: true }
 *   sslmode=no-verify      -> ssl: { rejectUnauthorized: false }
 *   sslmode=verify-(ca|full) -> ssl: { rejectUnauthorized: true }
 *   DATABASE_SSL=true|1|require        -> ssl: { rejectUnauthorized: true }
 *   DATABASE_SSL=no-verify|insecure    -> ssl: { rejectUnauthorized: false }
 */
export function sslOption(
  connectionString: string,
  override?: boolean | { rejectUnauthorized: boolean },
  env: NodeJS.ProcessEnv = process.env,
): { ssl?: boolean | { rejectUnauthorized: boolean } } {
  if (override !== undefined) return { ssl: override };

  const mode = sslModeFromUrl(connectionString);
  if (mode === "disable") return { ssl: false };
  if (mode === "no-verify") return { ssl: { rejectUnauthorized: false } };
  if (mode) return { ssl: { rejectUnauthorized: true } }; // require / verify-*

  const envSsl = (env.DATABASE_SSL ?? env.PGSSLMODE ?? "").trim().toLowerCase();
  if (!envSsl) return {}; // no SSL configured -> plain TCP (local dev default)
  if (["false", "0", "no", "disable"].includes(envSsl)) return { ssl: false };
  if (["no-verify", "insecure", "allow", "prefer"].includes(envSsl)) {
    return { ssl: { rejectUnauthorized: false } };
  }
  return { ssl: { rejectUnauthorized: true } }; // true / 1 / require / verify-*
}

function sslModeFromUrl(connectionString: string): string | null {
  try {
    const value = new URL(connectionString).searchParams.get("sslmode");
    return value ? value.toLowerCase() : null;
  } catch {
    const m = /[?&]sslmode=([^&]+)/i.exec(connectionString);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }
}

/**
 * Owns a single pg Pool. Construct via `Database.fromEnv()` (returns null when
 * DATABASE_URL is absent) so callers can fall back to in-memory storage.
 */
export class Database {
  private readonly pool: Pool;
  private readonly autoMigrate: boolean;
  private migrated = false;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ...sslOption(config.connectionString, config.ssl),
    });
    this.autoMigrate = config.autoMigrate ?? true;
    // A pool-level error handler prevents an idle client error from crashing
    // the process (plan: recover from service restarts / graceful degradation).
    this.pool.on("error", (err) => {
      console.error("[PixelOffice][db] idle client error:", err.message);
    });
  }

  /**
   * Build from env. Returns null when DATABASE_URL is unset so the integrator
   * can choose the in-memory path. AUTO_MIGRATE=false disables schema bootstrap.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Database | null {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) return null;
    const autoMigrate = env.AUTO_MIGRATE ? env.AUTO_MIGRATE !== "false" : true;
    return new Database({ connectionString, autoMigrate });
  }

  /** Run a parameterised query. */
  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params as unknown[]);
  }

  /** Check out a client for a transaction; caller MUST release it. */
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Verify connectivity. Resolves true on a successful round-trip, false on any
   * failure (never throws) so callers can degrade to in-memory cleanly.
   */
  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch (err) {
      console.error(
        "[PixelOffice][db] health check failed:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Apply db/init.sql idempotently (the SQL uses IF NOT EXISTS). Runs at most
   * once per process and only when autoMigrate is enabled. Throws on SQL error
   * so the factory can decide whether to fall back.
   */
  async migrate(): Promise<void> {
    if (!this.autoMigrate || this.migrated) return;
    const sql = await readFile(INIT_SQL_PATH, "utf8");
    // Serialize migrations across instances with a session advisory lock so two
    // booting replicas don't run concurrent CREATE TABLE/INDEX (which can raise
    // transient duplicate/"tuple concurrently updated" errors and wrongly demote
    // a replica to in-memory). The lock auto-releases when the client returns.
    const MIGRATION_LOCK_KEY = 0x7058_4f46; // "pXOF" — arbitrary fixed constant
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      try {
        await client.query(sql);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
    this.migrated = true;
  }

  /** Close all connections. Safe to call once at shutdown. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
