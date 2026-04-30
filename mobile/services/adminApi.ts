/**
 * Cliente API admin (web standalone). Reutiliza axios `api` configurado.
 * Para el admin web standalone se debe re-exportar `api` apuntando a misma BASE_URL.
 */

import { api } from './api';

export type AdminBusiness = {
  id: number;
  business_name: string;
  category: string;
  plan: 'free' | 'premium';
  status: 'active' | 'inactive' | 'suspended';
  owner_email: string;
  owner_name: string;
  active_coupons: number;
  created_at: string;
};

export type AdminAlert = {
  id: number;
  type: string;
  severity: string;
  description: string;
  consumer_id: number | null;
  business_id: number | null;
  resolved: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
};

export type GlobalMetrics = {
  total_users: number;
  active_businesses: number;
  coupons_created: number;
  coupons_redeemed: number;
  redemption_rate: number;
  mrr: number;
};

export async function listBusinessesAdmin(params: { status?: string; search?: string; page?: number }) {
  const r = await api.get('/api/admin/businesses', { params });
  return r.data.data as { page: number; page_size: number; businesses: AdminBusiness[] };
}

export async function suspendBusiness(id: number) {
  const r = await api.patch(`/api/admin/businesses/${id}/suspend`);
  return r.data.data as { business_id: number; status: string; affected_consumers: number; message: string };
}

export async function activateBusiness(id: number) {
  const r = await api.patch(`/api/admin/businesses/${id}/activate`);
  return r.data.data as { business_id: number; status: string };
}

export async function listAlertsAdmin(params: { resolved?: boolean; type?: string; page?: number }) {
  const r = await api.get('/api/admin/alerts', { params });
  return r.data.data as { page: number; page_size: number; alerts: AdminAlert[] };
}

export async function resolveAlertAdmin(
  id: number,
  body: { action: 'ignore' | 'block_consumer' | 'suspend_business'; consumer_id?: number; business_id?: number }
) {
  const r = await api.patch(`/api/admin/alerts/${id}/resolve`, body);
  return r.data.data as { alert_id: number; action: string; resolved: boolean };
}

export async function blockUserAdmin(userId: number) {
  const r = await api.patch(`/api/admin/users/${userId}/block`);
  return r.data.data as { user_id: number; is_active: boolean; message: string };
}

export async function reportFraudFromBusiness(body: {
  consumer_id?: number;
  coupon_id?: number;
  description: string;
}) {
  const r = await api.post('/api/alerts/report', body);
  return r.data.data;
}

export async function fetchGlobalMetrics(): Promise<GlobalMetrics> {
  const r = await api.get('/api/admin/metrics');
  return r.data.data;
}
