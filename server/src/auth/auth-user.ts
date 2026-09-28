import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { forbidden } from '../common/errors.js';
import type { Permission } from './permissions.js';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  orgWide: boolean;
  mustChangePassword: boolean;
  permissions: Set<Permission>;
  substationIds: number[];
  sessionId: string;
  csrfToken: string;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

/** Route needs no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires ALL listed permissions. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);
/** Route is reachable while the user still has to change a temporary password. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().ip ?? null;
});

export function hasPermission(user: AuthUser, perm: Permission): boolean {
  return user.permissions.has(perm);
}

export function requirePermission(user: AuthUser, perm: Permission): void {
  if (!user.permissions.has(perm)) throw forbidden();
}

export function inScope(user: AuthUser, substationId: number): boolean {
  return user.orgWide || user.substationIds.includes(substationId);
}

/** Object-level authorization: user must hold perm AND have the substation in scope. */
export function requireScope(user: AuthUser, substationId: number, perm?: Permission): void {
  if (perm) requirePermission(user, perm);
  if (!inScope(user, substationId)) throw forbidden('This substation is outside your assigned scope');
}

/** SQL helper: null means "no restriction" (org-wide). */
export function scopeIds(user: AuthUser): number[] | null {
  return user.orgWide ? null : user.substationIds;
}
