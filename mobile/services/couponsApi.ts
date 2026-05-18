/**
 * Cliente tipado para los endpoints de Fase 2.
 *
 * Analogía: el menú de un restaurante. Cada método aquí es un platillo
 * disponible en el backend; el componente solo escoge y el `api` se encarga
 * del JWT, refresh y manejo de errores estándar.
 *
 * Todos los endpoints parten del contrato `cuponiko_contratos_api_v1.md`.
 * No cambiar nombres ni shapes sin actualizar simultáneamente el backend.
 */

import { api } from './api';

// ────────────────────────────────────────────────────────────
// Tipos compartidos
// ────────────────────────────────────────────────────────────
export type DiscountType = 'percent' | 'fixed' | '2x1' | 'free';
export type CouponStatus = 'active' | 'paused' | 'paused_by_downgrade' | 'expired';
export type BusinessStatus = 'active' | 'suspended' | 'inactive';

export interface NearbyBusiness {
  business_id: number;
  business_name: string;
  category: string;
  logo_url: string | null;
  display_address: string | null;
  plan: 'free' | 'premium';
  lat: number;
  lng: number;
  distance_m: number;
  active_coupons_count: number;
  top_coupon: {
    title: string;
    discount_type: DiscountType;
    discount_value: number;
  } | null;
}

export interface AdCoupon {
  coupon_id: number;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia: number | null;
  uses_count: number;
  total_usage_limit: number;
}
export interface Ad {
  ad_id: number;
  image_url: string;
  start_date: string;
  end_date: string;
  redemption_limit: number | null;
  impressions: number;
  clicks: number;
  coupon: AdCoupon;
  business: Pick<
    NearbyBusiness,
    'business_id' | 'business_name' | 'category' | 'logo_url' | 'lat' | 'lng' | 'display_address'
  >;
}

export interface WalletCoupon {
  coupon_instance_id: number;
  coupon_id: number;
  saved_at: string;
  last_used_at: string | null;
  consumer_uses_count: number;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia: number | null;
  start_date: string;
  end_date: string;
  usage_limit_per_user: number;
  total_usage_limit: number;
  coupon_uses_count: number;
  transferable: boolean;
  accumulable: boolean;
  coupon_status: CouponStatus;
  business: {
    business_id: number;
    business_name: string;
    category: string;
    logo_url: string | null;
    status: BusinessStatus;
    business_status: BusinessStatus;
    lat: number | null;
    lng: number | null;
    display_address: string | null;
  };
}

export interface BusinessCouponListItem {
  coupon_id: number;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia: number | null;
  start_date: string;
  end_date: string;
  usage_limit_per_user: number;
  total_usage_limit: number;
  uses_count: number;
  transferable: boolean;
  accumulable: boolean;
  max_accumulated_discount: number | null;
  max_coupons_per_tx: number | null;
  single_use: boolean;
  is_ad_exclusive: boolean;
  status: CouponStatus;
  created_at: string;
}

export interface CreateCouponInput {
  title: string;
  description?: string;
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia?: number | null;
  start_date: string;
  end_date: string;
  usage_limit_per_user?: number;
  total_usage_limit: number;
  transferable?: boolean;
  accumulable?: boolean;
  max_accumulated_discount?: number;
  max_coupons_per_tx?: number;
  single_use?: boolean;
}

export interface QrTokenResponse {
  jwt: string;
  short_code: string;
  expires_at: string;
}

export interface RedeemResponse {
  success: true;
  consumer_name: string;
  discount_type: DiscountType;
  discount_value: number;
  discount_applied: number;
  message: string;
}

// ────────────────────────────────────────────────────────────
// HOME-01..04
// ────────────────────────────────────────────────────────────
export async function fetchNearby(params: {
  lat: number;
  lng: number;
  radius?: number;
  category?: string;
}): Promise<NearbyBusiness[]> {
  const r = await api.get('/api/businesses/nearby', { params });
  return r.data.data.businesses;
}

export async function fetchIpLocation(): Promise<{
  lat: number;
  lng: number;
  city: string;
  source: string;
}> {
  const r = await api.get('/api/geo/ip-location');
  return r.data.data;
}

export async function fetchActiveAds(): Promise<Ad[]> {
  const r = await api.get('/api/ads/active');
  return r.data.data.ads;
}

export async function registerAdClick(adId: number): Promise<void> {
  await api.post(`/api/ads/${adId}/click`);
}

// ────────────────────────────────────────────────────────────
// CPN-01..07
// ────────────────────────────────────────────────────────────
export async function createCoupon(
  payload: CreateCouponInput
): Promise<{ coupon_id: number; status: CouponStatus; message: string }> {
  const r = await api.post('/api/coupons', payload);
  return r.data.data;
}

export async function fetchMyCoupons(
  status: 'active' | 'paused' | 'expired' | 'all' = 'all'
): Promise<BusinessCouponListItem[]> {
  const r = await api.get('/api/coupons/my-coupons', { params: { status } });
  return r.data.data.coupons;
}

export async function pauseCoupon(
  couponId: number
): Promise<{ coupon_id: number; status: CouponStatus }> {
  const r = await api.patch(`/api/coupons/${couponId}/pause`);
  return r.data.data;
}

export async function activateCoupon(
  couponId: number
): Promise<{ coupon_id: number; status: CouponStatus }> {
  const r = await api.patch(`/api/coupons/${couponId}/activate`);
  return r.data.data;
}

export async function saveCoupon(
  couponId: number
): Promise<{ coupon_instance_id: number; saved_at: string; uses_count: number; message: string }> {
  const r = await api.post(`/api/coupons/${couponId}/save`);
  return r.data.data;
}

export async function generateQr(instanceId: number): Promise<QrTokenResponse> {
  const r = await api.post(`/api/coupons/${instanceId}/generate-qr`);
  return r.data.data;
}

export async function redeemByJwt(tokenJwt: string): Promise<RedeemResponse> {
  const r = await api.post('/api/coupons/redeem', { token_jwt: tokenJwt });
  return r.data.data;
}

export async function redeemByShortCode(shortCode: string): Promise<RedeemResponse> {
  const r = await api.post('/api/coupons/redeem', { short_code: shortCode });
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// CART-01
// ────────────────────────────────────────────────────────────
export interface InstanceStatus {
  uses_count: number;
  last_used_at: string | null;
  last_discount_applied: number | null;
}

export async function fetchInstanceStatus(instanceId: number): Promise<InstanceStatus> {
  const r = await api.get(`/api/wallet/instance/${instanceId}/status`);
  return r.data.data;
}

export interface ConsumerSavings {
  total_saved: number;
  redemption_count: number;
  loyalty_cards_completed: number;
}

export async function fetchSavings(): Promise<ConsumerSavings> {
  const r = await api.get('/api/wallet/savings');
  return r.data.data;
}

export async function fetchWallet(tab: 'active' | 'history'): Promise<WalletCoupon[]> {
  const r = await api.get('/api/wallet/coupons', { params: { tab } });
  return r.data.data.coupons;
}
