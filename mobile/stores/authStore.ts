import { create } from 'zustand';
import { decode as atob } from 'base-64';
import { api, tokenStore, extractApiError } from '@/services/api';

export type Role = 'consumer' | 'business' | 'admin';

export interface AuthUser {
  id: number;
  role: Role;
  email: string;
  full_name: string;
}

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  loading: boolean;

  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthUser>;
  loginWithGoogle: (googleToken: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  loading: false,

  setUser: (u) => set({ user: u }),

  hydrate: async () => {
    const t = await tokenStore.getAccess();
    if (!t) {
      set({ hydrated: true });
      return;
    }
    try {
      // Sin endpoint /me en Fase 1, parseamos el JWT (sub+role+email) a vuelo.
      // React Native no expone `Buffer` global; usamos `base-64.atob` para
      // mantener compatibilidad con builds nativos sin polyfills extra.
      const [, payloadB64] = t.split('.');
      const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
      // atob ya devuelve UTF-8 binario; JSON.parse no soporta bytes raw,
      // pero los JWT de Cuponiko solo contienen ASCII en el payload.
      const payload = JSON.parse(atob(normalized));
      set({
        user: {
          id: Number(payload.sub),
          role: payload.role,
          email: payload.email,
          full_name: payload.full_name || '',
        },
        hydrated: true,
      });
    } catch {
      await tokenStore.clear();
      set({ hydrated: true, user: null });
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const r = await api.post('/api/auth/login', { email, password });
      const { access_token, refresh_token, user } = r.data.data;
      await tokenStore.set(access_token, refresh_token);
      set({ user });
      return user as AuthUser;
    } catch (err) {
      throw extractApiError(err);
    } finally {
      set({ loading: false });
    }
  },

  loginWithGoogle: async (googleToken) => {
    set({ loading: true });
    try {
      const r = await api.post('/api/auth/login/google', { google_token: googleToken });
      const { access_token, refresh_token, user } = r.data.data;
      await tokenStore.set(access_token, refresh_token);
      set({ user });
      return user as AuthUser;
    } catch (err) {
      throw extractApiError(err);
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await tokenStore.clear();
    set({ user: null });
  },
}));
