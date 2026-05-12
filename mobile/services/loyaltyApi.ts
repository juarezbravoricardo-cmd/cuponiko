/**
 * Cliente API mobile para Lealtad (Fase 3).
 * Wraps thin sobre `api` (axios) ya autenticado con JWT y refresh automático.
 */

import { api } from './api';

export type LoyaltyCard = {
  id: number;
  name: string;
  reward_description: string;
  stamps_required: number;
  design_color: string;
  icon: string;
};

export type LoyaltyBusiness = {
  id: number;
  business_name: string;
  status: 'active' | 'inactive' | 'suspended';
};

export type ConsumerLoyaltyCard = {
  consumer_loyalty_id: number;
  stamps_count: number;
  stamps_required: number;
  reward_unlocked: boolean;
  reward_redeemed: boolean;
  joined_at: string;
  loyalty_card: LoyaltyCard;
  business: LoyaltyBusiness;
  qr_token: string | null;
  valid_until: string | null;
};

export type JoinLoyaltyResponse = {
  consumer_loyalty_id: number;
  loyalty_card_id: number;
  stamps_count: number;
  stamps_required: number;
  qr_token: string;
  valid_until: string;
  message: string;
};

export type StampResponse = {
  consumer_loyalty_id: number;
  stamps_count: number;
  stamps_required: number;
  reward_unlocked: boolean;
  message: string;
};

export type RefreshQrResponse = {
  qr_token: string;
  valid_until: string;
};

export type RewardResponse = {
  jwt: string;
  short_code: string;
  expires_at: string;
  message: string;
};

export async function joinLoyalty(loyaltyCardId: number): Promise<JoinLoyaltyResponse> {
  const r = await api.post('/api/loyalty/join', { loyalty_card_id: loyaltyCardId });
  return r.data.data;
}

export async function fetchMyLoyaltyCards(): Promise<ConsumerLoyaltyCard[]> {
  const r = await api.get('/api/loyalty/my-cards');
  return r.data.data.cards;
}

export async function refreshLoyaltyQr(consumerLoyaltyId: number): Promise<RefreshQrResponse> {
  const r = await api.post(`/api/loyalty/${consumerLoyaltyId}/refresh-qr`);
  return r.data.data;
}

export async function stampLoyalty(qrToken: string): Promise<StampResponse> {
  const r = await api.post('/api/loyalty/stamp', { qr_token: qrToken });
  return r.data.data;
}

export async function redeemReward(consumerLoyaltyId: number): Promise<RewardResponse> {
  const r = await api.post('/api/loyalty/redeem-reward', { consumer_loyalty_id: consumerLoyaltyId });
  return r.data.data;
}

// ────────────────────────────────────────────────────────────
// LYL-BIZ-01: GET /api/loyalty/cards — Lista del negocio actual
// LYL-BIZ-02: POST /api/loyalty/create — Crear tarjeta de lealtad
//   Nota: estos endpoints están descritos en el blueprint de Fase 3 pero
//   pueden no estar montados todavía en algunas builds del backend.
//   El frontend maneja 404 con empty state.
// ────────────────────────────────────────────────────────────
export interface BusinessLoyaltyCard {
  id: number;
  name: string;
  reward_description: string;
  stamps_required: number;
  design_color: string;
  icon: string;
  is_active: boolean;
  consumers_enrolled: number;
  created_at: string;
}

export interface CreateLoyaltyCardInput {
  name: string;
  reward_description: string;
  stamps_required: number;
  design_color: string;
  icon: string;
}

export async function fetchBusinessLoyaltyCards(): Promise<BusinessLoyaltyCard[]> {
  const r = await api.get('/api/loyalty/cards');
  // Soporta tanto { data: { cards } } como { data: [] } por compatibilidad.
  const payload = r.data?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.cards)) return payload.cards;
  return [];
}

export async function createLoyaltyCard(
  input: CreateLoyaltyCardInput
): Promise<{ loyalty_card_id: number; message: string }> {
  const r = await api.post('/api/loyalty/create', input);
  return r.data.data;
}
