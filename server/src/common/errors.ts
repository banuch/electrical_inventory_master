import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', message, details);
export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(HttpStatus.CONFLICT, 'CONFLICT', message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as any).code) : undefined;
}
export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err ? (err as any).constraint : undefined;
}
