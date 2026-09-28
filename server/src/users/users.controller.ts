import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import type { Permission } from '../auth/permissions.js';
import { boolQuery, id, optionalId, optionalText, pageQuery, parse, reqText, text } from '../common/validation.js';
import { UsersService } from './users.service.js';

const userSchema = z.object({
  username: reqText(60).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  fullName: reqText(150),
  email: text(200).default('').refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
  phone: text(50).default(''),
  isActive: z.boolean().default(true),
  orgWide: z.boolean().default(false),
  roleIds: z.array(id).min(1, 'Assign at least one role').max(10),
  substationIds: z.array(id).max(500).default([]),
});

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('admin.users')
  @Get('users')
  list(@Query() query: unknown) {
    return this.users.list(parse(pageQuery.extend({
      q: optionalText(100), roleId: optionalId, substationId: optionalId, active: boolQuery,
    }), query));
  }

  @RequirePermissions('admin.users')
  @Post('users')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { password, ...input } = parse(userSchema.extend({ password: z.string().min(1).max(200) }), body);
    return this.users.create(actor, input, password, ip);
  }

  @RequirePermissions('admin.users')
  @Put('users/:id')
  update(@CurrentUser() actor: AuthUser, @Param('id') uid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.users.update(actor, parse(id, uid), parse(userSchema, body), ip);
  }

  @RequirePermissions('admin.users')
  @Post('users/:id/reset-password')
  @HttpCode(204)
  async resetPassword(@CurrentUser() actor: AuthUser, @Param('id') uid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), body);
    await this.users.resetPassword(actor, parse(id, uid), password, ip);
  }

  @RequirePermissions('admin.users')
  @Get('roles')
  roles() {
    return this.users.roles();
  }

  @RequirePermissions('admin.users')
  @Get('permissions')
  permissions() {
    return this.users.permissions();
  }

  @RequirePermissions('admin.roles')
  @Put('roles/:id/permissions')
  @HttpCode(204)
  async setRolePermissions(@CurrentUser() actor: AuthUser, @Param('id') rid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { permissions } = parse(z.object({ permissions: z.array(z.string()).max(100) }), body);
    await this.users.setRolePermissions(actor, parse(id, rid), permissions as Permission[], ip);
  }
}
