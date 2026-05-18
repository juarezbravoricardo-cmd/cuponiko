/**
 * Cliente API mobile para Anuncios (AD-01) — Fase 3.
 */

import { api } from './api';

export type CreateAdInput = {
  title: string;
  description?: string;
  image_url: string;
  discount_type: 'percent' | 'fixed' | '2x1' | 'free';
  discount_value: number;
  precio_referencia?: number | null;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  redemption_limit: number;
  cost_type: 'cpc' | 'flat';
  cost_value: number;
};

export type CreateAdResponse = {
  ad_id: number;
  coupon_id: number;
  message: string;
};

export async function uploadAdImage(uri: string): Promise<string> {
  const formData = new FormData();
  const filename = uri.split('/').pop() || 'image.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}` : 'image/jpeg';

  formData.append('image', {
    uri,
    name: filename,
    type,
  } as unknown as Blob);

  const r = await api.post('/api/uploads/ad-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return r.data.data.image_url;
}

export async function createAd(input: CreateAdInput): Promise<CreateAdResponse> {
  const r = await api.post('/api/ads/create', input);
  return r.data.data;
}

export interface MyAd {
  ad_id: number;
  coupon_id: number;
  title: string;
  image_url: string;
  status: 'active' | 'paused' | 'expired';
  start_date: string;
  end_date: string;
  impressions: number;
  clicks: number;
  redemptions: number;
}

/**
 * Lista de anuncios del negocio actual. Defensivo: si el endpoint no está
 * montado en la build vigente del backend, devuelve [].
 */
export async function fetchMyAds(): Promise<MyAd[]> {
  const r = await api.get('/api/ads/my-ads');
  const payload = r.data?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.ads)) return payload.ads;
  return [];
}
