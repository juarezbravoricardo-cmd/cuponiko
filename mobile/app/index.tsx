import { Redirect } from 'expo-router';

export default function Index() {
  // El AuthGate del _layout redirige según haya sesión. Como fallback:
  return <Redirect href="/(auth)/login" />;
}
