# Cuponiko — Mobile (Expo + React Native + TypeScript)

## Requisitos

- Node 20+
- `npm i -g expo-cli` (opcional; `npx expo` también funciona)
- Para iOS real: Xcode 15+ / Android: Android Studio

## Instalación

```bash
cd mobile
npm install
```

> En el sandbox de desarrollo las dependencias no se instalaron (no hay acceso
> al CDN de Expo). En tu máquina local ejecuta `npm install` y después
> `npx expo start`.

## Variables

Edita `app.json` → `expo.extra`:

- `apiBaseUrl`: URL de tu backend (Railway). Default: `https://api.cuponiko.mx`
- `stripePublishableKey`: clave pública de Stripe (test o live)
- `googleWebClientId`: client ID web de Google OAuth

## Estructura

```
app/
  _layout.tsx          # AuthGate + Stack raíz
  index.tsx            # redirect
  (auth)/              # login, register-consumer, register-business, verify-*, forgot, reset
  (consumer)/home.tsx  # placeholder — Fase 2 añade mapa de cupones
  (business)/dashboard.tsx + upgrade.tsx
  (admin)/dashboard.tsx
components/
  Button, TextField, ScreenContainer
services/
  api.ts               # axios + SecureStore + refresh automático
stores/
  authStore.ts         # zustand: user, login, logout, hydrate
utils/
  theme.ts             # design tokens
```

## Flujo deep link password reset

El backend AUTH-09 emite `cuponiko://auth/reset-password?token=...`. Gracias a
`scheme: cuponiko` en `app.json` y a expo-router, abrir ese URL dispara la
pantalla `(auth)/reset-password.tsx` con el token ya parseado.
