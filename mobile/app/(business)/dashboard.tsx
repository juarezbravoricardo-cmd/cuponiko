/**
 * Dashboard del negocio — hub de navegación principal.
 *
 * Incluye accesos rápidos a las funciones avanzadas (notificaciones, exports,
 * lealtad, anuncios) que el tab bar no expone para no superar el límite
 * recomendado de 5 ítems en mobile.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

type Tile = {
  title: string;
  subtitle: string;
  href: string;
  variant: 'primary' | 'secondary' | 'muted';
};

const TILES: Tile[] = [
  { title: 'Escanear QR de cupón', subtitle: 'Valida un cupón de un cliente.', href: '/(business)/scanner', variant: 'primary' },
  { title: 'Mis cupones', subtitle: 'Crea, pausa o revisa tus promociones.', href: '/(business)/coupons', variant: 'muted' },
  { title: 'Tarjetas de lealtad', subtitle: 'Programas de sellos y recompensas.', href: '/(business)/loyalty', variant: 'muted' },
  { title: 'Asignar sello de lealtad', subtitle: 'Escanea el QR de lealtad del cliente.', href: '/(business)/loyalty/scanner', variant: 'primary' },
  { title: 'Anuncios destacados', subtitle: 'Promociones pagadas en el mapa.', href: '/(business)/ads', variant: 'secondary' },
  { title: 'Notificaciones', subtitle: 'Envía push segmentado a tus clientes.', href: '/(business)/notifications', variant: 'muted' },
  { title: 'Exportar reportes (PDF)', subtitle: 'Cupones, lealtad y redenciones.', href: '/(business)/exports', variant: 'muted' },
];

export default function BusinessDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Hola, {user?.full_name || 'Negocio'}</Text>
        <Text style={styles.sub}>¿Qué quieres hacer hoy?</Text>
      </View>

      {TILES.map((t) => (
        <Pressable
          key={t.href}
          style={[
            styles.tile,
            t.variant === 'primary' && { backgroundColor: colors.primary },
            t.variant === 'secondary' && { backgroundColor: colors.secondary },
            t.variant === 'muted' && styles.tileMuted,
          ]}
          onPress={() => router.push(t.href as never)}
        >
          <Text
            style={[
              styles.tileTitle,
              t.variant === 'muted' && { color: colors.textPrimary },
            ]}
          >
            {t.title}
          </Text>
          <Text
            style={[
              styles.tileSub,
              t.variant === 'muted' && { color: colors.textMuted },
            ]}
          >
            {t.subtitle}
          </Text>
        </Pressable>
      ))}

      <View style={{ height: spacing.lg }} />

      <Button
        title="Actualizar a Premium"
        variant="secondary"
        onPress={() => router.push('/(business)/upgrade')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.md, gap: spacing.xs },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted },
  tile: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs },
  tileMuted: { backgroundColor: colors.bgMuted },
  tileTitle: { fontSize: fontSize.lg, fontWeight: '800', color: '#FFFFFF' },
  tileSub: { color: '#FFFFFFCC' },
});
