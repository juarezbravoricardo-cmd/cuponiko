/**
 * Wrapper de react-native-vision-camera para leer QR codes.
 *
 * Analogía: la lente de un supermercado. Sólo encendida cuando la pantalla
 * está visible, y lanza `onScan(value)` al detectar un QR válido.
 *
 * Nota: este componente se carga vía `require` dinámico en `scanner.tsx`
 * porque `react-native-vision-camera` necesita build nativo (EAS o prebuild).
 * En Expo Go web/dev NO está disponible y `scanner.tsx` cae al modo manual.
 *
 * Buenas prácticas:
 *   - Pedimos permisos una sola vez al montar.
 *   - `useCodeScanner` con `qr` para no procesar otros formatos.
 *   - Throttling: una vez que disparamos `onScan` bloqueamos escaneos
 *     subsecuentes por 3 s (evita re-disparar con el mismo frame).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
  type Code,
} from 'react-native-vision-camera';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

interface Props {
  onScan: (value: string) => void;
}

export function CodeScanner({ onScan }: Props) {
  const device = useCameraDevice('back');
  const [permission, setPermission] = useState<'granted' | 'denied' | 'pending'>('pending');
  const lockedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setPermission(status === 'granted' ? 'granted' : 'denied');
    })();
  }, []);

  const scanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: Code[]) => {
      if (lockedRef.current || codes.length === 0) return;
      const value = codes[0].value;
      if (!value) return;
      lockedRef.current = true;
      onScan(value);
      setTimeout(() => {
        lockedRef.current = false;
      }, 3000);
    },
  });

  const content = useMemo(() => {
    if (permission === 'pending') return <Text style={styles.hint}>Solicitando cámara…</Text>;
    if (permission === 'denied')
      return (
        <Text style={styles.hint}>
          Permiso de cámara denegado. Activa el permiso desde los ajustes del dispositivo.
        </Text>
      );
    if (!device) return <Text style={styles.hint}>No se detectó cámara trasera.</Text>;
    return (
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={scanner}
      />
    );
  }, [device, permission, scanner]);

  return (
    <View style={styles.wrap}>
      <View style={styles.frame}>{content}</View>
      <View style={styles.crosshair} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    minHeight: 320,
  },
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  crosshair: {
    position: 'absolute',
    top: '15%',
    left: '15%',
    right: '15%',
    bottom: '15%',
    borderWidth: 2,
    borderColor: '#FFFFFFCC',
    borderRadius: radii.md,
  },
  hint: {
    color: '#FFF',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
  },
});
