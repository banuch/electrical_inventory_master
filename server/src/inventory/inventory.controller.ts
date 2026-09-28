import { Body, Controller, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import { boolQuery, id, optionalId, optionalText, pageQuery, parse } from '../common/validation.js';
import { InventoryService } from './inventory.service.js';

const searchSchema = pageQuery.extend({
  q: optionalText(100),
  categoryId: optionalId,
  critical: boolQuery,
  availableOnly: boolQuery.transform((v) => v ?? true),
  manufacturer: optionalText(100),
  rating: optionalText(100),
});

const balancesSchema = pageQuery.extend({
  q: optionalText(100),
  categoryId: optionalId,
  status: z.preprocess((v) => v || 'all', z.enum(['all', 'low', 'out', 'critical', 'in_stock'])),
});

const qtyString = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const levelsSchema = z.object({ minLevel: qtyString, reorderLevel: qtyString });

@Controller('inventory')
@RequirePermissions('inventory.view')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.inventory.search(user, parse(searchSchema, query));
  }

  @Get('items/:itemId/availability')
  availability(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string, @Query('includeZero') includeZero?: string) {
    return this.inventory.availability(user, parse(id, itemId), includeZero === 'true');
  }

  @Get('items/:itemId/transactions')
  transactions(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string, @Query() query: unknown) {
    return this.inventory.itemTransactions(user, parse(id, itemId), parse(pageQuery.extend({ substationId: optionalId }), query));
  }

  @Get('substations/:substationId/balances')
  balances(@CurrentUser() user: AuthUser, @Param('substationId') sid: string, @Query() query: unknown) {
    return this.inventory.substationBalances(user, parse(id, sid), parse(balancesSchema, query));
  }

  @Put('substations/:substationId/items/:itemId/levels')
  @HttpCode(204)
  async setLevels(@CurrentUser() user: AuthUser, @Param('substationId') sid: string, @Param('itemId') itemId: string,
    @Body() body: unknown, @ClientIp() ip: string | null) {
    const { minLevel, reorderLevel } = parse(levelsSchema, body);
    await this.inventory.setLevels(user, parse(id, sid), parse(id, itemId), minLevel, reorderLevel, ip);
  }
}
