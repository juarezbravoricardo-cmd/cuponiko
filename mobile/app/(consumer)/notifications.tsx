/**
 * Consumer · Bandeja de notificaciones.
 *
 * Funciones:
 *  - Lista paginada (20/página) con scroll infinito.
 *  - Tap en notif no leída → markAsRead() optimista.
 *  - Pull-to-refresh, loading skeleton, empty state, error state.
 *
 * El conteo de no leídas vive en `useNotifications.unreadCount` y se
 * actualiza tras cada marcación; lo refrescamos al montar para sincronizar
 * con el badge del tab bar.
 */

import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotifications } from '@/stores/notificationStore';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import type { NotificationItem } from '@/services/notificationsApi';

export default function ConsumerNotifications() {
  const {
    items,
    pagination,
    loading,
    loadingMore,
    error,
    fetchPage,
    loadMore,
    markAsRead,
    refreshUnreadCount,
  } = useNotifications();

  useEffect(() => {
    void fetchPage(1);
    void refreshUnreadCount();
  }, [fetchPage, refreshUnreadCount]);

  const onRefresh = useCallback(() => {
    void fetchPage(1);
    void refreshUnreadCount();
  }, [fetchPage, refreshUnreadCount]);

  const onPressItem = useCallback(
    (item: NotificationItem) => {
      if (!item.read) {
        void markAsRead(item.id);
      }
    },
    [markAsRead]
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => (
      <NotificationRow item={item} onPress={() => onPressItem(item)} />
    ),
    [onPressItem]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notificaciones</Text>
        <Text style={styles.subtitle}>
          Recibe alertas de cupones, lealtad y novedades de tus negocios favoritos.
        </Text>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : pagination && pagination.page >= pagination.total_pages && items.length > 0 ? (
              <Text style={styles.footerEnd}>No hay más notificaciones.</Text>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Bandeja vacía</Text>
                <Text style={styles.emptyText}>
                  Cuando recibas alertas o promociones, aparecerán aquí.
                </Text>
                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function NotificationRow({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !item.read && styles.rowUnread,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.dotCol}>
        {!item.read && <View style={styles.unreadDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.rowDate}>{formatDate(item.created_at)}</Text>
      </View>
    </Pressable>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgMuted },
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  errorText: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.bgLight,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowUnread: { borderColor: colors.primary },
  dotCol: { width: 12, alignItems: 'center', paddingTop: 6 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  rowTitle: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: '600' },
  rowTitleUnread: { fontWeight: '800' },
  rowBody: { color: colors.textMuted, marginTop: spacing.xs, fontSize: fontSize.sm },
  rowDate: { color: colors.textMuted, marginTop: spacing.xs, fontSize: fontSize.xs },
  footer: { padding: spacing.lg, alignItems: 'center' },
  footerEnd: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center', fontSize: fontSize.xs },
});
