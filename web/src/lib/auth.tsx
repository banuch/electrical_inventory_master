import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken, setUnauthenticatedHandler } from './api';

export interface Me {
  id: number;
  username: string;
  fullName: string;
  orgWide: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  substations: { id: number; code: string; name: string }[];
  csrfToken: string;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
  /** Currently selected working substation (persisted per browser). */
  substationId: number | null;
  setSubstationId: (id: number) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const SUB_KEY = 'cmg.substation';

function readStoredSub(): number | null {
  try { return Number(localStorage.getItem(SUB_KEY)) || null; } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [substationId, setSub] = useState<number | null>(readStoredSub);

  const accept = useCallback((m: Me | null) => {
    setMe(m);
    setCsrfToken(m?.csrfToken ?? '');
    if (m) {
      setSub((cur) => (cur && m.substations.some((s) => s.id === cur) ? cur : m.substations[0]?.id ?? null));
    }
  }, []);

  const refresh = useCallback(async () => {
    try { accept(await api.get<Me>('/auth/me')); } catch (e) {
      if (e instanceof ApiError && e.status === 401) accept(null); else throw e;
    }
  }, [accept]);

  useEffect(() => {
    setUnauthenticatedHandler(() => { accept(null); qc.clear(); });
    refresh().catch(() => {}).finally(() => setLoading(false));
  }, [refresh, accept, qc]);

  const value = useMemo<AuthState>(() => ({
    me,
    loading,
    login: async (username, password) => {
      const m = await api.post<Me>('/auth/login', { username, password });
      qc.clear();
      accept(m);
      return m;
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => {});
      accept(null);
      qc.clear();
    },
    refresh,
    can: (perm) => !!me?.permissions.includes(perm),
    substationId,
    setSubstationId: (id) => {
      setSub(id);
      try { localStorage.setItem(SUB_KEY, String(id)); } catch { /* storage unavailable */ }
    },
  }), [me, loading, refresh, substationId, accept, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
