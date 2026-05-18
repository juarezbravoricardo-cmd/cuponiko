/**
 * Dashboard del negocio — hub de navegación principal.
 *
 * Rediseño v27-v2: métricas rápidas + sin duplicados del tab bar.
 * - Header: avatar naranja + nombre negocio + plan
 * - Métricas: cupones activos, canjes hoy, clientes lealtad
 * - Operación diaria: 2 scanner cards (borde morado + badge)
 * - Herramientas: solo items que NO están en tab bar (borde naranja)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { getMyBusiness, MyBusiness } from '@/services/businessApi';
import { fetchDashboardStats, type DashboardStats } from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

// Tipo laxo para leer plan del store como fallback de degradación elegante
// (mismo patrón que profile.tsx). El JWT no incluye plan, así que el store
// solo lo tendría si fue inyectado en otro lado; lo tratamos como opcional.
type BusinessLikeUser = { plan?: 'free' | 'premium' };

const SCANNER_TILES = [
  { title: 'Escanear QR de cupón', subtitle: 'Valida un cupón de un cliente', href: '/(business)/scanner', emoji: '📷' },
  { title: 'Asignar sello de lealtad', subtitle: 'Escanea el QR del cliente', href: '/(business)/loyalty/scanner', emoji: '🔖' },
];

const TOOL_TILES = [
  { title: 'Notificaciones push', subtitle: 'Envía push segmentado a tus clientes', href: '/(business)/notifications', emoji: '🔔' },
  { title: 'Exportar reportes', subtitle: 'Cupones, lealtad y redenciones (PDF)', href: '/(business)/exports', emoji: '📄' },
];

export default function BusinessDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  // Estado autoritativo del plan: viene de GET /api/account/business/me.
  // Mismo patrón que profile.tsx para mantener consistencia.
  const [businessData, setBusinessData] = useState<MyBusiness | null>(null);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [businessFetchFailed, setBusinessFetchFailed] = useState(false);

  // Métricas del dashboard
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setBusinessLoading(true);
      setBusinessFetchFailed(false);
      getMyBusiness()
        .then((data) => {
          if (mounted) setBusinessData(data);
        })
        .catch(() => {
          if (mounted) setBusinessFetchFailed(true);
        })
        .finally(() => {
          if (mounted) setBusinessLoading(false);
        });
      return () => {
        mounted = false;
      };
    }, [])
  );

  useEffect(() => {
    fetchDashboardStats().then(setStats).catch(() => {});
  }, []);

  // Decisión de render del botón "Hazte Premium":
  //   - Mientras carga el primer fetch → ocultar (evita flash del botón para
  //     usuarios premium en cada focus de la pantalla).
  //   - Si el fetch tuvo éxito → mostrar solo si plan === 'free'.
  //   - Si el fetch falló → fallback al store laxo, y si tampoco hay info,
  //     mostrar el botón (degradación elegante: prefiero que un premium vea
  //     un botón de más a que un free no pueda upgradear si la red falló).
  const businessUser = (user as unknown as BusinessLikeUser | null) ?? null;
  let showUpgradeButton: boolean;
  if (businessLoading && !businessData) {
    showUpgradeButton = false;
  } else if (businessData) {
    showUpgradeButton = businessData.plan === 'free';
  } else if (businessFetchFailed) {
    showUpgradeButton = (businessUser?.plan ?? 'free') === 'free';
  } else {
    showUpgradeButton = true;
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(businessData?.business_name || user?.full_name || 'N').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.businessName}>
            {businessData?.business_name || user?.full_name || 'Mi negocio'}
          </Text>
          <Text style={styles.planBadge}>
            Plan {businessData?.plan === 'premium' ? 'Premium' : 'Free'}
          </Text>
        </View>
      </View>

      {/* Métricas rápidas */}
      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.active_coupons}</Text>
            <Text style={styles.statLabel}>Cupones activos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.redemptions_today}</Text>
            <Text style={styles.statLabel}>Canjes hoy</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.loyalty_customers}</Text>
            <Text style={styles.statLabel}>Clientes lealtad</Text>
          </View>
        </View>
      )}

      {/* Operación diaria */}
      <Text style={styles.sectionLabel}>Operación diaria</Text>
      <View style={styles.scannerGrid}>
        {SCANNER_TILES.map((tile) => (
          <Pressable
            key={tile.href}
            style={styles.scannerCard}
            onPress={() => router.push(tile.href as any)}
          >
            <View style={styles.scannerTop}>
              <Text style={styles.scannerEmoji}>{tile.emoji}</Text>
              <View style={styles.scannerBadge}>
                <Text style={styles.scannerBadgeText}>Scanner</Text>
              </View>
            </View>
            <Text style={styles.scannerTitle}>{tile.title}</Text>
            <Text style={styles.scannerSub}>{tile.subtitle}</Text>
          </Pressable>
        ))}
      </View>

      {/* Herramientas */}
      <Text style={styles.sectionLabel}>Herramientas</Text>
      <View style={styles.toolList}>
        {TOOL_TILES.map((tile) => (
          <Pressable
            key={tile.href}
            style={styles.toolCard}
            onPress={() => router.push(tile.href as any)}
          >
            <Text style={styles.toolEmoji}>{tile.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.toolTitle}>{tile.title}</Text>
              <Text style={styles.toolSub}>{tile.subtitle}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      {/* Botón Upgrade — mantener lógica existente */}
      {showUpgradeButton && (
        <Button
          title="Hazte Premium"
          onPress={() => router.push('/(business)/upgrade')}
          style={{ marginTop: spacing.lg }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: fontSize.lg,
  },
  businessName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  planBadge: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  // Métricas
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.bgLight,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  // Sección labels
  sectionLabel: {
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },

  // Scanner cards
  scannerGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  scannerCard: {
    flex: 1,
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.secondary,
    padding: spacing.md,
  },
  scannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  scannerEmoji: {
    fontSize: 20,
  },
  scannerBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: 999,
  },
  scannerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  scannerTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  scannerSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Tool cards
  toolList: {
    gap: spacing.sm,
  },
  toolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    padding: spacing.md,
  },
  toolEmoji: {
    fontSize: 20,
  },
  toolTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  toolSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  chevron: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    fontWeight: '300',
  },
});
