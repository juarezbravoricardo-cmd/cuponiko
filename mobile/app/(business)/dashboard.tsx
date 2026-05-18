/**
 * Dashboard del negocio — hub de navegación principal.
 *
 * Rediseño v27: cards blancas con borde izquierdo sutil de color.
 * Dos secciones: "Operación diaria" (scanners) y "Gestión" (lista vertical).
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { getMyBusiness, MyBusiness } from '@/services/businessApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

// Tipo laxo para leer plan del store como fallback de degradación elegante
// (mismo patrón que profile.tsx). El JWT no incluye plan, así que el store
// solo lo tendría si fue inyectado en otro lado; lo tratamos como opcional.
type BusinessLikeUser = { plan?: 'free' | 'premium' };

const SCANNER_TILES = [
  { title: 'Escanear QR de cupón', subtitle: 'Valida un cupón', href: '/(business)/scanner', emoji: '📷' },
  { title: 'Asignar sello', subtitle: 'Lealtad del cliente', href: '/(business)/loyalty/scanner', emoji: '🔖' },
];

const MANAGEMENT_TILES = [
  { title: 'Mis cupones', subtitle: 'Crea, pausa o revisa tus promociones', href: '/(business)/coupons', emoji: '🎟️' },
  { title: 'Tarjetas de lealtad', subtitle: 'Programas de sellos y recompensas', href: '/(business)/loyalty', emoji: '⭐' },
  { title: 'Anuncios destacados', subtitle: 'Promociones pagadas en el mapa', href: '/(business)/ads', emoji: '📢' },
  { title: 'Notificaciones', subtitle: 'Push segmentado a tus clientes', href: '/(business)/notifications', emoji: '🔔' },
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

  // Decisión de render del botón "Actualizar a Premium":
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

  // Nombre y plan para el header
  const businessName = businessData?.business_name || user?.full_name || 'Mi negocio';
  const plan = businessData?.plan || (businessUser?.plan ?? 'Free');

  return (
    <ScreenContainer>
      {/* Header con avatar y nombre del negocio */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{businessName?.charAt(0) || 'N'}</Text>
        </View>
        <View>
          <Text style={styles.businessName}>{businessName}</Text>
          <Text style={styles.planBadge}>{plan === 'free' ? 'Free' : plan === 'premium' ? 'Premium' : plan}</Text>
        </View>
      </View>

      {/* Sección: Operación diaria */}
      <Text style={styles.sectionLabel}>Operación diaria</Text>
      <View style={styles.scannerGrid}>
        {SCANNER_TILES.map((tile) => (
          <Pressable
            key={tile.href}
            style={styles.scannerCard}
            onPress={() => router.push(tile.href as never)}
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

      {/* Sección: Gestión */}
      <Text style={styles.sectionLabel}>Gestión</Text>
      <View style={styles.managementList}>
        {MANAGEMENT_TILES.map((tile) => (
          <Pressable
            key={tile.href}
            style={styles.managementCard}
            onPress={() => router.push(tile.href as never)}
          >
            <Text style={styles.managementEmoji}>{tile.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.managementTitle}>{tile.title}</Text>
              <Text style={styles.managementSub}>{tile.subtitle}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      {showUpgradeButton && (
        <>
          <View style={{ height: spacing.lg }} />
          <Button
            title="Actualizar a Premium"
            variant="secondary"
            onPress={() => router.push('/(business)/upgrade')}
          />
        </>
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: fontSize.md,
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

  // Sección labels
  sectionLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },

  // Scanner cards (grid 2x2)
  scannerGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
    fontSize: 18,
  },
  scannerBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: 999,
  },
  scannerBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
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

  // Management cards (lista vertical)
  managementList: {
    gap: spacing.sm,
  },
  managementCard: {
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
  managementEmoji: {
    fontSize: 20,
  },
  managementTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  managementSub: {
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
