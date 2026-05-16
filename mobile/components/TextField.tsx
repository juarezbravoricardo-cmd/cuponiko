import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { colors, radii, spacing, fontSize } from '@/utils/theme';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  /**
   * Texto auxiliar bajo el input. Se renderiza solo si NO hay `error`
   * (el error tiene precedencia). Útil para indicar reglas de formato
   * (ej. "Mínimo 8 caracteres y al menos un número.").
   */
  hint?: string;
}

/**
 * TextField compartido.
 *
 * Cambios recientes (UX):
 *  - Cursor visible: `cursorColor` + `selectionColor` apuntan al primary.
 *  - Soporte automático de toggle ojito mostrar/ocultar cuando el caller
 *    pasa `secureTextEntry`. No requiere props nuevas, mantiene la API
 *    backward-compatible: cualquier consumer que ya usaba `secureTextEntry`
 *    obtiene el ojito gratis.
 *  - Prop opcional `hint` para indicaciones de formato bajo el input.
 *
 * Decisión: usamos emojis 👁 / 🙈 como ícono porque `lucide-react-native`
 * NO está instalado en el proyecto (verificado en package.json) y no
 * queremos sumar dependencias por un toggle de un solo uso.
 */
export function TextField({ label, error, hint, style, ...rest }: Props) {
  const isPassword = rest.secureTextEntry === true;
  const [visible, setVisible] = useState(false);

  // Cuando es password, el `secureTextEntry` real depende del toggle local.
  // Se sobrescribe la prop entrante para no perder la pista del valor inicial.
  const effectiveSecure = isPassword ? !visible : rest.secureTextEntry;

  const inputStyle = [
    styles.input,
    isPassword && styles.inputWithIcon,
    !!error && styles.inputError,
    style,
  ];

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      {isPassword ? (
        <View style={styles.passwordWrap}>
          <TextInput
            {...rest}
            secureTextEntry={effectiveSecure}
            placeholderTextColor={colors.textMuted}
            cursorColor={colors.primary}
            selectionColor={colors.primary}
            style={inputStyle}
          />
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            style={styles.eyeBtn}
          >
            <Text style={styles.eyeTxt}>{visible ? '🙈' : '👁'}</Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          {...rest}
          placeholderTextColor={colors.textMuted}
          cursorColor={colors.primary}
          selectionColor={colors.primary}
          style={inputStyle}
        />
      )}

      {!!error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !!hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
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
  inputWithIcon: {
    paddingRight: 44, // espacio para el ícono ojito
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: fontSize.xs, marginTop: spacing.xs },
  hint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  eyeBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeTxt: { fontSize: 18 },
});
