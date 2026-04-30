import { StyleSheet, Text } from 'react-native';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function AdminDashboard() {
  const { logout } = useAuth();
  return (
    <ScreenContainer>
      <Text style={styles.title}>Panel admin</Text>
      <Text style={styles.sub}>Métricas y moderación disponibles en Fase 3.</Text>
      <Button title="Cerrar sesión" variant="ghost" onPress={logout} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginVertical: spacing.md },
});
