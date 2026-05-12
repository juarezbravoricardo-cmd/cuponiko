/**
 * Cliente API mobile para Notificaciones (NOTIFY-01..04) — Fase 3.5.
 * Wraps thin sobre `api` (axios) ya autenticado con JWT y refresh automático.
 *
 * Mensajes de error se reciben literales del backend; usar `extractApiError`.
 */

import { api } from './api';

export type NotificationType =
  | 'business_broadcast'
  | 'export_ready'
  | 'coupon_expiring'
  | 'loyalty_completed'
  | 'reward_redeemed'
  | string;

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface NotificationsPage {
  notifications: NotificationItem[];
  pagination: NotificationsPagination;
}

export type PushPlatform = 'ios' | 'android';

export type NotificationSegment = 'all' | 'active' | 'inactive' | 'frequent';

export interface SendSegmentResponse {
  sent_to: number;
  segment: NotificationSegment;
  message: string;
}

// ────────────────────────────────────────────────────────────
// NOTIFY-01: GET /api/notifications
// ────────────────────────────────────────────────────────────
export async function fetchNotifications(params: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<NotificationsPage> {
  const r = await api.get('/api/notifications', {
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      unread_only: params.unreadOnly ? 'true' : undefined,
    },
  });
  return r.data.data as NotificationsPage;
}

// ────────────────────────────────────────────────────────────
// NOTIFY-02: PATCH /api/notifications/:id/read
// ────────────────────────────────────────────────────────────
export async function markAsRead(id: number): Promise<{ id: number; read: boolean }> {
  const r = await api.patch(`/api/notifications/${id}/read`);
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// NOTIFY-03: POST /api/push/token
// ────────────────────────────────────────────────────────────
export async function registerPushToken(
  push_token: string,
  platform: PushPlatform
): Promise<{ push_token_saved: boolean }> {
  const r = await api.post('/api/push/token', { push_token, platform });
  return r.data.data;
}

/**
 * "Desregistrar" el token = enviar string vacío al backend NO es válido
 * (el contrato requiere string no vacío). En la práctica se borra del
 * lado del dispositivo y, si el backend recibe otro device del mismo
 * usuario, sustituye automáticamente. Aquí ofrecemos un best-effort:
 * si el caller realmente quiere "desactivar", lo manejamos local.
 */
export async function unregisterPushTokenLocal(): Promise<void> {
  // No hay endpoint específico; quedará a cargo del consumidor del cliente
  // limpiar SecureStore/AsyncStorage. Función incluida para mantener
  // simetría con `registerPushToken` desde la UI de profile.
  return;
}

// ────────────────────────────────────────────────────────────
// NOTIFY-04: POST /api/notifications/send (Premium)
// ────────────────────────────────────────────────────────────
export async function sendToSegment(
  segment: NotificationSegment,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<SendSegmentResponse> {
  const r = await api.post('/api/notifications/send', {
    segment,
    title,
    body,
    data: data ?? {},
  });
  return r.data.data as SendSegmentResponse;
}
