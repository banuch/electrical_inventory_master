import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import { AuditService } from '../audit/audit.service.js';
import { DbService } from '../db/db.service.js';
import { conflict, notFound, pgCode } from '../common/errors.js';
import { boolQuery, id, parse, reqText, text } from '../common/validation.js';

const substationSchema = z.object({
  code: reqText(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, _ and - only'),
  name: reqText(150),
  address: text(500).default(''),
  contactName: text(150).default(''),
  contactPhone: text(50).default(''),
  isActive: z.boolean().default(true),
});

@Controller('substations')
export class SubstationsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /** Directory of substations (names/contacts) — visible to every signed-in user for transfer coordination. */
  @Get()
  async list(@Query('active') active?: string) {
    const onlyActive = parse(boolQuery, active);
    const { rows } = await this.db.query(
      `SELECT s.id, s.code, s.name, s.address, s.contact_name, s.contact_phone, s.is_active,
              (SELECT count(*) FROM user_substation_assignments a WHERE a.substation_id = s.id) AS user_count,
              (SELECT max(b.last_txn_at) FROM inventory_balances b WHERE b.substation_id = s.id) AS last_activity_at
         FROM substations s
        WHERE ($1::bool IS NULL OR s.is_active = $1)
        ORDER BY s.code`, [onlyActive ?? null]);
    return rows;
  }

  @RequirePermissions('master.substations')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.save(user, null, parse(substationSchema, body), ip);
  }

  @RequirePermissions('master.substations')
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') sid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.save(user, parse(id, sid), parse(substationSchema, body), ip);
  }

  private async save(user: AuthUser, sid: number | null, s: z.infer<typeof substationSchema>, ip: string | null) {
    try {
      return await this.db.tx(async (c) => {
        const before = sid ? (await c.query('SELECT * FROM substations WHERE id = $1', [sid])).rows[0] : null;
        if (sid && !before) throw notFound('Substation');
        const { rows: [row] } = sid
          ? await c.query(
            `UPDATE substations SET code = $2, name = $3, address = $4, contact_name = $5, contact_phone = $6,
               is_active = $7, updated_at = now() WHERE id = $1 RETURNING id`,
            [sid, s.code.toUpperCase(), s.name, s.address, s.contactName, s.contactPhone, s.isActive])
          : await c.query(
            `INSERT INTO substations (code, name, address, contact_name, contact_phone, is_active)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [s.code.toUpperCase(), s.name, s.address, s.contactName, s.contactPhone, s.isActive]);
        await this.audit.log(c, {
          userId: user.id, action: sid ? 'SUBSTATION_UPDATED' : 'SUBSTATION_CREATED', entityType: 'substation',
          entityId: row.id, substationId: row.id, ip, details: { before, after: s },
        });
        return { id: row.id };
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict(`Substation code ${s.code.toUpperCase()} already exists`);
      throw err;
    }
  }
}
