# Cuponiko

App de fidelización multi-negocio geolocalizada para México. Hub hiperlocal de cupones y tarjetas de lealtad para PyMEs, con tres roles (Consumidor, Negocio, Admin), monetización SaaS (Stripe) y operación nativa en iOS y Android.

> **Estado actual:** Cuponiko v1.0 — 119/119 tests PASS (Fases 1, 2, 3 y 3.5 + correcciones pre-producción).

## Stack

| Capa | Tecnologías |
|------|-------------|
| Mobile | React Native + Expo SDK (1 codebase, 3 roles) |
| Backend | Node.js 20 LTS + Express, REST JSON, `pg` directo (sin ORM) |
| Base de datos | PostgreSQL 15+ con PostGIS 3.4+ y `pg_cron` (Supabase) |
| Auth | JWT access+refresh + Google OAuth 2.0 |
| Pagos | Stripe (`@stripe/stripe-react-native` + webhooks idempotentes) |
| Mapas | Google Maps SDK + `@googlemaps/markerclusterer` |
| QR | `react-native-vision-camera` (scan) + `react-native-qrcode-svg` (gen) |
| Storage | Supabase Storage (`business-logos`, `exports-pdf`) |
| Hosting API | Railway |
| OTA mobile | Expo EAS Update |
| SMS | Twilio (verificación de teléfono de negocios) |

## Estructura del repo

```
cuponiko/
├── api/                     # Backend Node.js + Express
│   ├── src/
│   │   ├── config/          # env y conexión a Postgres
│   │   ├── middleware/      # JWT, rate-limit, plan checker, error handler
│   │   ├── routes/          # auth, billing, coupons, wallet, home, loyalty, admin, exports, public…
│   │   ├── services/        # lógica de negocio (auth, coupons, billing, jobs, ads, etc.)
│   │   ├── utils/           # AppError, hash, jwt, logger
│   │   ├── app.js           # construcción de la app Express (importable en tests)
│   │   └── index.js         # bootstrap del servidor (PORT, graceful shutdown)
│   ├── migrations/          # SQL inmutable
│   ├── tests/               # runners de aceptación (run-phase1..3.5)
│   ├── Procfile             # web: node src/index.js (Railway)
│   ├── package.json
│   └── .env.example
│
├── mobile/                  # App React Native + Expo
│   ├── app/                 # rutas Expo Router por rol: (auth) (consumer) (business) (admin)
│   ├── components/
│   ├── hooks/
│   ├── services/            # clientes HTTP (api.ts, couponsApi.ts, loyaltyApi.ts, …)
│   ├── stores/              # Zustand (authStore)
│   ├── utils/
│   ├── app.json
│   └── package.json
│
├── docs/                    # Reportes de fase (FASE3, FASE3.5, PREPROD)
├── .gitignore
└── README.md
```

## Setup local

### Requisitos

- Node.js **>= 20**
- pnpm o npm
- Acceso a una base de datos PostgreSQL 15+ con PostGIS y `pg_cron` (recomendado: proyecto Supabase)
- Cuentas/keys de: Stripe, Google (OAuth + Maps), Twilio, Supabase Storage

### 1. Backend (`api/`)

```bash
cd api
npm install
cp .env.example .env
# editar .env con valores reales
npm run dev
```

El servidor escucha en `PORT` (default `3000`) y se enlaza a `0.0.0.0` para ser accesible desde dispositivos en LAN y compatible con Railway.

Healthcheck:

```bash
curl http://localhost:3000/health
# { "status": "ok", "timestamp": "..." }
```

### 2. Tests de aceptación

```bash
cd api
npm run test:phase1
npm run test:phase2
npm run test:phase3
npm run test:phase3.5
# o todo en serie:
npm run test:all
```

### 3. Mobile (`mobile/`)

```bash
cd mobile
npm install
npx expo start
```

Configurar la URL del backend en `mobile/services/api.ts` (o variable de entorno expo) apuntando al API local o desplegado.

## Variables de entorno requeridas (API)

Lista canónica en `api/.env.example`. Resumen:

| Categoría | Variables |
|-----------|-----------|
| Server | `NODE_ENV`, `PORT`, `ALLOWED_ORIGINS` |
| Database | `DATABASE_URL` |
| JWT | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `INTERNAL_SECRET` |
| Hashing | `BCRYPT_COST` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PREMIUM`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Supabase Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Rate limit | `RATE_LIMIT_GLOBAL_PER_MIN`, `RATE_LIMIT_BUSINESS_REGISTER_PER_DAY` |

> **Producción:** `env.js` valida que existan `DATABASE_URL`, `JWT_SECRET` y `JWT_REFRESH_SECRET` cuando `NODE_ENV=production`. Si falta alguna, el proceso falla en arranque (fail-fast).

## Deploy en Railway

El servicio web se levanta con el `Procfile` del directorio `api/`:

```
web: node src/index.js
```

Pasos en Railway:

1. **New Project → Deploy from GitHub repo →** seleccionar `juarezbravoricardo-cmd/cuponiko`.
2. En el servicio, configurar **Root Directory = `api`** (Railway detecta `package.json` y `Procfile`).
3. Configurar las variables de entorno listadas arriba en **Variables** (no commitear `.env`).
4. Definir el **healthcheck path = `/health`** (Railway lo usa para marcar el deploy como sano).
5. Railway expone `PORT` automáticamente; el servidor lo lee y se enlaza a `0.0.0.0`.
6. Webhook Stripe: apuntar a `https://<dominio-railway>/api/webhooks/stripe` y guardar `STRIPE_WEBHOOK_SECRET`.

## Convenciones de arquitectura

- **Atomicidad:** nunca `SELECT`+`UPDATE` separados; siempre `UPDATE … WHERE … RETURNING id`. `rowCount=0` ⇒ condición no se cumplió.
- **Idempotencia Stripe:** `INSERT INTO stripe_events ON CONFLICT DO NOTHING`; si `rowCount=0`, el evento ya fue procesado, se devuelve `200` sin acción.
- **Geo:** `businesses.location` es `GEOGRAPHY(POINT, 4326)` con índice GIST. `ST_MakePoint(lng, lat)` (orden longitud-latitud).
- **Mensajes de error:** literales según `contratos_api_v1`. No parafrasear ni traducir.
- **Webhook Stripe:** se monta **antes** de `express.json` para preservar el `raw body` y poder verificar firma.

## Licencia

UNLICENSED — propiedad de Cuponiko.
