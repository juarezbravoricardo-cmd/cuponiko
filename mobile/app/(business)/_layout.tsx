import React from 'react';
import { Stack } from 'expo-router';

export default function BusinessLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, headerTitleAlign: 'center' }}>
      <Stack.Screen name="dashboard" options={{ title: 'Mi negocio' }} />
      <Stack.Screen name="coupons/index" options={{ title: 'Mis cupones' }} />
      <Stack.Screen name="coupons/new" options={{ title: 'Crear cupón' }} />
      <Stack.Screen name="scanner" options={{ title: 'Escanear QR' }} />
      <Stack.Screen name="upgrade" options={{ title: 'Hazte Premium' }} />
    </Stack>
  );
}
