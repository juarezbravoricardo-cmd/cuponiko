/**
 * Scanner del negocio (CPN-07).
 *
 * Analogía: la caja registradora. El dependiente apunta al QR del cliente;
 * si no escanea, teclea el código corto. Si el cliente intenta 3 códigos
 * inválidos en 1 minuto, la caja se bloquea 5 min (anti-fraude).
 *
 * Decisión técnica:
 *   - `react-native-vision-camera` requiere build nativo; si el scanner no
 *     puede cargarse (p.ej. Expo Go), caemos al input manual sin romper UI.
 *   - El rate limit lo impone el backend; aquí sólo mostramos el 429 con el
 *     mensaje textual del API.
 *   - Después de un success reseteamos el estado para el siguiente cliente.
 */

import React, { useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { redeemByJwt, redeemByShortCode, type RedeemResponse } from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

// Vision camera es nativo; importamos defensivo para no romper Expo Go.
let CodeScanner: React.ComponentType<{ onScan: (value: string) => void }> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  CodeScanner = require('@/components/CodeScanner').CodeScanner;
} catch {
  CodeScanner = null;
}

export default function ScannerScreen() {
  const [mode, setMode] = useState<'camera' | 'manual'>(CodeScanner ? 'camera' : 'manual');
  const [shortCode, setShortCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<RedeemResponse | null>(null);
  const [blocked, setBlocked] = useState(false);

  const onSuccess = (r: RedeemResponse) => {
    setLastResult(r);
    setShortCode('');
    Alert.alert('Cupón redimido', r.message);
  };

  const onError = (err: unknown) => {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
      'No pudimos redimir el cupón.';
    if (status === 429) {
      setBlocked(true);
      setTimeout(() => setBlocked(false), 5 * 60 * 1000);
    }
    Alert.alert('Aviso', msg);
  };

  const submitJwt = async (jwt: string) => {
    if (blocked || submitting) return;
    setSubmitting(true);
    try {
      const r = await redeemByJwt(jwt);
      onSuccess(r);
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitShortCode = async () => {
    if (!shortCode.trim()) return;
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const r = await redeemByShortCode(shortCode.trim().toUpperCase());
      onSuccess(r);
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, mode === 'camera' && styles.tabActive]}
          onPress={() => setMode('camera')}
          disabled={!CodeScanner}
        >
          <Text style={[styles.tabTxt, mode === 'camera' && styles.tabTxtActive]}>
            Cámara{!CodeScanner ? ' (no disponible)' : ''}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === 'manual' && styles.tabActive]}
          onPress={() => setMode('manual')}
        >
          <Text style={[styles.tabTxt, mode === 'manual' && styles.tabTxtActive]}>Código</Text>
        </Pressable>
      </View>

      {blocked && (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedTxt}>
            Escaneo bloqueado por intentos fallidos. Espera 5 minutos.
          </Text>
        </View>
      )}

      {mode === 'camera' && CodeScanner ? (
        <View style={styles.cameraWrap}>
          <CodeScanner onScan={submitJwt} />
          <Text style={styles.hint}>
            Apunta la cámara al QR del cliente. Se procesa automáticamente.
          </Text>
        </View>
      ) : (
        <View style={styles.manualBlock}>
          <Text style={styles.label}>Código del cliente</Text>
          <TextInput
            style={styles.input}
            placeholder="XXXXXXXX"
            autoCapitalize="characters"
            maxLength={8}
            value={shortCode}
            onChangeText={setShortCode}
          />
          <Button
            title={submitting ? 'Validando…' : 'Redimir'}
            onPress={submitShortCode}
            disabled={submitting || blocked}
          />
          {Platform.OS === 'web' && (
            <Text style={styles.hint}>
              La cámara solo funciona en iOS/Android. Usa el código corto aquí.
            </Text>
          )}
        </View>
      )}

      {lastResult && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Último cupón redimido</Text>
          <Text style={styles.resultLine}>Cliente: {lastResult.consumer_name}</Text>
          <Text style={styles.resultLine}>{lastResult.message}</Text>
          <Text style={styles.resultLine}>
            Descuento aplicado: ${lastResult.discount_applied.toFixed(2)}
          </Text>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.pill,
    padding: spacing.xs,
  },
  tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.pill },
  tabActive: { backgroundColor: colors.primary },
  tabTxt: { color: colors.textMuted, fontWeight: '700' },
  tabTxtActive: { color: '#FFF' },
  blockedBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  blockedTxt: { color: colors.danger, fontWeight: '700' },
  cameraWrap: { flex: 1, minHeight: 320, gap: spacing.sm },
  hint: { color: colors.textMuted, textAlign: 'center' },
  manualBlock: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: fontSize.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
  },
  resultBox: {
    backgroundColor: colors.bgMuted,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  resultTitle: { fontWeight: '800', color: colors.textPrimary },
  resultLine: { color: colors.textPrimary },
});
