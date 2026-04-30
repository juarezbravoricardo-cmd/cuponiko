/**
 * Helpers puros de formateo para UI.
 *
 * Se mantienen aquí (no inline) porque la misma lógica la necesitan la
 * pantalla de negocio, la cartera, el detalle del cupón y el QR.
 */

import type { DiscountType } from '@/services/couponsApi';

export function formatDiscount(c: {
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia?: number | null;
}): string {
  switch (c.discount_type) {
    case 'percent':
      return `${Math.round(c.discount_value)}% de descuento`;
    case 'fixed':
      return `$${c.discount_value.toFixed(2)} de descuento`;
    case '2x1':
      return c.precio_referencia
        ? `2x1 (referencia: $${c.precio_referencia.toFixed(2)})`
        : '2x1';
    case 'free':
      return c.precio_referencia
        ? `Gratis (referencia: $${c.precio_referencia.toFixed(2)})`
        : 'Gratis';
    default:
      return '';
  }
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
}

/**
 * Formatea una fecha ISO como "28 abr 2026".
 */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
