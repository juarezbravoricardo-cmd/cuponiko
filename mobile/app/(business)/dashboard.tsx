/**
 * Dashboard del negocio — hub de navegación para la Fase 2.
 *
 * Analogía: la trastienda de un comercio. Tres cajones: escanear, cupones
 * y el plan. Sin métricas (vendrán en Fase 4); la Fase 2 es operativa.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

export default function BusinessDashboard() {
  const router = useRouter();
  const { user, logout } = useAuth();
  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={styles.title}>Hola, {user?.full_name || 'Negocio'}</Text>
        <Text style={styles.sub}>¿Qué quieres hacer hoy?</Text>
      </View>

      <Pressable
        style={[styles.tile, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/(business)/scanner')}
      >
        <Text style={styles.tileTitle}>Escanear QR</Text>
        <Text style={styles.tileSub}>Valida un cupón de un cliente.</Text>
      </Pressable>

      <Pressable
        style={[styles.tile, styles.tileAlt]}
        onPress={() => router.push('/(business)/coupons')}
      >
        <Text style={[styles.tileTitle, { color: colors.textPrimary }]}>Mis cupones</Text>
        <Text style={[styles.tileSub, { color: colors.textMuted }]}>
          Crea, pausa o revisa tus promociones.
        </Text>
      </Pressable>

      <Pressable
        style={[styles.tile, styles.tileAlt]}
        onPress={() => router.push('/(business)/coupons/new')}
      >
        <Text style={[styles.tileTitle, { color: colors.textPrimary }]}>Nuevo cupón</Text>
        <Text style={[styles.tileSub, { color: colors.textMuted }]}>
          Flujo rápido en 5 pasos.
        </Text>
      </Pressable>

      <View style={{ height: spacing.xl }} />

      <Button
        title="Actualizar a Premium"
        variant="secondary"
        onPress={() => router.push('/(business)/upgrade')}
      />
      <Button title="Cerrar sesión" variant="ghost" onPress={logout} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.md, gap: spacing.xs },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted },
  tile: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs },
  tileAlt: { backgroundColor: colors.bgMuted },
  tileTitle: { fontSize: fontSize.lg, fontWeight: '800', color: '#FFF' },
  tileSub: { color: '#FFFFFFCC' },
});
