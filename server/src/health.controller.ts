import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth-user.js';
import { DbService } from './db/db.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}
