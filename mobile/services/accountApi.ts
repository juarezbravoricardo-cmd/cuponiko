/**
 * Cliente API mobile para eliminación de cuenta (ACCT-01, ACCT-02) — Fase 3.5.
 * Flujo de 2 pasos: requestDelete() → backend manda código por email →
 * confirmDelete(code) → cuenta marcada inactiva en cascada (suspende negocio
 * y caduca cupones si aplica).
 */

import { api } from './api';

export interface RequestDeleteResponse {
  message: string;
  expires_in_minutes: number;
}

export interface ConfirmDeleteResponse {
  message: string;
  account_deleted: boolean;
}

// ────────────────────────────────────────────────────────────
// ACCT-01: POST /api/account/delete
// ────────────────────────────────────────────────────────────
export async function requestDelete(reason?: string): Promise<RequestDeleteResponse> {
  const r = await api.post('/api/account/delete', { reason: reason ?? null });
  return r.data.data as RequestDeleteResponse;
}

// ────────────────────────────────────────────────────────────
// ACCT-02: POST /api/account/delete/confirm
// ────────────────────────────────────────────────────────────
export async function confirmDelete(code: string): Promise<ConfirmDeleteResponse> {
  const r = await api.post('/api/account/delete/confirm', { code });
  return r.data.data as ConfirmDeleteResponse;
}
