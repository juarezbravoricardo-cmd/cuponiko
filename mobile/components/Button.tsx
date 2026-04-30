import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, fontSize } from '@/utils/theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: Props) {
  const isDisabled = disabled || loading;
  const palette = variantStyles[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <Text style={[styles.text, { color: palette.fg }]}>{title}</Text>
        )}
      </View>
    </Pressable>
  );
}

const variantStyles = {
  primary: { bg: colors.primary, fg: '#FFFFFF', border: colors.primary },
  secondary: { bg: colors.secondary, fg: '#FFFFFF', border: colors.secondary },
  ghost: { bg: 'transparent', fg: colors.primary, border: colors.primary },
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: fontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
