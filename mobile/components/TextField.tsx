import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, radii, spacing, fontSize } from '@/utils/theme';

interface Props extends TextInputProps {
  label: string;
  error?: string;
}

export function TextField({ label, error, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, !!error && styles.inputError, style]}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    backgroundColor: colors.bgLight,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: fontSize.xs, marginTop: spacing.xs },
});
