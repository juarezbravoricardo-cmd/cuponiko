/**
 * Dashboard del negocio — hub de navegación principal.
 *
 * Incluye accesos rápidos a las funciones avanzadas (notificaciones, exports,
 * lealtad, anuncios) que el tab bar no expone para no superar el límite
 * recomendado de 5 ítems en mobile.
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

type Tile = {
  title: string;
  subtitle: string;
  href: string;
  variant: 'primary' | 'secondary' | 'muted';
};

const TILES: Tile[] = [
  { title: 'Escanear QR de cupón', subtitle: 'Valida un cupón de un cliente.', href: '/(business)/scanner', variant: 'secondary' },
  { title: 'Mis cupones', subtitle: 'Crea, pausa o revisa tus promociones.', href: '/(business)/coupons', variant: 'primary' },
  { title: 'Tarjetas de lealtad', subtitle: 'Programas de sellos y recompensas.', href: '/(business)/loyalty', variant: 'primary' },
  { title: 'Asignar sello de lealtad', subtitle: 'Escanea el QR de lealtad del cliente.', href: '/(business)/loyalty/scanner', variant: 'secondary' },
  { title: 'Anuncios destacados', subtitle: 'Promociones pagadas en el mapa.', href: '/(business)/ads', variant: 'primary' },
  { title: 'Notificaciones', subtitle: 'Envía push segmentado a tus clientes.', href: '/(business)/notifications', variant: 'primary' },
  { title: 'Exportar reportes (PDF)', subtitle: 'Cupones, lealtad y redenciones.', href: '/(business)/exports', variant: 'primary' },
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
  hero: { marginBottom: spacing.md, gap: spacing.xs },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted },
  tile: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs },
  tileMuted: { backgroundColor: colors.bgMuted },
  tileTitle: { fontSize: fontSize.lg, fontWeight: '800', color: '#FFFFFF' },
  tileSub: { color: '#FFFFFFCC' },
});
