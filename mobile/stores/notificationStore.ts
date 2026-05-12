/**
 * notificationStore — Zustand store para notificaciones del usuario actual.
 *
 * Analogía: el "buzón" del condominio. Mantiene un contador de cartas sin leer
 * (badge de tab bar) y la lista paginada de la bandeja para que la pantalla
 * `notifications.tsx` no tenga que recargar al volver atrás.
 *
 * Reglas:
 *  - markAsRead actualiza estado local optimistamente; si la API falla, revertimos.
 *  - fetchPage sustituye la lista cuando page === 1; concatena cuando page > 1
 *    (scroll infinito).
 *  - refreshUnreadCount() es barato: fetch limit=1 unread_only=true para tomar `total`.
 */

import { create } from 'zustand';
import {
  fetchNotifications,
  markAsRead as apiMarkAsRead,
  type NotificationItem,
  type NotificationsPagination,
} from '@/services/notificationsApi';
import { extractApiError } from '@/services/api';

interface NotificationState {
  items: NotificationItem[];
  pagination: NotificationsPagination | null;
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  fetchPage: (page: number, unreadOnly?: boolean) => Promise<void>;
  loadMore: (unreadOnly?: boolean) => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  reset: () => void;
}

export const useNotifications = create<NotificationState>((set, get) => ({
  items: [],
  pagination: null,
  unreadCount: 0,
  loading: false,
  loadingMore: false,
  error: null,

  fetchPage: async (page, unreadOnly = false) => {
    set({ loading: page === 1, loadingMore: page > 1, error: null });
    try {
      const r = await fetchNotifications({ page, limit: 20, unreadOnly });
      const items = page === 1 ? r.notifications : [...get().items, ...r.notifications];
      set({
        items,
        pagination: r.pagination,
        loading: false,
        loadingMore: false,
      });
    } catch (e) {
      set({
        loading: false,
        loadingMore: false,
        error: extractApiError(e).error,
      });
    }
  },

  loadMore: async (unreadOnly = false) => {
    const p = get().pagination;
    if (!p) return;
    if (p.page >= p.total_pages) return;
    if (get().loadingMore) return;
    await get().fetchPage(p.page + 1, unreadOnly);
  },

  markAsRead: async (id) => {
    const prev = get().items;
    // optimistic
    set({
      items: prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, get().unreadCount - (prev.find((n) => n.id === id && !n.read) ? 1 : 0)),
    });
    try {
      await apiMarkAsRead(id);
    } catch (e) {
      // revertir
      set({ items: prev, error: extractApiError(e).error });
      // recontar con fuente de verdad
      void get().refreshUnreadCount();
    }
  },

  refreshUnreadCount: async () => {
    try {
      const r = await fetchNotifications({ page: 1, limit: 1, unreadOnly: true });
      set({ unreadCount: r.pagination.total });
    } catch {
      // silencioso: el badge no es crítico
    }
  },

  reset: () => set({ items: [], pagination: null, unreadCount: 0, error: null }),
}));
