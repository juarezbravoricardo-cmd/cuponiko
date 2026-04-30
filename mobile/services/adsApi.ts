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

export async function createAd(input: CreateAdInput): Promise<CreateAdResponse> {
  const r = await api.post('/api/ads/create', input);
  return r.data.data;
}
