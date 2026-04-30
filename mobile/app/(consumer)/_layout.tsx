import React from 'react';
import { Stack } from 'expo-router';

export default function ConsumerLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, headerTitleAlign: 'center' }}>
      <Stack.Screen name="home" options={{ title: 'Cuponiko' }} />
      <Stack.Screen name="wallet" options={{ title: 'Mi cartera' }} />
      <Stack.Screen name="business/[id]" options={{ title: 'Negocio' }} />
      <Stack.Screen name="coupon/[id]" options={{ title: 'Cupón' }} />
      <Stack.Screen
        name="qr/[instance_id]"
        options={{ title: 'Tu código', presentation: 'modal' }}
      />
    </Stack>
  );
}
