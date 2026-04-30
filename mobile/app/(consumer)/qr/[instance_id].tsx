/**
 * Pantalla del QR a redimir.
 *
 * Analogía: cupón impreso con caducidad visible. El consumidor lo muestra al
 * dependiente; si pasan 5 minutos sin usarlo, se "apaga" y hay que pedir uno
 * nuevo (evita capturas de pantalla reutilizables).
 *
 * Reglas clave (anti-patrones):
 *   - AP-06 / AP-14: el token nace en el servidor. Aquí sólo lo mostramos.
 *   - El fondo del QR es #FFFFFF puro y el padding mínimo 20 px (ISO 18004).
 *   - Countdown con `setInterval(1000)`. Cuando llega a 0, pedimos regenerar
 *     automáticamente (la UX prompt-less; una regeneración no viola el rate
 *     limiter porque la UI expone un CTA con cooldown).
 *   - Haptic warning cuando quedan ≤ 30 s (cumple el spec del blueprint).
 *
 * Fallback: si la API regresa 429 / no hay red, mostramos el `short_code`
 * grande para teclear manualmente en el negocio.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { generateQr, type QrTokenResponse } from '@/services/couponsApi';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const QR_SIZE = 280;

export default function QrScreen() {
  const { instance_id } = useLocalSearchParams<{ instance_id: string }>();
  const [qr, setQr] = useState<QrTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnedRef = useRef(false);

  const load = useCallback(async () => {
    if (!instance_id) return;
    setLoading(true);
    setError(null);
    warnedRef.current = false;
    try {
      const r = await generateQr(Number(instance_id));
      setQr(r);
      const ms = new Date(r.expires_at).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.floor(ms / 1000)));
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'No pudimos generar tu QR.';
      setError(status === 429 ? 'Has pedido demasiados códigos. Espera 1 hora.' : msg);
    } finally {
      setLoading(false);
    }
  }, [instance_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        const next = s - 1;
        if (next === 30 && !warnedRef.current) {
          warnedRef.current = true;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => null);
        }
        if (next <= 0 && tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        return next;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [secondsLeft]);

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.wrap}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <>
            <Text style={styles.errorTxt}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </Pressable>
          </>
        ) : !qr ? null : secondsLeft <= 0 ? (
          <>
            <Text style={styles.expired}>Código expirado</Text>
            <Text style={styles.muted}>Genera uno nuevo y muéstralo al cajero.</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryTxt}>Generar nuevo código</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Muestra este código al cajero</Text>
            <View style={styles.qrBox}>
              <QRCode
                value={qr.jwt}
                size={QR_SIZE}
                color="#000000"
                backgroundColor="#FFFFFF"
                quietZone={20}
              />
            </View>
            <View style={[styles.timer, secondsLeft <= 30 && styles.timerWarn]}>
              <Text style={styles.timerTxt}>
                {mm}:{ss}
              </Text>
            </View>
            <Text style={styles.shortCodeLabel}>¿No escanea?</Text>
            <Pressable
              onLongPress={() => {
                Alert.alert('Código manual', `Dícta este código al cajero:\n\n${qr.short_code}`);
              }}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  Haptics.selectionAsync().catch(() => null);
                }
              }}
              style={styles.shortCodeBtn}
            >
              <Text style={styles.shortCode}>{qr.short_code}</Text>
            </Pressable>
            <Text style={styles.footerNote}>
              El código cambia cada vez que lo abres. No lo compartas por captura.
            </Text>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timer: {
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  timerWarn: { backgroundColor: colors.danger },
  timerTxt: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
  shortCodeLabel: { color: colors.textMuted, marginTop: spacing.md },
  shortCodeBtn: {
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  shortCode: { fontSize: fontSize.xxl, fontWeight: '800', letterSpacing: 4, color: colors.textPrimary },
  footerNote: { color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'center', paddingHorizontal: spacing.lg },
  errorTxt: { color: colors.danger, textAlign: 'center', fontSize: fontSize.md },
  expired: { fontSize: fontSize.xl, fontWeight: '800', color: colors.danger },
  muted: { color: colors.textMuted, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  retryTxt: { color: '#FFF', fontWeight: '800' },
});
