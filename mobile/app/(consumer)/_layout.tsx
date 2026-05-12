/**
 * Layout consumer — Tabs principales + Stack interno.
 *
 * Analogía: el "menú inferior" de tu banco. La navegación principal son 5
 * iconos persistentes (Home, Cartera, Lealtad, Notif, Perfil) y al tocar uno
 * se renderiza su pantalla. Los detalles (`business/[id]`, `coupon/[id]`,
 * `qr/[instance_id]`, `loyalty/[card_id]`) se apilan SOBRE la tab activa.
 *
 * El badge de Notificaciones consume `useNotifications.unreadCount`, que se
 * refresca al hidratar y tras cada `markAsRead`.
 */

import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useNotifications } from '@/stores/notificationStore';
import { useAuth } from '@/stores/authStore';
import { colors, fontSize } from '@/utils/theme';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  // En v1 evitamos dependencias adicionales (e.g. @expo/vector-icons).
  // Los glyphs son emoji estables; cumplen la regla "nunca naranja+morado
  // en mismo elemento" porque su color está controlado por el tab.
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function ConsumerLayout() {
  const { user } = useAuth();
  const unreadCount = useNotifications((s) => s.unreadCount);
  const refreshUnreadCount = useNotifications((s) => s.refreshUnreadCount);

  useEffect(() => {
    if (user?.role === 'consumer') {
      void refreshUnreadCount();
    }
  }, [user?.role, refreshUnreadCount]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleAlign: 'center',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bgLight, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Cuponiko',
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color }) => <TabIcon glyph="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Mi cartera',
          tabBarLabel: 'Cartera',
          tabBarIcon: ({ color }) => <TabIcon glyph="🎟️" color={color} />,
        }}
      />
      <Tabs.Screen
        name="loyalty/index"
        options={{
          title: 'Lealtad',
          tabBarLabel: 'Lealtad',
          tabBarIcon: ({ color }) => <TabIcon glyph="⭐" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notificaciones',
          tabBarLabel: 'Avisos',
          tabBarIcon: ({ color }) => <TabIcon glyph="🔔" color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#FFFFFF' },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Mi perfil',
          tabBarLabel: 'Perfil',
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />
      {/* Pantallas internas (sin tab visible) — apiladas sobre la tab activa */}
      <Tabs.Screen name="business/[id]" options={{ href: null, title: 'Negocio' }} />
      <Tabs.Screen name="coupon/[id]" options={{ href: null, title: 'Cupón' }} />
      <Tabs.Screen name="qr/[instance_id]" options={{ href: null, title: 'Tu código' }} />
      <Tabs.Screen name="loyalty/[card_id]" options={{ href: null, title: 'Tarjeta de lealtad' }} />
    </Tabs>
  );
}
