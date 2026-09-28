import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DbService, type Queryable } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { config } from '../config.js';
import { AppError, badRequest } from '../common/errors.js';
import type { AuthUser } from './auth-user.js';
import type { Permission } from './permissions.js';

const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, ARGON_OPTS);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function validatePasswordStrength(password: string, username: string): void {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 10 || classes < 3) {
    throw badRequest('Password must be at least 10 characters and use at least 3 of: lowercase, uppercase, digits, symbols');
  }
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw badRequest('Password must not contain the username');
  }
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async login(username: string, password: string, ip: string | null, userAgent: string | null) {
    const user = await this.db.one(
      `SELECT id, username, password_hash, is_active, locked_until, failed_login_count
         FROM users WHERE lower(username) = lower($1)`, [username]);

    const record = (success: boolean, reason: string | null) => this.db.query(
      `INSERT INTO login_history (username_attempted, user_id, success, reason, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`, [username.slice(0, 100), user?.id ?? null, success, reason, ip, userAgent?.slice(0, 300) ?? null]);

    if (!user) {
      // Spend comparable time so response timing does not reveal whether the username exists.
      this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      await verify(await this.dummyHash, password).catch(() => false);
      await record(false, 'UNKNOWN_USER');
      throw invalidCredentials();
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await record(false, 'LOCKED');
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed logins. Try again later.');
    }
    const ok = await verify(user.password_hash, password).catch(() => false);
    if (!ok || !user.is_active) {
      if (!ok) {
        await this.db.query(
          `UPDATE users SET failed_login_count = failed_login_count + 1,
             locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`, [user.id, config.maxFailedLogins, config.lockoutMinutes]);
      }
      await record(false, ok ? 'INACTIVE' : 'BAD_PASSWORD');
      throw invalidCredentials();
    }

    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    await this.db.tx(async (c) => {
      await c.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
      await c.query(
        `INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
        [sha256(token), user.id, csrfToken, config.sessionAbsoluteHours, ip, userAgent?.slice(0, 300) ?? null]);
    });
    await record(true, null);
    return { token };
  }

  /** Resolve a session cookie to a fully-loaded user; enforces idle and absolute expiry. */
  async resolveSession(token: string): Promise<AuthUser | null> {
    const sid = sha256(token);
    const row = await this.db.one(
      `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at,
              u.id, u.username, u.full_name, u.org_wide, u.must_change_password,
              COALESCE((SELECT array_agg(DISTINCT rp.permission_code)
                          FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                         WHERE ur.user_id = u.id), '{}') AS permissions,
              COALESCE((SELECT array_agg(a.substation_id ORDER BY a.substation_id)
                          FROM user_substation_assignments a
                          JOIN substations st ON st.id = a.substation_id AND st.is_active
                         WHERE a.user_id = u.id), '{}') AS substation_ids
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active
          AND s.last_seen_at > now() - make_interval(mins => $2)`,
      [sid, config.sessionIdleMinutes]);
    if (!row) return null;
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sid]);
    }
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      orgWide: row.org_wide,
      mustChangePassword: row.must_change_password,
      permissions: new Set(row.permissions as Permission[]),
      substationIds: (row.substation_ids as (number | string)[]).map(Number),
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
    };
  }

  async logout(user: AuthUser) {
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [user.sessionId]);
  }

  async changePassword(user: AuthUser, current: string, next: string, ip: string | null) {
    const row = await this.db.one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verify(row.password_hash, current).catch(() => false))) {
      throw badRequest('Current password is incorrect');
    }
    if (current === next) throw badRequest('New password must differ from the current password');
    validatePasswordStrength(next, user.username);
    const newHash = await hashPassword(next);
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now()
         WHERE id = $1`, [user.id, newHash]);
      // Revoke every other session after a password change.
      await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
        [user.id, user.sessionId]);
      await this.audit.log(c, { userId: user.id, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id, ip });
    });
  }

  static async revokeAllSessions(q: Queryable, userId: number) {
    await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
}
