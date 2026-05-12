/**
 * Layout business — Tabs principales + Stack interno.
 *
 * Analogía: la "trastienda" del comercio. Cinco accesos persistentes (Inicio,
 * Cupones, Lealtad, Anuncios, Perfil) y todas las pantallas de detalle
 * (`coupons/new`, `scanner`, `loyalty/new`, etc.) se apilan dentro de la tab
 * activa, manteniendo el contexto.
 *
 * Las funcionalidades extra (notificaciones, exports, upgrade) viven como
 * pantallas internas accesibles desde "Inicio" para no saturar el tab bar
 * (5 ítems es el máximo recomendado en mobile).
 */

import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors, fontSize } from '@/utils/theme';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function BusinessLayout() {
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
        name="dashboard"
        options={{
          title: 'Mi negocio',
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color }) => <TabIcon glyph="🏪" color={color} />,
        }}
      />
      <Tabs.Screen
        name="coupons/index"
        options={{
          title: 'Mis cupones',
          tabBarLabel: 'Cupones',
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
        name="ads/index"
        options={{
          title: 'Anuncios',
          tabBarLabel: 'Anuncios',
          tabBarIcon: ({ color }) => <TabIcon glyph="📢" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarLabel: 'Perfil',
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />

      {/* Pantallas internas — sin tab visible */}
      <Tabs.Screen name="coupons/new" options={{ href: null, title: 'Crear cupón' }} />
      <Tabs.Screen name="scanner" options={{ href: null, title: 'Escanear QR' }} />
      <Tabs.Screen name="upgrade" options={{ href: null, title: 'Hazte Premium' }} />
      <Tabs.Screen name="loyalty/new" options={{ href: null, title: 'Crear tarjeta' }} />
      <Tabs.Screen name="loyalty/scanner" options={{ href: null, title: 'Escanear sello' }} />
      <Tabs.Screen name="ads/new" options={{ href: null, title: 'Nuevo anuncio' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notificaciones' }} />
      <Tabs.Screen name="exports" options={{ href: null, title: 'Exportar reportes' }} />
    </Tabs>
  );
}
