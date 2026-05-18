import net from 'node:net';
import pg from 'pg';

const { Pool } = pg;

export interface DbPreflightResult {
  ok: boolean;
  databaseUrl: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  checks: {
    url: { ok: boolean; reason: string };
    tcp: { ok: boolean; reason: string };
    auth: { ok: boolean; reason: string };
    database: { ok: boolean; reason: string };
    migrations: { ok: boolean; reason: string };
  };
  diagnostics: string[];
}

export interface DbPreflightOptions {
  databaseUrl?: string;
  tcpTimeoutMs?: number;
  queryTimeoutMs?: number;
}

const DEFAULT_TCP_TIMEOUT_MS = 2_500;
const DEFAULT_QUERY_TIMEOUT_MS = 7_500;

function redactDatabaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return value;
  }
}

function failResult(databaseUrl: string | undefined, reason: string): DbPreflightResult {
  return {
    ok: false,
    databaseUrl: databaseUrl ? redactDatabaseUrl(databaseUrl) : null,
    host: null,
    port: null,
    database: null,
    user: null,
    checks: {
      url: { ok: false, reason },
      tcp: { ok: false, reason: 'not-run' },
      auth: { ok: false, reason: 'not-run' },
      database: { ok: false, reason: 'not-run' },
      migrations: { ok: false, reason: 'not-run' },
    },
    diagnostics: [reason],
  };
}

async function checkTcpReachable(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; reason: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finalize = (ok: boolean, reason: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true, 'ok'));
    socket.once('timeout', () => finalize(false, `timeout after ${timeoutMs}ms`));
    socket.once('error', (err) => finalize(false, (err as Error).message));
    socket.connect(port, host);
  });
}

function parseDatabaseUrl(raw: string): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  redactedUrl: string;
} | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null;
    const host = parsed.hostname;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
    const database = parsed.pathname.replace(/^\/+/, '');
    const user = decodeURIComponent(parsed.username ?? '');
    const password = decodeURIComponent(parsed.password ?? '');
    return {
      host,
      port: Number.isFinite(port) ? port : 5432,
      database,
      user,
      password,
      redactedUrl: redactDatabaseUrl(raw),
    };
  } catch {
    return null;
  }
}

function classifyPgError(err: unknown): string {
  const anyErr = err as { message?: string; code?: string };
  const code = anyErr?.code ?? '';
  const message = anyErr?.message ?? String(err);
  if (/SCRAM-SERVER-FIRST-MESSAGE:\s*client password must be a string/i.test(message)) {
    return 'DATABASE_URL is missing a password. Include credentials like postgresql://user:password@host:port/db.';
  }
  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return 'Postgres rejected credentials (28P01). Verify DATABASE_URL user/password match the running Postgres instance.';
  }
  if (/ECONNREFUSED/i.test(message)) {
    return 'Postgres is not reachable on the configured host/port (connection refused).';
  }
  return message;
}

export async function runDbPreflight(options?: DbPreflightOptions): Promise<DbPreflightResult> {
  const databaseUrl = (options?.databaseUrl ?? process.env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) {
    return failResult(
      undefined,
      'DATABASE_URL is missing. Set a full URL with credentials, e.g. postgresql://devteam:devteam@localhost:55432/devteam',
    );
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) {
    return failResult(databaseUrl, 'DATABASE_URL is invalid. Expected postgres:// or postgresql:// URL.');
  }

  if (!parsed.user) {
    return failResult(databaseUrl, 'DATABASE_URL is missing username.');
  }
  if (!parsed.password) {
    return failResult(databaseUrl, 'DATABASE_URL is missing password.');
  }
  if (!parsed.host) {
    return failResult(databaseUrl, 'DATABASE_URL is missing host.');
  }
  if (!parsed.database) {
    return failResult(databaseUrl, 'DATABASE_URL is missing database name.');
  }

  const tcp = await checkTcpReachable(parsed.host, parsed.port, options?.tcpTimeoutMs ?? DEFAULT_TCP_TIMEOUT_MS);
  if (!tcp.ok) {
    return {
      ok: false,
      databaseUrl: parsed.redactedUrl,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      user: parsed.user,
      checks: {
        url: { ok: true, reason: 'ok' },
        tcp,
        auth: { ok: false, reason: 'not-run' },
        database: { ok: false, reason: 'not-run' },
        migrations: { ok: false, reason: 'not-run' },
      },
      diagnostics: [
        `Postgres TCP check failed for ${parsed.host}:${parsed.port}: ${tcp.reason}`,
        'If you use docker-compose.dev.yml, start Postgres with: npm --workspace @devteam/api run db:up',
      ],
    };
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: options?.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    max: 1,
  });

  try {
    const whoami = await pool.query<{ current_database: string; current_user: string }>(
      'SELECT current_database() AS current_database, current_user AS current_user',
    );
    const currentDatabase = whoami.rows[0]?.current_database ?? '';
    const currentUser = whoami.rows[0]?.current_user ?? '';

    const migrationTable = await pool.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='auth_migrations') AS present",
    );
    const migrationTablePresent = Boolean(migrationTable.rows[0]?.present);
    let migrationPresent = false;
    if (migrationTablePresent) {
      const migration = await pool.query<{ present: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM auth_migrations WHERE id='001_auth_schema') AS present",
      );
      migrationPresent = Boolean(migration.rows[0]?.present);
    }

    const checks = {
      url: { ok: true, reason: 'ok' },
      tcp: { ok: true, reason: 'ok' },
      auth: { ok: true, reason: `ok (connected as ${currentUser || parsed.user})` },
      database: {
        ok: Boolean(currentDatabase),
        reason: currentDatabase ? `ok (${currentDatabase})` : 'current_database() returned empty result',
      },
      migrations: migrationTablePresent && migrationPresent
        ? { ok: true, reason: 'ok (auth_migrations contains 001_auth_schema)' }
        : migrationTablePresent
          ? { ok: false, reason: 'auth_migrations exists but 001_auth_schema is missing' }
          : { ok: false, reason: 'auth_migrations table is missing' },
    };

    const ok = checks.url.ok && checks.tcp.ok && checks.auth.ok && checks.database.ok && checks.migrations.ok;
    const diagnostics: string[] = [];
    if (!checks.migrations.ok) {
      diagnostics.push(
        'Auth schema migration is not applied yet. Start the API once to apply migrations or check DB user permissions.',
      );
    }

    return {
      ok,
      databaseUrl: parsed.redactedUrl,
      host: parsed.host,
      port: parsed.port,
      database: currentDatabase || parsed.database,
      user: currentUser || parsed.user,
      checks,
      diagnostics,
    };
  } catch (err) {
    return {
      ok: false,
      databaseUrl: parsed.redactedUrl,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      user: parsed.user,
      checks: {
        url: { ok: true, reason: 'ok' },
        tcp: { ok: true, reason: 'ok' },
        auth: { ok: false, reason: classifyPgError(err) },
        database: { ok: false, reason: 'not-run' },
        migrations: { ok: false, reason: 'not-run' },
      },
      diagnostics: [
        classifyPgError(err),
      ],
    };
  } finally {
    await pool.end().catch(() => {});
  }
}
