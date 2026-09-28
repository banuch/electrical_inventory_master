import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { AppError, forbidden } from '../common/errors.js';
import { SESSION_COOKIE } from '../config.js';
import { AuthService } from './auth.service.js';
import {
  ALLOW_PENDING_PASSWORD, IS_PUBLIC, REQUIRED_PERMISSIONS, type AuthedRequest,
} from './auth-user.js';
import type { Permission } from './permissions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Global guard: session authentication, CSRF (synchronizer token in X-CSRF-Token header),
 * forced password change, and permission checks. Substation scope is enforced in services.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === 'string' && token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header('x-csrf-token') ?? '';
      if (!safeEqual(header, user.csrfToken)) throw new AppError(403, 'CSRF', 'Invalid or missing CSRF token');
    }

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing');
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (!required.every((p) => user.permissions.has(p))) throw forbidden();

    req.user = user;
    return true;
  }
}
