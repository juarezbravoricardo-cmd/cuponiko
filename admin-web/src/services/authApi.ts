import { api, tokenStore } from './api';

export interface LoginResponse {
  user: { id: number; email: string; role: 'consumer' | 'business' | 'admin'; full_name: string };
  access_token: string;
  refresh_token: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const r = await api.post('/api/auth/login', { email, password });
  const data = r.data.data as LoginResponse;
  tokenStore.set(data.access_token, data.refresh_token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // tolerante: limpiamos el local aunque el backend falle.
  } finally {
    tokenStore.clear();
  }
}
