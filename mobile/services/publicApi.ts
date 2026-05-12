/**
 * Cliente API mobile para endpoints públicos (BIZ-01, CPN-08) — Fase 3.5.
 *
 * Sin JWT requerido. Usado para deeplinks y vistas previas de cupones/negocios
 * para usuarios no autenticados. Los IDs internos sensibles (stripe_*, user_id,
 * uses_count crudo) NO se exponen aquí.
 */

import axios from 'axios';
import Constants from 'expo-constants';

const BASE_URL =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ||
  'https://api.cuponiko.com';

const publicHttp = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

export interface PublicBusiness {
  id: number;
  business_name: string;
  category: string;
  display_address: string | null;
  lat: number | null;
  lng: number | null;
  logo_url: string | null;
  active_coupons_count: number;
  has_loyalty_program: boolean;
  created_at: string;
}

export interface PublicCoupon {
  id: number;
  title: string;
  description: string | null;
  discount_type: 'percent' | 'fixed' | '2x1' | 'free';
  discount_value: number;
  precio_referencia: number | null;
  start_date: string;
  end_date: string;
  remaining_uses: number;
  is_ad_exclusive: boolean;
  business: {
    id: number;
    business_name: string;
    category: string;
    logo_url: string | null;
  };
}

// ────────────────────────────────────────────────────────────
// BIZ-01: GET /api/businesses/:id/public
// ────────────────────────────────────────────────────────────
export async function fetchPublicBusiness(id: number): Promise<PublicBusiness> {
  const r = await publicHttp.get(`/api/businesses/${id}/public`);
  return r.data.data as PublicBusiness;
}

// ────────────────────────────────────────────────────────────
// CPN-08: GET /api/coupons/:id/public
// ────────────────────────────────────────────────────────────
export async function fetchPublicCoupon(id: number): Promise<PublicCoupon> {
  const r = await publicHttp.get(`/api/coupons/${id}/public`);
  return r.data.data as PublicCoupon;
}
