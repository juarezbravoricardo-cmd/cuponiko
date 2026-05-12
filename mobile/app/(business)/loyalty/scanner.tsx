/**
 * Business · Escanear QR de lealtad del consumidor.
 *
 * Reutiliza CodeScanner.tsx (vision-camera). El escáner está envuelto con
 * `require` dinámico porque vision-camera necesita build nativo (EAS); en
 * Expo Go se hace fallback a entrada manual del token.
 *
 * Flujo:
 *  1. Cámara/manual → token (string) capturado.
 *  2. POST /api/loyalty/stamp { qr_token }
 *  3. Resultado verde con sello agregado y count actual, o resultado rojo
 *     con el mensaje LITERAL del backend.
 *
 * Reglas:
 *  - Haptic feedback en sello agregado (success) y en error (warning).
 *  - Después de cada scan se desbloquea el escáner a los 3s (CodeScanner ya
 *    aplica throttling interno).
 */

import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { stampLoyalty, type StampResponse } from '@/services/loyaltyApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

// Carga dinámica del componente nativo: si no está disponible (Expo Go web)
// caemos a modo manual.
let CodeScannerLoaded: React.ComponentType<{ onScan: (v: string) => void }> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  CodeScannerLoaded = require('@/components/CodeScanner').CodeScanner;
} catch {
  CodeScannerLoaded = null;
}

type Mode = 'camera' | 'manual';

export default function BusinessLoyaltyScanner() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(CodeScannerLoaded ? 'camera' : 'manual');
  const [manualToken, setManualToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'ok'; data: StampResponse }
    | { kind: 'error'; message: string }
    | null
  >(null);

  const handleStamp = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await stampLoyalty(token.trim());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult({ kind: 'ok', data: r });
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setResult({ kind: 'error', message: extractApiError(e).error });
    } finally {
      setBusy(false);
    }
  }, []);

  const onManualSubmit = useCallback(() => {
    if (!manualToken.trim()) {
      Alert.alert('Token vacío', 'Pega o escribe el token del QR.');
      return;
    }
    void handleStamp(manualToken.trim());
  }, [manualToken, handleStamp]);

  return (
    <ScreenContainer scroll>
      <Text style={styles.title}>Asignar sello de lealtad</Text>
      <Text style={styles.sub}>
        Escanea el QR personal del cliente para acumular un sello en su tarjeta.
      </Text>

      <View style={styles.toggleRow}>
        {CodeScannerLoaded && (
          <Pill
            label="Cámara"
            active={mode === 'camera'}
            onPress={() => setMode('camera')}
          />
        )}
        <Pill
          label="Pegar token"
          active={mode === 'manual'}
          onPress={() => setMode('manual')}
        />
      </View>

      {mode === 'camera' && CodeScannerLoaded && (
        <View style={styles.cameraWrap}>
          <CodeScannerLoaded onScan={handleStamp} />
        </View>
      )}

      {mode === 'manual' && (
        <View style={styles.section}>
          <TextInput
            value={manualToken}
            onChangeText={setManualToken}
            placeholder="Pega aquí el token del QR del cliente"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <Button
            title="Asignar sello"
            onPress={onManualSubmit}
            loading={busy}
            disabled={!manualToken.trim()}
          />
        </View>
      )}

      {result?.kind === 'ok' && (
        <View style={[styles.resultCard, { borderColor: colors.success }]}>
          <Text style={[styles.resultTitle, { color: colors.success }]}>
            Sello agregado
          </Text>
          <Text style={styles.resultText}>{result.data.message}</Text>
          <Text style={styles.resultCounter}>
            {result.data.stamps_count} / {result.data.stamps_required} sellos
          </Text>
          {result.data.reward_unlocked && (
            <Text style={styles.rewardUnlocked}>
              ¡El cliente ya puede canjear su recompensa!
            </Text>
          )}
        </View>
      )}

      {result?.kind === 'error' && (
        <View style={[styles.resultCard, { borderColor: colors.danger }]}>
          <Text style={[styles.resultTitle, { color: colors.danger }]}>No se pudo</Text>
          <Text style={styles.resultText}>{result.message}</Text>
        </View>
      )}

      <Button title="Volver" variant="ghost" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <View style={styles.pillWrap}>
      <Text
        onPress={onPress}
        style={[
          styles.pill,
          active && { backgroundColor: colors.primary, color: '#FFFFFF', borderColor: colors.primary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, fontSize: fontSize.sm },
  toggleRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
  pillWrap: { flexShrink: 0 },
  pill: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, fontWeight: '600', overflow: 'hidden',
  },
  cameraWrap: {
    height: 360, borderRadius: radii.lg, overflow: 'hidden',
    backgroundColor: '#000', marginVertical: spacing.sm,
  },
  section: { gap: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    padding: spacing.md, color: colors.textPrimary, minHeight: 80,
    backgroundColor: colors.bgLight, fontSize: fontSize.sm,
  },
  resultCard: {
    backgroundColor: colors.bgLight, borderRadius: radii.lg,
    padding: spacing.lg, borderWidth: 2, gap: spacing.xs,
  },
  resultTitle: { fontSize: fontSize.lg, fontWeight: '800' },
  resultText: { color: colors.textPrimary, fontSize: fontSize.sm },
  resultCounter: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  rewardUnlocked: { color: colors.success, fontWeight: '700', marginTop: spacing.xs },
});
