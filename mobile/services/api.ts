import axios, { AxiosError, AxiosInstance } from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const BASE_URL =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ||
  'https://api.cuponiko.com';

const ACCESS_KEY = 'cuponiko.access_token';
const REFRESH_KEY = 'cuponiko.refresh_token';

export const tokenStore = {
  async getAccess() {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },
  async getRefresh() {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async set(access: string, refresh: string) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const t = await tokenStore.getAccess();
  if (t) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${t}`;
  }
  return config;
});

// Refresh automático ante 401 (una sola reintentona por request).
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = await tokenStore.getRefresh();
    if (!rt) return false;
    try {
      const r = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: rt });
      const { access_token, refresh_token } = r.data.data;
      await tokenStore.set(access_token, refresh_token);
      return true;
    } catch {
      await tokenStore.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      const ok = await tryRefresh();
      if (ok) return api.request(original);
    }
    return Promise.reject(error);
  }
);

export type ApiError = { error: string; code: string; details?: unknown };

export function extractApiError(err: unknown): ApiError {
  const ax = err as AxiosError<{ error: string; code: string }>;
  if (ax?.response?.data && typeof ax.response.data === 'object') {
    return ax.response.data as ApiError;
  }
  return { error: 'Ocurrió un error. Intenta de nuevo.', code: 'UNKNOWN' };
}
