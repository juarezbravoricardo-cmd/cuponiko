# Cuponiko — Admin Web

Panel administrativo standalone (no embebido en la app móvil) para Cuponiko.

## Stack

- Vite + React 18 + TypeScript + TailwindCSS
- React Router v6
- Axios con refresh JWT automático

## Requisitos

- Node 20+
- pnpm o npm

## Instalación

```bash
cd admin-web
pnpm install   # o: npm install
pnpm dev       # http://localhost:5173
```

## Variables de entorno

Crea un `.env.local` con:

```
VITE_API_BASE_URL=https://api.cuponiko.com
```

Si no se define, por default apunta a `https://api.cuponiko.com`.

## Pantallas

| Ruta            | Descripción                                                        |
|-----------------|--------------------------------------------------------------------|
| `/login`        | Acceso restringido a cuentas con rol `admin`.                      |
| `/`             | Dashboard de métricas globales (`GET /api/admin/metrics`).         |
| `/businesses`   | Lista, búsqueda, suspender/activar negocios.                       |
| `/alerts`       | Bandeja antifraude con resoluciones (`ignore`, `block_consumer`, `suspend_business`). |
| `/users`        | Bloqueo manual de consumidores por ID.                             |

## Auth y refresh

`src/services/api.ts` mantiene tokens en `localStorage` (claves `cuponiko_admin_access` / `cuponiko_admin_refresh`). El interceptor reintenta una sola vez cuando el backend responde `401 TOKEN_EXPIRED`.

## Build de producción

```bash
pnpm build      # genera dist/
pnpm preview    # sirve dist/ en local para sanity-check
```

## Deploy

Hospedar `dist/` en cualquier static host (Cloudflare Pages, Netlify, S3+CloudFront).
Asegurar el header `VITE_API_BASE_URL` en tiempo de build apuntando a la API correcta.
