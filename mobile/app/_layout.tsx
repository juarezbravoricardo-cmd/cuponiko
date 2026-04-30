import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '@/stores/authStore';

/**
 * AuthGate: redirige a (auth) si no hay sesión,
 * a la sección del rol si sí hay. Se ejecuta después de hydrate.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, hydrated, hydrate } = useAuth();
  const router = useRouter();
  const segments = useSegments() as string[];

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    const group = segments[0];
    const isAuthRoute = group === '(auth)';
    if (!user && !isAuthRoute) {
      router.replace('/(auth)/login');
    } else if (user) {
      if (user.role === 'consumer' && group !== '(consumer)') {
        router.replace('/(consumer)/home');
      } else if (user.role === 'business' && group !== '(business)') {
        router.replace('/(business)/dashboard');
      } else if (user.role === 'admin' && group !== '(admin)') {
        router.replace('/(admin)/dashboard');
      }
    }
  }, [hydrated, user, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
