// Thin fetch wrapper: same-origin cookies, CSRF header on writes, typed errors.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let csrfToken = '';
let onUnauthenticated: () => void = () => {};

export function setCsrfToken(token: string) { csrfToken = token; }
export function setUnauthenticatedHandler(fn: () => void) { onUnauthenticated = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error — check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthenticated();
    const details = Array.isArray(data.details) ? data.details : undefined;
    const msg = details?.length
      ? `${data.message}: ${details.map((d: any) => `${d.path ? `${d.path} — ` : ''}${d.message}`).join('; ')}`
      : data.message;
    throw new ApiError(res.status, data.code ?? 'ERROR', msg || `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
};

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export const newIdempotencyKey = () => crypto.randomUUID();
