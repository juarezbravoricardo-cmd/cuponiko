/**
 * Design tokens de Cuponiko.
 * Basado en sistema definido en el briefing: primary naranja, secondary morado,
 * fondos claros, texto grafito. Nunca mezclar naranja+morado en mismo elemento.
 */
export const colors = {
  primary: '#F97316', // naranja
  primaryDark: '#C2410C',
  secondary: '#7C3AED', // morado
  bgLight: '#FFFFFF',
  bgMuted: '#F5F5F5',
  textPrimary: '#1F1F1F',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
} as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;
