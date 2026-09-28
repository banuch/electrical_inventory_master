import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, hashPassword, validatePasswordStrength } from '../auth/auth.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { badRequest, conflict, forbidden, notFound, pgCode } from '../common/errors.js';
import { likeEscape, offset, type Page } from '../common/validation.js';

export interface UserInput {
  username: string; fullName: string; email: string; phone: string;
  isActive: boolean; orgWide: boolean; roleIds: number[]; substationIds: number[];
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async list(f: { q?: string; roleId?: number; substationId?: number; active?: boolean; page: number; pageSize: number }): Promise<Page<any>> {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.q) add('(u.username ILIKE ? OR u.full_name ILIKE ? OR u.email ILIKE ?)', `%${likeEscape(f.q)}%`);
    if (f.roleId) add('EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role_id = ?)', f.roleId);
    if (f.substationId) add('EXISTS (SELECT 1 FROM user_substation_assignments a WHERE a.user_id = u.id AND a.substation_id = ?)', f.substationId);
    if (f.active !== undefined) add('u.is_active = ?', f.active);
    params.push(f.pageSize, offset(f));
    const { rows } = await this.db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.org_wide, u.must_change_password,
              u.last_login_at, u.locked_until,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name) ORDER BY r.name)
                          FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]') AS roles,
              COALESCE((SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'name', s.name) ORDER BY s.code)
                          FROM user_substation_assignments a JOIN substations s ON s.id = a.substation_id WHERE a.user_id = u.id), '[]') AS substations,
              count(*) OVER() AS total
         FROM users u
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.username LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0, page: f.page, pageSize: f.pageSize };
  }

  async roles() {
    const { rows } = await this.db.query(
      `SELECT r.id, r.code, r.name, r.description, r.is_system,
              COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id ORDER BY r.id`);
    return rows;
  }

  permissions() {
    return Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description }));
  }

  async create(actor: AuthUser, input: UserInput, password: string, ip: string | null) {
    validatePasswordStrength(password, input.username);
    const passwordHash = await hashPassword(password);
    try {
      return await this.db.tx(async (c) => {
        await this.assertGrantable(c, actor, input);
        const { rows: [row] } = await c.query(
          `INSERT INTO users (username, full_name, email, phone, password_hash, is_active, org_wide, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
          [input.username, input.fullName, input.email || null, input.phone || null, passwordHash, input.isActive, input.orgWide]);
        await this.writeAssignments(c, row.id, input);
        await this.audit.log(c, { userId: actor.id, action: 'USER_CREATED', entityType: 'user', entityId: row.id, ip, details: { ...input } });
        return { id: row.id };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Username ${input.username} is already taken`);
      throw err;
    }
  }

  async update(actor: AuthUser, userId: number, input: UserInput, ip: string | null) {
    if (userId === actor.id && (!input.isActive)) throw badRequest('You cannot deactivate your own account');
    try {
      return await this.db.tx(async (c) => {
        const before = await this.snapshot(c, userId);
        await this.assertGrantable(c, actor, input, before);
        await c.query(
          `UPDATE users SET username = $2, full_name = $3, email = $4, phone = $5, is_active = $6, org_wide = $7, updated_at = now()
           WHERE id = $1`,
          [userId, input.username, input.fullName, input.email || null, input.phone || null, input.isActive, input.orgWide]);
        await c.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await c.query('DELETE FROM user_substation_assignments WHERE user_id = $1', [userId]);
        await this.writeAssignments(c, userId, input);

        const accessChanged = before.is_active !== input.isActive || before.org_wide !== input.orgWide
          || !sameSet(before.role_ids, input.roleIds) || !sameSet(before.substation_ids, input.substationIds);
        // Permission or scope changes take effect immediately: revoke the user's sessions.
        if (accessChanged && userId !== actor.id) await AuthService.revokeAllSessions(c, userId);
        await this.audit.log(c, { userId: actor.id, action: 'USER_UPDATED', entityType: 'user', entityId: userId, ip, details: { before, after: input } });
        return { id: userId };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Username ${input.username} is already taken`);
      throw err;
    }
  }

  async resetPassword(actor: AuthUser, userId: number, password: string, ip: string | null) {
    const target = await this.db.one('SELECT username FROM users WHERE id = $1', [userId]);
    if (!target) throw notFound('User');
    validatePasswordStrength(password, target.username);
    const passwordHash = await hashPassword(password);
    await this.db.tx(async (c) => {
      await this.assertCanManage(c, actor, userId);
      await c.query(
        `UPDATE users SET password_hash = $2, must_change_password = true, failed_login_count = 0, locked_until = NULL,
           password_changed_at = now(), updated_at = now() WHERE id = $1`, [userId, passwordHash]);
      await AuthService.revokeAllSessions(c, userId);
      await this.audit.log(c, { userId: actor.id, action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: userId, ip });
    });
  }

  async setRolePermissions(actor: AuthUser, roleId: number, permissions: Permission[], ip: string | null) {
    const unknown = permissions.filter((p) => !(p in PERMISSIONS));
    if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);
    await this.db.tx(async (c) => {
      const { rows: [role] } = await c.query('SELECT id, code FROM roles WHERE id = $1 FOR UPDATE', [roleId]);
      if (!role) throw notFound('Role');
      if (role.code === 'SUPER_ADMIN') throw badRequest('The Super Administrator role always holds every permission');
      const before = (await c.query('SELECT permission_code FROM role_permissions WHERE role_id = $1', [roleId])).rows.map((r) => r.permission_code);
      await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      await c.query('INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[])', [roleId, permissions]);
      await c.query(
        `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id <> $2
           AND user_id IN (SELECT user_id FROM user_roles WHERE role_id = $1)`, [roleId, actor.id]);
      await this.audit.log(c, { userId: actor.id, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'role', entityId: roleId, ip, details: { role: role.code, before, after: permissions } });
    });
  }

  // ---------------------------------------------------------------------------

  private async snapshot(c: pg.PoolClient, userId: number) {
    const { rows: [u] } = await c.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.org_wide,
              COALESCE((SELECT array_agg(role_id ORDER BY role_id) FROM user_roles WHERE user_id = u.id), '{}') AS role_ids,
              COALESCE((SELECT array_agg(substation_id ORDER BY substation_id) FROM user_substation_assignments WHERE user_id = u.id), '{}') AS substation_ids
         FROM users u WHERE u.id = $1 FOR UPDATE`, [userId]);
    if (!u) throw notFound('User');
    return { ...u, role_ids: u.role_ids.map(Number), substation_ids: u.substation_ids.map(Number) } as {
      is_active: boolean; org_wide: boolean; role_ids: number[]; substation_ids: number[]; [k: string]: unknown;
    };
  }

  /** Anti-escalation: an actor can only grant roles whose permissions they hold, and org-wide scope only if they have it. */
  private async assertGrantable(c: pg.PoolClient, actor: AuthUser, input: UserInput, before?: { role_ids: number[]; org_wide: boolean }) {
    if (before) await this.assertCanManage(c, actor, (before as any).id);
    if (input.orgWide && !actor.orgWide && !before?.org_wide) throw forbidden('Only organization-wide administrators can grant organization-wide scope');
    if (!input.orgWide && !input.substationIds.length) throw badRequest('Assign at least one substation or organization-wide scope');
    const { rows: roles } = await c.query(
      `SELECT r.id, r.name, COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS perms
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE r.id = ANY($1) GROUP BY r.id`, [input.roleIds]);
    if (roles.length !== new Set(input.roleIds).size) throw badRequest('Unknown role');
    const newlyGranted = roles.filter((r) => !before?.role_ids.includes(r.id));
    for (const r of newlyGranted) {
      if (!(r.perms as Permission[]).every((p) => actor.permissions.has(p))) {
        throw forbidden(`You cannot grant the ${r.name} role because it includes permissions you do not hold`);
      }
    }
    if (input.substationIds.length) {
      const { rows } = await c.query('SELECT count(*) AS n FROM substations WHERE id = ANY($1)', [input.substationIds]);
      if (rows[0].n !== new Set(input.substationIds).size) throw badRequest('Unknown substation');
    }
  }

  /** Non-super admins cannot modify accounts that hold permissions they lack (e.g. a Super Administrator). */
  private async assertCanManage(c: pg.PoolClient, actor: AuthUser, targetId: number) {
    const { rows } = await c.query(
      `SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`,
      [targetId]);
    if (!rows.every((r) => actor.permissions.has(r.permission_code))) {
      throw forbidden('You cannot modify a user who holds permissions you do not have');
    }
  }

  private async writeAssignments(c: pg.PoolClient, userId: number, input: UserInput) {
    if (input.roleIds.length) {
      await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [userId, input.roleIds]);
    }
    if (input.substationIds.length) {
      await c.query('INSERT INTO user_substation_assignments (user_id, substation_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING',
        [userId, input.substationIds]);
    }
  }
}

function sameSet(a: number[], b: number[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
