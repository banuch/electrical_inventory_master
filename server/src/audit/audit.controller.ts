import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions, type AuthUser } from '../auth/auth-user.js';
import { forbidden } from '../common/errors.js';
import { boolQuery, optionalDate, optionalId, optionalText, pageQuery, parse } from '../common/validation.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
@RequirePermissions('audit.view')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.audit.list(user, parse(pageQuery.extend({
      userId: optionalId, substationId: optionalId, entityType: optionalText(60), entityId: optionalText(60),
      action: optionalText(60), from: optionalDate, to: optionalDate,
    }), query));
  }

  /** Login history is organization-level security data. */
  @Get('logins')
  logins(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    if (!user.orgWide) throw forbidden('Login history requires organization-wide scope');
    return this.audit.loginHistory(parse(pageQuery.extend({ userId: optionalId, success: boolQuery }), query));
  }
}
