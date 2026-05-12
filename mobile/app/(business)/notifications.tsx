/**
 * Business · Centro de notificaciones.
 *
 * Dos paneles:
 *  1) Composer: envía push segmentado a clientes (NOTIFY-04, Premium).
 *     Segmentos: all | active | inactive | frequent.
 *  2) Bandeja propia (NOTIFY-01): mismas notificaciones del usuario actual,
 *     útil para que el negocio vea sus alertas internas (anuncios pausados,
 *     límites alcanzados, etc).
 *
 * Errores LITERALES del backend.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { sendToSegment, type NotificationSegment, type NotificationItem } from '@/services/notificationsApi';
import { useNotifications } from '@/stores/notificationStore';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const SEGMENTS: { value: NotificationSegment; label: string; hint: string }[] = [
  { value: 'all', label: 'Todos', hint: 'Todos tus clientes activos' },
  { value: 'active', label: 'Activos', hint: 'Han canjeado en últimos 30 días' },
  { value: 'inactive', label: 'Inactivos', hint: 'Sin actividad en 60+ días' },
  { value: 'frequent', label: 'Frecuentes', hint: '5+ canjes en últimos 90 días' },
];

export default function BusinessNotifications() {
  const {
    items,
    pagination,
    loading,
    loadingMore,
    error: bandejaError,
    fetchPage,
    loadMore,
    markAsRead,
  } = useNotifications();

  const [segment, setSegment] = useState<NotificationSegment>('active');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  useEffect(() => {
    void fetchPage(1);
  }, [fetchPage]);

  const onSend = useCallback(async () => {
    setComposerError(null);
    if (!title.trim() || !body.trim()) {
      setComposerError('Completa título y cuerpo del mensaje.');
      return;
    }
    setSending(true);
    try {
      const r = await sendToSegment(segment, title.trim(), body.trim());
      Alert.alert('Notificación enviada', `${r.message} (${r.sent_to} destinatarios)`);
      setTitle('');
      setBody('');
    } catch (e) {
      setComposerError(extractApiError(e).error);
    } finally {
      setSending(false);
    }
  }, [segment, title, body]);

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <Pressable
        onPress={() => !item.read && void markAsRead(item.id)}
        style={[
          styles.notifRow,
          !item.read && { borderColor: colors.primary },
        ]}
      >
        <Text style={[styles.notifTitle, !item.read && { fontWeight: '800' }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
      </Pressable>
    ),
    [markAsRead]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.title}>Notificaciones</Text>
              <Text style={styles.subtitle}>
                Envía mensajes push a tus clientes y revisa tus alertas internas.
              </Text>
            </View>

            <View style={styles.composerCard}>
              <Text style={styles.sectionTitle}>Enviar a un segmento</Text>
              <View style={styles.segmentRow}>
                {SEGMENTS.map((s) => {
                  const active = s.value === segment;
                  return (
                    <Pressable
                      key={s.value}
                      onPress={() => setSegment(s.value)}
                      style={[styles.segmentChip, active && styles.segmentChipActive]}
                    >
                      <Text style={[styles.segmentChipText, active && { color: '#FFFFFF' }]}>
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.segmentHint}>
                {SEGMENTS.find((s) => s.value === segment)?.hint}
              </Text>
              <TextInput
                placeholder="Título"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
                style={styles.input}
                maxLength={80}
              />
              <TextInput
                placeholder="Cuerpo del mensaje"
                placeholderTextColor={colors.textMuted}
                value={body}
                onChangeText={setBody}
                style={[styles.input, { minHeight: 80 }]}
                multiline
                maxLength={240}
              />
              {!!composerError && <Text style={styles.error}>{composerError}</Text>}
              <Button title="Enviar notificación" onPress={onSend} loading={sending} />
            </View>

            <Text style={styles.sectionTitleStandalone}>Mi bandeja</Text>
          </View>
        }
        data={items}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => fetchPage(1)} tintColor={colors.primary} />
        }
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ padding: spacing.lg }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : pagination && pagination.page >= pagination.total_pages && items.length > 0 ? (
            <Text style={styles.footerEnd}>No hay más alertas.</Text>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Sin alertas internas por ahora.</Text>
              {!!bandejaError && <Text style={styles.error}>{bandejaError}</Text>}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgMuted },
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  composerCard: {
    backgroundColor: colors.bgLight, borderRadius: radii.lg,
    padding: spacing.lg, gap: spacing.md, marginHorizontal: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  sectionTitleStandalone: {
    fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary,
    paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  segmentChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgMuted,
  },
  segmentChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: fontSize.sm },
  segmentHint: { fontSize: fontSize.xs, color: colors.textMuted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    padding: spacing.md, color: colors.textPrimary, fontSize: fontSize.sm,
    backgroundColor: colors.bgMuted,
  },
  error: { color: colors.danger, fontSize: fontSize.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  notifRow: {
    backgroundColor: colors.bgLight, borderRadius: radii.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  notifTitle: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
  notifBody: { color: colors.textMuted, marginTop: spacing.xs, fontSize: fontSize.sm },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  footerEnd: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center', fontSize: fontSize.xs },
});
