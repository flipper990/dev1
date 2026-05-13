import pg from 'pg';
import { nanoid } from 'nanoid';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';

export type AccountRole = 'user' | 'admin';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  emailNormalized: string;
  fullName: string;
  passwordHash: string;
  role: AccountRole;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  replacedByTokenId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
}

export interface EmailVerificationToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
}

interface SqlMigration {
  id: string;
  sql: string;
}

const { Pool } = pg;

function asIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function mapAuthUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    email: String(row.email),
    emailNormalized: String(row.email_normalized),
    fullName: String(row.full_name),
    passwordHash: String(row.password_hash),
    role: (String(row.role) === 'admin' ? 'admin' : 'user'),
    workspaceId: String(row.workspace_id),
    workspaceRole: ((): WorkspaceRole => {
      const role = String(row.workspace_role);
      if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') return role;
      return 'member';
    })(),
    emailVerified: Boolean(row.email_verified),
    emailVerifiedAt: row.email_verified_at ? asIsoString(row.email_verified_at) : null,
    lastLoginAt: row.last_login_at ? asIsoString(row.last_login_at) : null,
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

function mapRefreshSession(row: Record<string, unknown>): RefreshSession {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    expiresAt: asIsoString(row.expires_at),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
    revokedAt: row.revoked_at ? asIsoString(row.revoked_at) : null,
    replacedByTokenId: row.replaced_by_token_id ? String(row.replaced_by_token_id) : null,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const AUTH_MIGRATIONS: SqlMigration[] = [
  {
    id: '001_auth_schema',
    sql: `
CREATE TABLE IF NOT EXISTS auth_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_normalized TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  workspace_id TEXT NOT NULL,
  workspace_role TEXT NOT NULL DEFAULT 'owner' CHECK (workspace_role IN ('owner', 'admin', 'member', 'viewer')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_workspace_id ON auth_users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_email_normalized ON auth_users(email_normalized);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id TEXT,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at ON auth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_revoked_at ON auth_refresh_tokens(revoked_at);

CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_user_id ON auth_password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_expires_at ON auth_password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth_email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_email_verification_tokens_user_id ON auth_email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_email_verification_tokens_expires_at ON auth_email_verification_tokens(expires_at);
`,
  },
];

export class AuthStore {
  private readonly pool: pg.Pool;
  private schemaPromise: Promise<void> | null = null;

  constructor(connectionString: string, private readonly logger: Logger) {
    this.pool = new Pool({
      connectionString,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async ensureSchema(): Promise<void> {
    if (!this.schemaPromise) {
      this.schemaPromise = this.runMigrations();
    }
    return this.schemaPromise;
  }

  private async runMigrations(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS auth_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const existing = await this.pool.query<{ id: string }>('SELECT id FROM auth_migrations');
    const applied = new Set(existing.rows.map((row) => row.id));

    for (const migration of AUTH_MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO auth_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
        this.logger.info(`Applied auth migration ${migration.id}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  public async cleanupExpiredTokens(): Promise<void> {
    await this.pool.query('DELETE FROM auth_password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL');
    await this.pool.query('DELETE FROM auth_email_verification_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL');
    await this.pool.query('DELETE FROM auth_refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL');
  }

  public async findUserByEmail(email: string): Promise<AuthUser | null> {
    const normalized = normalizeEmail(email);
    const result = await this.pool.query('SELECT * FROM auth_users WHERE email_normalized = $1 LIMIT 1', [normalized]);
    if (result.rows.length === 0) return null;
    return mapAuthUser(result.rows[0] as Record<string, unknown>);
  }

  public async findUserById(userId: string): Promise<AuthUser | null> {
    const result = await this.pool.query('SELECT * FROM auth_users WHERE id = $1 LIMIT 1', [userId]);
    if (result.rows.length === 0) return null;
    return mapAuthUser(result.rows[0] as Record<string, unknown>);
  }

  public async createUser(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    role?: AccountRole;
    workspaceId?: string;
    workspaceRole?: WorkspaceRole;
  }): Promise<AuthUser> {
    const id = `usr_${nanoid(18)}`;
    const emailNormalized = normalizeEmail(input.email);
    const now = new Date().toISOString();
    const workspaceId = input.workspaceId ?? `ws_${nanoid(14)}`;
    const workspaceRole = input.workspaceRole ?? 'owner';
    const role = input.role ?? 'user';
    const result = await this.pool.query(
      `INSERT INTO auth_users
        (id, email, email_normalized, full_name, password_hash, role, workspace_id, workspace_role, email_verified, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $9)
       RETURNING *`,
      [id, input.email, emailNormalized, input.fullName, input.passwordHash, role, workspaceId, workspaceRole, now],
    );
    return mapAuthUser(result.rows[0] as Record<string, unknown>);
  }

  public async markUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
      [userId, passwordHash],
    );
  }

  public async markEmailVerified(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_users
       SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId],
    );
  }

  public async touchLastLogin(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
      [userId],
    );
  }

  public async createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<RefreshSession> {
    const id = `rt_${nanoid(20)}`;
    const result = await this.pool.query(
      `INSERT INTO auth_refresh_tokens
       (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, input.userId, input.tokenHash, input.expiresAt.toISOString(), input.ipAddress ?? null, input.userAgent ?? null],
    );
    return mapRefreshSession(result.rows[0] as Record<string, unknown>);
  }

  public async findRefreshSessionByHash(tokenHash: string): Promise<RefreshSession | null> {
    const result = await this.pool.query(
      'SELECT * FROM auth_refresh_tokens WHERE token_hash = $1 LIMIT 1',
      [tokenHash],
    );
    if (result.rows.length === 0) return null;
    return mapRefreshSession(result.rows[0] as Record<string, unknown>);
  }

  public async rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ session: RefreshSession; user: AuthUser } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT * FROM auth_refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [input.currentTokenHash],
      );
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const current = mapRefreshSession(existing.rows[0] as Record<string, unknown>);
      if (current.revokedAt || Date.parse(current.expiresAt) <= Date.now()) {
        await client.query('ROLLBACK');
        return null;
      }

      const nextSessionId = `rt_${nanoid(20)}`;
      const inserted = await client.query(
        `INSERT INTO auth_refresh_tokens
         (id, user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          nextSessionId,
          current.userId,
          input.nextTokenHash,
          input.nextExpiresAt.toISOString(),
          input.ipAddress ?? null,
          input.userAgent ?? null,
        ],
      );
      await client.query(
        `UPDATE auth_refresh_tokens
         SET revoked_at = NOW(), replaced_by_token_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [current.id, nextSessionId],
      );
      const userResult = await client.query('SELECT * FROM auth_users WHERE id = $1 LIMIT 1', [current.userId]);
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return {
        session: mapRefreshSession(inserted.rows[0] as Record<string, unknown>),
        user: mapAuthUser(userResult.rows[0] as Record<string, unknown>),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async revokeRefreshSessionByHash(tokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
       WHERE token_hash = $1`,
      [tokenHash],
    );
  }

  public async revokeRefreshSessionsForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  public async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken> {
    const id = `prt_${nanoid(18)}`;
    await this.pool.query('DELETE FROM auth_password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [input.userId]);
    const result = await this.pool.query(
      `INSERT INTO auth_password_reset_tokens
       (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, input.userId, input.tokenHash, input.expiresAt.toISOString()],
    );
    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      tokenHash: String(row.token_hash),
      expiresAt: asIsoString(row.expires_at),
      createdAt: asIsoString(row.created_at),
      usedAt: row.used_at ? asIsoString(row.used_at) : null,
    };
  }

  public async consumePasswordResetToken(tokenHash: string): Promise<{ token: PasswordResetToken; user: AuthUser } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokenResult = await client.query(
        `SELECT * FROM auth_password_reset_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      if (tokenResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const row = tokenResult.rows[0] as Record<string, unknown>;
      const token: PasswordResetToken = {
        id: String(row.id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: asIsoString(row.expires_at),
        createdAt: asIsoString(row.created_at),
        usedAt: row.used_at ? asIsoString(row.used_at) : null,
      };
      if (token.usedAt || Date.parse(token.expiresAt) <= Date.now()) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('UPDATE auth_password_reset_tokens SET used_at = NOW() WHERE id = $1', [token.id]);
      const userResult = await client.query('SELECT * FROM auth_users WHERE id = $1 LIMIT 1', [token.userId]);
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return { token, user: mapAuthUser(userResult.rows[0] as Record<string, unknown>) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationToken> {
    const id = `evt_${nanoid(18)}`;
    await this.pool.query('DELETE FROM auth_email_verification_tokens WHERE user_id = $1 AND used_at IS NULL', [input.userId]);
    const result = await this.pool.query(
      `INSERT INTO auth_email_verification_tokens
       (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, input.userId, input.tokenHash, input.expiresAt.toISOString()],
    );
    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      tokenHash: String(row.token_hash),
      expiresAt: asIsoString(row.expires_at),
      createdAt: asIsoString(row.created_at),
      usedAt: row.used_at ? asIsoString(row.used_at) : null,
    };
  }

  public async consumeEmailVerificationToken(tokenHash: string): Promise<{ token: EmailVerificationToken; user: AuthUser } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokenResult = await client.query(
        `SELECT * FROM auth_email_verification_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      if (tokenResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const row = tokenResult.rows[0] as Record<string, unknown>;
      const token: EmailVerificationToken = {
        id: String(row.id),
        userId: String(row.user_id),
        tokenHash: String(row.token_hash),
        expiresAt: asIsoString(row.expires_at),
        createdAt: asIsoString(row.created_at),
        usedAt: row.used_at ? asIsoString(row.used_at) : null,
      };
      if (token.usedAt || Date.parse(token.expiresAt) <= Date.now()) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('UPDATE auth_email_verification_tokens SET used_at = NOW() WHERE id = $1', [token.id]);
      const userResult = await client.query('SELECT * FROM auth_users WHERE id = $1 LIMIT 1', [token.userId]);
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return { token, user: mapAuthUser(userResult.rows[0] as Record<string, unknown>) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

