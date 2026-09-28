import 'dotenv/config';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env var ${name}`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3000),
  host: process.env.HOST ?? '127.0.0.1',
  /** Express trust-proxy setting: which reverse proxies may set X-Forwarded-For (for client IPs in audit logs). */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://cmg:cmg_dev_password@127.0.0.1:5433/cmg_inventory',
  sessionIdleMinutes: num('SESSION_IDLE_MINUTES', 30),
  sessionAbsoluteHours: num('SESSION_ABSOLUTE_HOURS', 12),
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  maxFailedLogins: num('MAX_FAILED_LOGINS', 5),
  lockoutMinutes: num('LOCKOUT_MINUTES', 15),
};

export const SESSION_COOKIE = 'cmg_sid';
