/**
 * Cliente API mobile para datos del negocio del usuario autenticado.
 *
 * Reemplaza la lectura desde el JWT (que solo lleva {sub, role, email})
 * para reflejar plan/billing_interval frescos después de un pago Stripe.
 */

import { api } from './api';

export interface MyBusiness {
  id: number;
  business_name: string;
  category: string;
  display_address: string;
  lat: number | null;
  lng: number | null;
  logo_url: string | null;
  status: string;
  plan: 'free' | 'premium';
  billing_interval: 'monthly' | 'quarterly';
  subscription_status: string | null;
}

/**
 * GET /api/account/business/me — retorna estado actual desde DB.
 *
 * Llamar en useFocusEffect del perfil para refrescar el plan, especialmente
 * después de regresar del checkout de Stripe.
 */
export async function getMyBusiness(): Promise<MyBusiness> {
  const r = await api.get('/api/account/business/me');
  return r.data.data as MyBusiness;
}
