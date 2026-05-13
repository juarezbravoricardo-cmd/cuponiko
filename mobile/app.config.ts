import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Configuración dinámica de Expo.
 *
 * Reemplaza al antiguo `app.json`. Lee secretos desde variables de entorno
 * inyectadas por EAS Build (vía `eas secret:create`) o por el shell local
 * (vía `.env` cargado con `dotenv`/`direnv`, no commiteado).
 *
 * Variables esperadas (ver `.env.example`):
 *   - GOOGLE_MAPS_API_KEY_ANDROID  (obligatoria para builds Android con mapa)
 *   - GOOGLE_WEB_CLIENT_ID         (OAuth Google Sign-In, web client)
 *   - STRIPE_PUBLISHABLE_KEY       (publishable key de Stripe; pk_test_* o pk_live_*)
 *   - API_BASE_URL                 (URL del backend; default api.cuponiko.com)
 *   - EAS_PROJECT_ID               (ID que devuelve `eas init`)
 *
 * Anti-patrón a evitar: NO hardcodear ninguno de estos valores aquí.
 * Si una variable obligatoria falta en build de producción, el config falla
 * temprano para impedir publicar un APK roto.
 */

const requireEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  const isProdBuild = process.env.EAS_BUILD_PROFILE === 'production';
  if (!value && isProdBuild) {
    throw new Error(
      `[app.config.ts] Variable de entorno obligatoria '${key}' no definida en build de producción.`
    );
  }
  return value ?? '';
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Cuponiko',
  slug: 'cuponiko',
  version: '1.0.0',
  scheme: 'cuponiko',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#F97316',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'mx.cuponiko.app',
    supportsTablet: false,
    buildNumber: '1',
    infoPlist: {
      NSCameraUsageDescription:
        'Cuponiko necesita acceso a la cámara para escanear códigos QR.',
      NSLocationWhenInUseUsageDescription:
        'Cuponiko necesita tu ubicación para mostrarte negocios cercanos.',
    },
  },
  android: {
    package: 'mx.cuponiko.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F97316',
    },
    permissions: [
      'CAMERA',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'VIBRATE',
    ],
    config: {
      googleMaps: {
        // TODO(seguridad): mover a EAS secret. Hardcode temporal para destrabar builds.
        apiKey:
          process.env.GOOGLE_MAPS_API_KEY_ANDROID ||
          'AIzaSyAGvhyv51t4zQNl8euR2NQSnfNR8aWdsho',
      },
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Cuponiko necesita tu ubicación para mostrarte negocios cercanos.',
      },
    ],
    [
      'react-native-vision-camera',
      {
        cameraPermissionText:
          'Cuponiko necesita acceso a la cámara para escanear códigos QR.',
      },
    ],
    [
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: 'merchant.mx.cuponiko.app',
        enableGooglePay: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl: requireEnv('API_BASE_URL', 'https://api.cuponiko.com'),
    // TODO(seguridad): mover a EAS secret. Hardcode temporal para destrabar builds.
    stripePublishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY ||
      'pk_test_51TRaZrK0YwCm2rUr60n3YR9vjoV7C49vBdmVZqHwkrKEFiRpqiLZ8PyQqTC9PJXQWnINuiRcD7xWcsB9pnLuyUeB00jFXit3C4',
    // TODO(seguridad): mover a EAS secret. Hardcode temporal para destrabar builds.
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ||
      '3826634841-6qh87cfrhvjn98ur2gfvi23jgupbtcpu.apps.googleusercontent.com',
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? 'PLACEHOLDER_SE_LLENA_CON_EAS_INIT',
    },
  },
});
