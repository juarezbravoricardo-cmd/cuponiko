/**
 * loyaltyStore — Zustand store para tarjetas de lealtad del consumer actual.
 *
 * Analogía: la cartera donde guardas las tarjetas de café "compra 9, te
 * regalamos la 10ª". Aquí cacheamos la lista para que el listado y el detalle
 * compartan la misma fuente y no se hagan dos fetch innecesarios.
 *
 * Reglas:
 *  - fetchCards reemplaza la lista (no concatena, no es paginado en el contrato).
 *  - selectCard guarda referencia por consumer_loyalty_id.
 *  - updateCard actualiza una tarjeta concreta (post-redeem o post-refresh-qr).
 */

import { create } from 'zustand';
import {
  fetchMyLoyaltyCards,
  refreshLoyaltyQr,
  type ConsumerLoyaltyCard,
} from '@/services/loyaltyApi';
import { extractApiError } from '@/services/api';

interface LoyaltyState {
  myCards: ConsumerLoyaltyCard[];
  selectedCardId: number | null;
  loading: boolean;
  error: string | null;

  fetchCards: () => Promise<void>;
  selectCard: (consumerLoyaltyId: number | null) => void;
  getSelected: () => ConsumerLoyaltyCard | null;
  updateCard: (consumerLoyaltyId: number, patch: Partial<ConsumerLoyaltyCard>) => void;
  refreshQr: (consumerLoyaltyId: number) => Promise<void>;
  reset: () => void;
}

export const useLoyalty = create<LoyaltyState>((set, get) => ({
  myCards: [],
  selectedCardId: null,
  loading: false,
  error: null,

  fetchCards: async () => {
    set({ loading: true, error: null });
    try {
      const cards = await fetchMyLoyaltyCards();
      set({ myCards: cards, loading: false });
    } catch (e) {
      set({ loading: false, error: extractApiError(e).error });
    }
  },

  selectCard: (id) => set({ selectedCardId: id }),

  getSelected: () => {
    const id = get().selectedCardId;
    if (id == null) return null;
    return get().myCards.find((c) => c.consumer_loyalty_id === id) ?? null;
  },

  updateCard: (id, patch) =>
    set({
      myCards: get().myCards.map((c) =>
        c.consumer_loyalty_id === id ? { ...c, ...patch } : c
      ),
    }),

  refreshQr: async (id) => {
    try {
      const r = await refreshLoyaltyQr(id);
      get().updateCard(id, { qr_token: r.qr_token, valid_until: r.valid_until });
    } catch (e) {
      set({ error: extractApiError(e).error });
    }
  },

  reset: () => set({ myCards: [], selectedCardId: null, error: null }),
}));
