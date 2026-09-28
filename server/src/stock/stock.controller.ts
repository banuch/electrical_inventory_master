import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import {
  id, isoDate, optionalDate, optionalId, optionalText, pageQuery, parse, text,
} from '../common/validation.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { MAX_LINES, POSTABLE_TYPES, StockPostingService } from './stock-posting.service.js';

const DOC_TYPES = [...POSTABLE_TYPES, 'REVERSAL'] as const;

const createSchema = z.object({
  docType: z.enum(POSTABLE_TYPES),
  substationId: id,
  docDate: isoDate,
  reasonCode: optionalText(40),
  referenceNo: text(100).default(''),
  counterparty: text(200).default(''),
  remarks: text(1000).default(''),
  idempotencyKey: z.uuid(),
  lines: z.array(z.object({
    itemId: id,
    quantity: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
    remarks: text(500).optional(),
  })).min(1).max(MAX_LINES),
});

const reverseSchema = z.object({ remarks: text(1000), idempotencyKey: z.uuid() });

const listSchema = pageQuery.extend({
  substationId: optionalId,
  itemId: optionalId,
  docType: z.preprocess((v) => v || undefined, z.enum(DOC_TYPES).optional()),
  status: z.preprocess((v) => v || undefined, z.enum(['POSTED', 'REVERSED']).optional()),
  from: optionalDate,
  to: optionalDate,
  q: optionalText(100),
});

@Controller('stock')
export class StockController {
  constructor(private readonly posting: StockPostingService, private readonly docs: StockDocumentsService) {}

  @RequirePermissions('inventory.view')
  @Get('documents')
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.docs.list(user, parse(listSchema, query));
  }

  @RequirePermissions('inventory.view')
  @Get('documents/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') docId: string) {
    return this.docs.get(user, parse(id, docId));
  }

  /** Permission depends on docType; enforced (with substation scope) inside the posting service. */
  @Post('documents')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.posting.post(user, parse(createSchema, body), ip);
  }

  @Post('documents/:id/reverse')
  reverse(@CurrentUser() user: AuthUser, @Param('id') docId: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.posting.reverse(user, parse(id, docId), parse(reverseSchema, body), ip);
  }

  @Get('reasons')
  reasons(@Query('docType') docType?: string) {
    return this.docs.reasons(docType || undefined);
  }
}
