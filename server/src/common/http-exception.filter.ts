import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { pgCode } from './errors.js';

const PG_ERRORS: Record<string, [number, string, string]> = {
  '23505': [409, 'CONFLICT', 'A record with the same unique value already exists'],
  '23514': [422, 'CONSTRAINT_VIOLATION', 'The operation violates a data rule'],
  '23503': [409, 'REFERENCED', 'The record is referenced by other data'],
  '23001': [409, 'IMMUTABLE', 'Posted records cannot be modified'],
  '40P01': [503, 'RETRY', 'The system is busy, please retry'],
  '40001': [503, 'RETRY', 'The system is busy, please retry'],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const payload = typeof body === 'string'
        ? { code: 'ERROR', message: body }
        : { code: (body as any).code ?? (body as any).error ?? 'ERROR', message: (body as any).message, details: (body as any).details };
      res.status(exception.getStatus()).json(payload);
      return;
    }
    const mapped = PG_ERRORS[pgCode(exception) ?? ''];
    if (mapped) {
      const [status, code, message] = mapped;
      res.status(status).json({ code, message });
      return;
    }
    // Never leak internals (SQL, stack traces) to clients.
    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    res.status(500).json({ code: 'INTERNAL', message: 'An unexpected error occurred' });
  }
}
