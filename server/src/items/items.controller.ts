import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import { boolQuery, id, optionalId, optionalText, pageQuery, parse, reqText, text } from '../common/validation.js';
import { ItemsService } from './items.service.js';

const itemSchema = z.object({
  code: reqText(40).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, 'Letters, digits and . _ / - only'),
  name: reqText(200),
  description: text(2000).default(''),
  categoryId: id,
  unitId: id,
  specification: text(500).default(''),
  rating: text(100).default(''),
  manufacturer: text(150).default(''),
  model: text(150).default(''),
  isCritical: z.boolean().default(false),
  isActive: z.boolean().default(true),
  aliases: z.array(z.string().max(200)).max(20).default([]),
});

const categorySchema = z.object({
  code: reqText(40).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, _ and - only'),
  name: reqText(120),
  parentId: optionalId,
  isActive: z.boolean().default(true),
});

const unitSchema = z.object({
  code: reqText(20).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  name: reqText(60),
  decimalPlaces: z.number().int().min(0).max(4),
  isActive: z.boolean().default(true),
});

@Controller()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('items')
  list(@Query() query: unknown) {
    return this.items.list(parse(pageQuery.extend({ q: optionalText(100), categoryId: optionalId, active: boolQuery }), query));
  }

  @Get('items/similar')
  similar(@Query() query: unknown) {
    const q = parse(z.object({ name: z.string().max(200).default(''), code: optionalText(40), excludeId: optionalId }), query);
    return this.items.similar(q.name, q.code, q.excludeId);
  }

  @Get('items/:id')
  get(@Param('id') itemId: string) {
    return this.items.get(parse(id, itemId));
  }

  @RequirePermissions('master.items')
  @Post('items')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.create(user, parse(itemSchema, body), ip);
  }

  @RequirePermissions('master.items')
  @Put('items/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') itemId: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.update(user, parse(id, itemId), parse(itemSchema, body), ip);
  }

  @Get('categories')
  categories() {
    return this.items.categories();
  }

  @RequirePermissions('master.items')
  @Post('categories')
  createCategory(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.saveCategory(user, null, parse(categorySchema, body), ip);
  }

  @RequirePermissions('master.items')
  @Put('categories/:id')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id') cid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.saveCategory(user, parse(id, cid), parse(categorySchema, body), ip);
  }

  @Get('units')
  units() {
    return this.items.units();
  }

  @RequirePermissions('master.items')
  @Post('units')
  createUnit(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.saveUnit(user, null, parse(unitSchema, body), ip);
  }

  @RequirePermissions('master.items')
  @Put('units/:id')
  updateUnit(@CurrentUser() user: AuthUser, @Param('id') uid: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.items.saveUnit(user, parse(id, uid), parse(unitSchema, body), ip);
  }
}
