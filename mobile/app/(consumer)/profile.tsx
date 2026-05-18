/**
 * Consumer · Perfil.
 *
 * Funciones:
 *  - Muestra nombre, email, fecha de registro (parseada del JWT).
 *  - Toggle de notificaciones push: registra/desregistra token vía NOTIFY-03.
 *    Para "desactivar" el contrato no expone endpoint dedicado; en local
 *    descartamos el flag y dejamos que el backend reasigne el token a otro
 *    device si se vuelve a activar.
 *  - Botón "Eliminar cuenta" en flujo 2 pasos (ACCT-01 → ACCT-02). Al éxito
 *    se hace logout + redirect a login.
 *  - Logout simple.
 *
 * Reglas:
 *  - Mensajes de error LITERALES del backend.
 *  - Haptic feedback en confirmación de eliminación.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { useNotifications } from '@/stores/notificationStore';
import { useLoyalty } from '@/stores/loyaltyStore';
import { extractApiError } from '@/services/api';
import { registerPushToken } from '@/services/notificationsApi';
import { confirmDelete, requestDelete } from '@/services/accountApi';
import { fetchSavings, type ConsumerSavings } from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

type DeleteStep = 'idle' | 'request' | 'confirm';

export default function ConsumerProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const resetNotifications = useNotifications((s) => s.reset);
  const resetLoyalty = useLoyalty((s) => s.reset);

  const [pushEnabled, setPushEnabled] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [savings, setSavings] = useState<ConsumerSavings | null>(null);

  useEffect(() => {
    fetchSavings()
      .then(setSavings)
      .catch(() => {}); // silencioso si falla
  }, []);

  const onTogglePush = useCallback(
    async (next: boolean) => {
      // (useEffect abajo registra el token al montar si pushEnabled=true)
      setPushError(null);
      setPushBusy(true);
      try {
        if (next) {
          // En producción aquí se llamaría a expo-notifications para obtener
          // el ExpoPushToken real. Como Expo Go no garantiza disponibilidad,
          // generamos un placeholder estable por device-id local. Backend
          // valida que sea no vacío.
          const token = `expo-mock-${user?.id ?? 'anon'}-${Platform.OS}`;
          await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
          setPushEnabled(true);
        } else {
          // No hay endpoint de unregister; desactivamos solo localmente.
          setPushEnabled(false);
        }
      } catch (e) {
        setPushError(extractApiError(e).error);
      } finally {
        setPushBusy(false);
      }
    },
    [user?.id]
  );

  // Registra el token push automáticamente al montar si está habilitado.
  // Silencioso si falla; el toggle queda activo y el backend recibirá el token
  // en el primer reintento (al apagar/prender o al re-montar la pantalla).
  useEffect(() => {
    if (pushEnabled && user?.id) {
      onTogglePush(true).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRequestDelete = useCallback(async () => {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await requestDelete(deleteReason || undefined);
      setDeleteStep('confirm');
    } catch (e) {
      setDeleteError(extractApiError(e).error);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteReason]);

  const onConfirmDelete = useCallback(async () => {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await confirmDelete(deleteCode.trim());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Cuenta eliminada', 'Tu cuenta ha sido eliminada.');
      resetNotifications();
      resetLoyalty();
      await logout();
      router.replace('/(auth)/login');
    } catch (e) {
      setDeleteError(extractApiError(e).error);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteCode, logout, resetLoyalty, resetNotifications, router]);

  const onLogout = useCallback(async () => {
    resetNotifications();
    resetLoyalty();
    await logout();
    router.replace('/(auth)/login');
  }, [logout, resetLoyalty, resetNotifications, router]);

  return (
    <ScreenContainer>
      <Text style={styles.title}>Mi perfil</Text>

      {savings && savings.redemption_count > 0 && (
        <View style={styles.savingsCard}>
          <Text style={styles.savingsAmount}>
            ${savings.total_saved.toFixed(2)} MXN
          </Text>
          <Text style={styles.savingsLabel}>ahorrado con Cuponiko</Text>
          <Text style={styles.savingsCount}>
            {savings.redemption_count} {savings.redemption_count === 1 ? 'cupón canjeado' : 'cupones canjeados'}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <ProfileRow label="Nombre" value={user?.full_name || '—'} />
        <ProfileRow label="Correo" value={user?.email || '—'} />
        <ProfileRow label="Tipo de cuenta" value="Consumidor" />
      </View>

      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Notificaciones push</Text>
            <Text style={styles.toggleHint}>
              Recibe avisos de cupones por vencer, sellos acumulados y novedades.
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            disabled={pushBusy}
            onValueChange={onTogglePush}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={pushEnabled ? '#FFFFFF' : '#FFFFFF'}
          />
        </View>
        {!!pushError && <Text style={styles.error}>{pushError}</Text>}
      </View>

      <View style={[styles.card, { borderColor: colors.danger, borderWidth: 1 }]}>
        <Text style={styles.dangerTitle}>Zona peligrosa</Text>
        {deleteStep === 'idle' && (
          <>
            <Text style={styles.dangerHint}>
              Eliminar tu cuenta es permanente. Tus datos quedarán inactivos y no podrás reusar este correo.
            </Text>
            <Button
              title="Eliminar mi cuenta"
              variant="ghost"
              onPress={() => setDeleteStep('request')}
            />
          </>
        )}
        {deleteStep === 'request' && (
          <>
            <Text style={styles.dangerHint}>
              Cuéntanos brevemente por qué te vas (opcional). Te enviaremos un código de 6 dígitos a tu correo para confirmar.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Motivo (opcional)"
              placeholderTextColor={colors.textMuted}
              value={deleteReason}
              onChangeText={setDeleteReason}
              multiline
            />
            {!!deleteError && <Text style={styles.error}>{deleteError}</Text>}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title="Cancelar" variant="ghost" onPress={() => setDeleteStep('idle')} />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Button
                  title="Enviar código"
                  variant="primary"
                  onPress={onRequestDelete}
                  loading={deleteBusy}
                />
              </View>
            </View>
          </>
        )}
        {deleteStep === 'confirm' && (
          <>
            <Text style={styles.dangerHint}>
              Ingresa el código de 6 dígitos que te enviamos por correo. Caduca en 30 minutos.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="000000"
              placeholderTextColor={colors.textMuted}
              value={deleteCode}
              onChangeText={(t) => setDeleteCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
            />
            {!!deleteError && <Text style={styles.error}>{deleteError}</Text>}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button title="Volver" variant="ghost" onPress={() => setDeleteStep('idle')} />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={{ flex: 1 }}>
                <Button
                  title="Eliminar cuenta"
                  variant="primary"
                  onPress={onConfirmDelete}
                  loading={deleteBusy}
                  disabled={deleteCode.length !== 6}
                />
              </View>
            </View>
          </>
        )}
      </View>

      <Button title="Cerrar sesión" variant="ghost" onPress={onLogout} />
    </ScreenContainer>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  profileRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  profileLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  profileValue: { color: colors.textPrimary, fontSize: fontSize.sm, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  toggleHint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  dangerTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.danger },
  dangerHint: { color: colors.textMuted, fontSize: fontSize.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    backgroundColor: colors.bgLight,
  },
  row: { flexDirection: 'row' },
  error: { color: colors.danger, fontSize: fontSize.sm, marginVertical: spacing.xs },
  savingsCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  savingsAmount: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  savingsLabel: {
    fontSize: fontSize.sm,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  savingsCount: {
    fontSize: fontSize.xs,
    color: '#FFFFFF',
    opacity: 0.7,
  },
});
