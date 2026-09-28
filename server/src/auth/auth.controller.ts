import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { parse } from '../common/validation.js';
import { config, SESSION_COOKIE } from '../config.js';
import { AuthService } from './auth.service.js';
import { AllowPendingPassword, ClientIp, CurrentUser, Public, type AuthUser } from './auth-user.js';
import { DbService } from '../db/db.service.js';

const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

/** Simple in-memory sliding-window limiter for the login endpoint (per IP). */
class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return recent.length <= this.limit;
  }
}

@Controller('auth')
export class AuthController {
  private readonly limiter = new RateLimiter(20, 5 * 60_000);

  constructor(private readonly auth: AuthService, private readonly db: DbService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip ?? null;
    if (!this.limiter.allow(ip ?? 'unknown')) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Please wait a few minutes.');
    }
    const { username, password } = parse(loginSchema, body);
    const { token } = await this.auth.login(username, password, ip, req.header('user-agent') ?? null);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/',
      maxAge: config.sessionAbsoluteHours * 3600_000,
    });
    const user = await this.auth.resolveSession(token);
    return this.profile(user!);
  }

  @AllowPendingPassword()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.profile(user);
  }

  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { currentPassword, newPassword } = parse(changeSchema, body);
    await this.auth.changePassword(user, currentPassword, newPassword, ip);
  }

  private async profile(user: AuthUser) {
    const { rows: substations } = await this.db.query(
      `SELECT id, code, name FROM substations WHERE is_active AND ($1::bool OR id = ANY($2)) ORDER BY code`,
      [user.orgWide, user.substationIds]);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      orgWide: user.orgWide,
      mustChangePassword: user.mustChangePassword,
      permissions: [...user.permissions].sort(),
      substations,
      csrfToken: user.csrfToken,
    };
  }
}
