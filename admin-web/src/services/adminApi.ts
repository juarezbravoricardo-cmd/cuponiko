/**
 * Cliente tipado de los endpoints /api/admin/*.
 *
 * Endpoints disponibles (verificados contra `api/src/routes/admin.js`):
 *   GET    /api/admin/businesses?status&search&page
 *   PATCH  /api/admin/businesses/:id/suspend
 *   PATCH  /api/admin/businesses/:id/activate
 *   GET    /api/admin/alerts
 *   PATCH  /api/admin/alerts/:id/resolve
 *   PATCH  /api/admin/users/:id/block
 *   GET    /api/admin/metrics
 */

import { api } from './api';

export type BusinessStatus = 'active' | 'suspended' | 'inactive';

export interface AdminBusiness {
  business_id: number;
  business_name: string;
  category: string;
  status: BusinessStatus;
  plan: 'free' | 'premium';
  active_coupons_count: number;
  display_address: string | null;
  owner: {
    user_id: number;
    full_name: string;
    email: string;
  };
  created_at: string;
}

export interface BusinessesPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface BusinessesPage {
  businesses: AdminBusiness[];
  pagination: BusinessesPagination;
}

export type AlertSeverity = 'low' | 'medium' | 'high';
export type AlertStatus = 'open' | 'resolved';
export type AlertResolveAction = 'ignore' | 'block_consumer' | 'suspend_business';

export interface AdminAlert {
  alert_id: number;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  description: string;
  created_at: string;
  resolved_at: string | null;
  context: {
    business_id?: number;
    business_name?: string;
    consumer_id?: number;
    consumer_name?: string;
    coupon_id?: number;
  };
}

export interface AdminMetrics {
  active_users: number;
  active_businesses: number;
  coupons_created: number;
  coupons_redeemed: number;
  redemption_rate: number;
  mrr: number;
  premium_count: number;
  generated_at: string;
}

// ────────────────────────────────────────────────────────────
// Negocios
// ────────────────────────────────────────────────────────────
export async function listBusinesses(params: {
  status?: BusinessStatus | 'all';
  search?: string;
  page?: number;
} = {}): Promise<BusinessesPage> {
  const r = await api.get('/api/admin/businesses', {
    params: {
      status: params.status && params.status !== 'all' ? params.status : undefined,
      search: params.search || undefined,
      page: params.page ?? 1,
    },
  });
  return r.data.data as BusinessesPage;
}

export async function suspendBusiness(id: number, reason?: string): Promise<{ business_id: number; status: BusinessStatus }> {
  const r = await api.patch(`/api/admin/businesses/${id}/suspend`, { reason: reason ?? null });
  return r.data.data;
}

export async function activateBusiness(id: number): Promise<{ business_id: number; status: BusinessStatus }> {
  const r = await api.patch(`/api/admin/businesses/${id}/activate`);
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// Alertas
// ────────────────────────────────────────────────────────────
export async function listAlerts(params: {
  status?: AlertStatus | 'all';
  severity?: AlertSeverity | 'all';
  page?: number;
} = {}): Promise<{ alerts: AdminAlert[]; pagination: BusinessesPagination }> {
  const r = await api.get('/api/admin/alerts', {
    params: {
      status: params.status && params.status !== 'all' ? params.status : undefined,
      severity: params.severity && params.severity !== 'all' ? params.severity : undefined,
      page: params.page ?? 1,
    },
  });
  return r.data.data;
}

export async function resolveAlert(
  id: number,
  action: AlertResolveAction,
  notes?: string
): Promise<{ alert_id: number; status: AlertStatus; action: AlertResolveAction }> {
  const r = await api.patch(`/api/admin/alerts/${id}/resolve`, { action, notes: notes ?? null });
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// Bloqueo de usuarios consumidores
// ────────────────────────────────────────────────────────────
export async function blockUser(
  id: number,
  reason?: string
): Promise<{ user_id: number; blocked: boolean }> {
  const r = await api.patch(`/api/admin/users/${id}/block`, { reason: reason ?? null });
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// Métricas globales
// ────────────────────────────────────────────────────────────
export async function fetchMetrics(): Promise<AdminMetrics> {
  const r = await api.get('/api/admin/metrics');
  return r.data.data as AdminMetrics;
}
