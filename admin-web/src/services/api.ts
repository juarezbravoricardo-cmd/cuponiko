/**
 * Cliente HTTP del admin-web.
 *
 * Analogía: el "intercomunicador" del edificio. Toda petición pasa por aquí
 * y el sistema añade el JWT actual; si el backend devuelve 401 con
 * `error_code: 'TOKEN_EXPIRED'` intenta una vez refrescar y reintenta.
 *
 * Persistencia de tokens: localStorage (navegador). Para una app admin que
 * vive solo en máquinas controladas del equipo es aceptable; en mobile se
 * usa SecureStore. Si el equipo crece, considerar httpOnly cookies + endpoint
 * de sesión.
 */

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.cuponiko.com';

const STORAGE_ACCESS = 'cuponiko_admin_access';
const STORAGE_REFRESH = 'cuponiko_admin_refresh';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(STORAGE_ACCESS);
  },
  get refresh(): string | null {
    return localStorage.getItem(STORAGE_REFRESH);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(STORAGE_ACCESS, access);
    localStorage.setItem(STORAGE_REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(STORAGE_ACCESS);
    localStorage.removeItem(STORAGE_REFRESH);
  },
};

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const t = tokenStore.access;
  if (t) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${t}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const refresh = tokenStore.refresh;
  if (!refresh) return null;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const r = await axios.post(
        `${BASE_URL}/api/auth/refresh`,
        { refresh_token: refresh },
        { timeout: 15000 }
      );
      const access = r.data?.data?.access_token;
      const newRefresh = r.data?.data?.refresh_token ?? refresh;
      if (access) {
        tokenStore.set(access, newRefresh);
        return access as string;
      }
      return null;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError<{ error_code?: string }>) => {
    const original = err.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = err.response?.status;
    const code = err.response?.data?.error_code;
    if (status === 401 && code === 'TOKEN_EXPIRED' && original && !original._retry) {
      original._retry = true;
      const access = await tryRefresh();
      if (access) {
        original.headers = original.headers || {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${access}`;
        return api.request(original);
      }
    }
    return Promise.reject(err);
  }
);

export function extractApiError(e: unknown): { error: string; error_code?: string; status?: number } {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string; error_code?: string } | undefined;
    return {
      error: data?.error || e.message || 'Error de red',
      error_code: data?.error_code,
      status: e.response?.status,
    };
  }
  return { error: e instanceof Error ? e.message : 'Error desconocido' };
}
