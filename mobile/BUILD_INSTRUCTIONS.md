# Build Instructions — Cuponiko Mobile

Guía para generar builds nativos de Cuponiko (Android primero, iOS cuando la cuenta de Apple Developer esté lista).

## Prerequisitos

- Node.js 20+
- pnpm 11+ (el repo usa pnpm; ver `mobile/.npmrc`)
- EAS CLI: `npm install -g eas-cli`
- Cuenta Expo: <https://expo.dev>

> Nota sobre pnpm + React Native: este proyecto usa `node-linker=hoisted` y `shamefully-hoist=true` (ver `.npmrc`). Es necesario porque varias dependencias nativas (ej. `@babel/runtime`, `react-native`) asumen una resolución estilo npm, no el árbol aislado de pnpm. **No quitar el `.npmrc`**.

## Setup local (una sola vez)

```bash
cd mobile/
pnpm install
```

## Vincular el proyecto a EAS (solo la primera vez)

1. `eas login` — usar tu cuenta de Expo (la del owner: Ricardo).
2. `eas init` — vincula este directorio con un proyecto EAS y devuelve el `projectId`.
3. Guardar el `projectId` como secret EAS (no se commitea):
   ```bash
   eas secret:create --scope project --name EAS_PROJECT_ID --value "<projectId-real>" --type string
   ```
   Para desarrollo local, agregarlo también a `mobile/.env` (ver `.env.example`).

## Configuración de secretos en EAS (obligatorio antes del primer build)

El proyecto migró de `app.json` a `app.config.ts`, que lee todos los valores sensibles desde variables de entorno. Crea los secrets una sola vez por proyecto:

```bash
cd mobile/

eas secret:create --scope project --name GOOGLE_MAPS_API_KEY_ANDROID \
  --value "<api-key-restringida-por-package+SHA1>" --type string

eas secret:create --scope project --name GOOGLE_WEB_CLIENT_ID \
  --value "<client-id>.apps.googleusercontent.com" --type string

eas secret:create --scope project --name STRIPE_PUBLISHABLE_KEY \
  --value "pk_live_xxx" --type string
```

Verificar con `eas secret:list`. Para sobreescribir: `eas secret:delete --name <NAME>` y volver a crear.

> **Anti-patrón a evitar:** no pongas `pk_live_*` ni la API key de Maps en `eas.json` (que sí está en git). Solo `API_BASE_URL` (no es secreto) vive ahí, por profile.

### Desarrollo local

Copia `mobile/.env.example` a `mobile/.env` y llena los valores. Expo CLI lo carga automáticamente al ejecutar `expo start`. `.env` está en `.gitignore` y nunca se commitea.

## Build Android APK (preview / testing)

```bash
cd mobile/
eas build --platform android --profile preview
```

- Genera un `.apk` (no `.aab`) firmado con un keystore que EAS administra automáticamente.
- Al terminar, EAS imprime un URL en `https://expo.dev` para descargar el APK.
- El APK se instala directo en cualquier Android físico con "Orígenes desconocidos" habilitado.

> El profile `preview` en `eas.json` ya inyecta `API_BASE_URL=https://cuponiko-production.up.railway.app` (Railway, mientras el SSL de `api.cuponiko.com` se valida).

## Build iOS (cuando esté lista la Apple Developer Account)

```bash
eas build --platform ios --profile preview
```

Antes del primer build de iOS, EAS pedirá:

- Apple ID + contraseña de tu Apple Developer Account.
- Team ID (lo asigna Apple al inscribirte).
- Bundle ID: `mx.cuponiko.app` (ya configurado).

Para distribuir en dispositivos físicos sin TestFlight, registra primero el UDID:

```bash
eas device:create
```

## Build de producción (Play Store + App Store)

```bash
eas build --platform all --profile production
```

- Android genera un `.aab` (Android App Bundle, requerido por Google Play).
- iOS genera un `.ipa` listo para subir a App Store Connect.
- El profile `production` apunta a `https://api.cuponiko.com` (subir solo cuando el SSL esté validado).

## Submit a las tiendas (después de probar el build)

```bash
# Google Play (track interno)
eas submit --platform android --profile production
# requiere mobile/google-play-key.json (service account JSON)

# App Store
eas submit --platform ios --profile production
# requiere actualizar appleId / ascAppId / appleTeamId en eas.json
```

## OTA updates (Expo EAS Update)

Para enviar cambios solo de JS/TS sin rebuild nativo (no aplica si tocaste `app.json`, plugins o dependencias nativas):

```bash
eas update --branch preview --message "fix: copy en home"
```

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `Unable to resolve module @babel/runtime/...` | Falta hoisting de pnpm | Verificar que `mobile/.npmrc` exista con `node-linker=hoisted` y reinstalar |
| `merchantIdentifier undefined` al cargar config | Plugin de Stripe sin opciones | El plugin debe estar como array en `app.json` con `merchantIdentifier` |
| `Apple Pay setup error` en simulador | Normal en simulador iOS | Probar en dispositivo físico inscrito en Apple Developer |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` al instalar APK | APK sin firmar | Usar siempre `eas build`, nunca `expo run:android` para distribuir |

## Assets

Los archivos en `mobile/assets/` (`icon.png`, `adaptive-icon.png`, `splash.png`, `favicon.png`) son **placeholders generados programáticamente** por `mobile/scripts/generate_placeholder_assets.py`. Reemplazar con los assets de marca finales antes del primer release a tiendas.

## Variables y secretos sensibles

Nunca commitear:

- Service account JSON de Google Play (`google-play-key.json`).
- Credenciales de Apple Developer.
- Keys reales de Stripe (en `app.config.ts` se leen desde `STRIPE_PUBLISHABLE_KEY`; las reales van en EAS Secrets).
- Contenido de `mobile/.env` (incluido en `.gitignore`).

Usar `eas secret:create` para inyectar secrets al build sin que vivan en git. La lista canónica de variables vive en `mobile/.env.example`; cualquier nueva variable debe agregarse ahí + en `app.config.ts` + documentarse en esta sección.
