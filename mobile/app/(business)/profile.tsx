/**
 * Business · Perfil del negocio.
 *
 * Mismo flujo que consumer/profile pero con toggle de push y eliminar cuenta.
 * Cuando el dueño elimina la cuenta, el backend cascadea: suspende el negocio
 * y caduca cupones, además de marcar al user inactivo.
 *
 * Pricing v2 (Cambios 6/7): muestra el plan activo con etiqueta diferenciada
 * (Gratuito / Premium mensual / Mundialista trimestral) y solo expone el botón
 * "Actualizar a Premium" cuando el plan actual es 'free'. Como hoy el store de
 * auth no expone `plan` ni `billing_interval`, leemos esos campos con tipado
 * laxo y fallback a 'free' — comportamiento seguro: si no hay dato, el botón
 * permanece visible y el upgrade sigue siendo accesible.
 */

import React, { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { useNotifications } from '@/stores/notificationStore';
import { extractApiError } from '@/services/api';
import { registerPushToken } from '@/services/notificationsApi';
import { confirmDelete, requestDelete } from '@/services/accountApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

type DeleteStep = 'idle' | 'request' | 'confirm';

type BusinessLikeUser = {
  plan?: 'free' | 'premium';
  billing_interval?: 'monthly' | 'quarterly';
  subscription_current_period_end?: string | null;
};

function resolvePlanLabel(plan?: string, billingInterval?: string): string {
  if (plan === 'premium') {
    return billingInterval === 'quarterly'
      ? 'Plan Mundialista (trimestral)'
      : 'Plan Premium (mensual)';
  }
  // Default seguro: si el store aún no propaga plan, asumimos Gratuito.
  return 'Plan Gratuito';
}

function formatRenewalDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function BusinessProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const resetNotifications = useNotifications((s) => s.reset);

  // El AuthUser tipado no incluye plan/billing_interval todavía. Leemos con cast
  // laxo para no inventar features en el store. Si el JWT no los trae, el plan
  // se resuelve a 'Plan Gratuito' por defecto.
  const businessUser = (user as unknown as BusinessLikeUser | null) ?? null;
  const currentPlan = businessUser?.plan ?? 'free';
  const billingInterval = businessUser?.billing_interval;
  const planLabel = resolvePlanLabel(currentPlan, billingInterval);
  const nextRenewal = formatRenewalDate(businessUser?.subscription_current_period_end);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onTogglePush = useCallback(
    async (next: boolean) => {
      setPushError(null);
      setPushBusy(true);
      try {
        if (next) {
          const token = `expo-mock-${user?.id ?? 'biz'}-${Platform.OS}`;
          await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
          setPushEnabled(true);
        } else {
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
      Alert.alert('Cuenta eliminada', 'Tu negocio ha sido suspendido y los cupones caducados.');
      resetNotifications();
      await logout();
      router.replace('/(auth)/login');
    } catch (e) {
      setDeleteError(extractApiError(e).error);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteCode, logout, resetNotifications, router]);

  const onLogout = useCallback(async () => {
    resetNotifications();
    await logout();
    router.replace('/(auth)/login');
  }, [logout, resetNotifications, router]);

  return (
    <ScreenContainer>
      <Text style={styles.title}>Perfil del negocio</Text>

      <View style={styles.card}>
        <ProfileRow label="Responsable" value={user?.full_name || '—'} />
        <ProfileRow label="Correo" value={user?.email || '—'} />
        <ProfileRow label="Tipo de cuenta" value="Negocio" />
        <ProfileRow label="Plan actual" value={planLabel} />
        {nextRenewal && <ProfileRow label="Próxima renovación" value={nextRenewal} />}
      </View>

      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Notificaciones push</Text>
            <Text style={styles.toggleHint}>
              Recibe alertas de canjes en tiempo real, anuncios pausados y suspensiones.
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            disabled={pushBusy}
            onValueChange={onTogglePush}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>
        {!!pushError && <Text style={styles.error}>{pushError}</Text>}
      </View>

      {currentPlan === 'free' && (
        <Button
          title="Actualizar a Premium"
          variant="secondary"
          onPress={() => router.push('/(business)/upgrade')}
        />
      )}

      <View style={[styles.card, { borderColor: colors.danger, borderWidth: 1 }]}>
        <Text style={styles.dangerTitle}>Zona peligrosa</Text>
        {deleteStep === 'idle' && (
          <>
            <Text style={styles.dangerHint}>
              Eliminar la cuenta suspende tu negocio y caduca cupones activos. Es irreversible.
            </Text>
            <Button title="Eliminar mi cuenta" variant="ghost" onPress={() => setDeleteStep('request')} />
          </>
        )}
        {deleteStep === 'request' && (
          <>
            <Text style={styles.dangerHint}>
              Te enviaremos un código de 6 dígitos al correo registrado para confirmar.
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
                <Button title="Enviar código" onPress={onRequestDelete} loading={deleteBusy} />
              </View>
            </View>
          </>
        )}
        {deleteStep === 'confirm' && (
          <>
            <Text style={styles.dangerHint}>
              Ingresa el código de 6 dígitos que enviamos a tu correo. Caduca en 30 minutos.
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
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  card: {
    backgroundColor: colors.bgLight, borderRadius: radii.lg,
    padding: spacing.lg, gap: spacing.sm,
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
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    padding: spacing.md, color: colors.textPrimary, fontSize: fontSize.md,
    backgroundColor: colors.bgLight,
  },
  row: { flexDirection: 'row' },
  error: { color: colors.danger, fontSize: fontSize.sm, marginVertical: spacing.xs },
});
