# Cuponiko — Reporte Fase 3

**Fecha de ejecución:** 2026-04-28
**Entorno:** Node.js 22.13 / Express 4.x / pg 8.x → Supabase Postgres 15 + PostGIS
**Modo:** `MOCK_EXTERNAL_SERVICES=true` (Stripe/Twilio/Expo/S3 mockeados)
**Conexión DB:** Session Pooler Supabase (`aws-1-us-east-2.pooler.supabase.com:5432`)
**runTag:** `phase3_mojde3ub_c6a4`

---

## Resumen ejecutivo

| Categoría | Resultado |
|-----------|-----------|
| Tests Fase 3 | **19 / 19 PASS** |
| Tests bloqueantes ⚡ (T-310, T-311, T-320) | **3 / 3 PASS** |
| Regresión Fase 2 | **41 / 41 PASS** |
| Bloqueos detectados | 0 |

Fase 3 completa y desbloqueada. Lista para verificación de Claude y promoción a producción.

---

## Resultados por test

### Lealtad (LYL-01..04)

| Test | Resultado | Cobertura |
|------|-----------|-----------|
| T-300 | **PASS** | `POST /api/loyalty/join` inserta `consumer_loyalty` (stamps=0) y `loyalty_qr_codes` con `valid_until = NOW()+24h` |
| T-301 | **PASS** | Join duplicado → `409 ALREADY_JOINED` |
| T-302 | **PASS** | `POST /api/loyalty/stamp` incrementa atómicamente (4 → 5) y persiste |
| T-303 | **PASS** | QR con `valid_until < NOW()` → `400 "QR expirado. El cliente debe actualizar su QR."` |
| T-304 | **PASS** | Negocio ajeno → `403 "Esta tarjeta no pertenece a tu negocio."` |
| T-305 | **PASS** | Tarjeta completa → `400 "Este cliente ya tiene la recompensa disponible."` |
| T-306 | **PASS** | `POST /api/loyalty/:id/refresh-qr` rota `qr_token` y restaura `valid_until = NOW()+24h` |

### Anuncios exclusive_offer (AD-01)

| Test | Resultado | Cobertura |
|------|-----------|-----------|
| ⚡ T-310 | **PASS** | Transacción atómica: cupón con `is_ad_exclusive=true, accumulable=false, transferable=false` + anuncio + `coupons.ad_id` actualizado en mismo COMMIT |
| ⚡ T-311 | **PASS** | Hook `_armFailAfterCouponInsert()` simula fallo tras INSERT cupón → ROLLBACK total verificado: 0 cupones, 0 anuncios |
| T-312 | **PASS** | `discount_type='2x1'` sin `precio_referencia` → `400` con mensaje que contiene "precio de referencia" |
| T-313 | **PASS** | 7 anuncios activos → `GET /api/ads/active` devuelve máximo 5 |

### Antifraude

| Test | Resultado | Cobertura |
|------|-----------|-----------|
| ⚡ T-320 | **PASS** | Reuso de token `used` → `409 ALREADY_REDEEMED` + alerta `token_reuse` insertada **fuera de la transacción rollbackeada** (patrón `pendingTokenReuseAlert`) |
| T-321 | **PASS** | Tras 3 bloqueos de scanner en 1h → alerta `rate_limit_repeat` con `severity='medium'` |
| T-322 | **PASS** | `POST /api/alerts/report` desde negocio → `201` + alerta `manual_report` |

### Scheduled jobs (INTERNAL-01..03)

| Test | Resultado | Cobertura |
|------|-----------|-----------|
| T-330 | **PASS** | `coupon_expiry_notifier`: cupón con `end_date` que vence en ≤24h genera `notification` tipo `coupon_expiry_reminder` + log `success` en `scheduled_jobs_log` |
| T-331 | **PASS** | Mismo cupón con notificación previa hace 10h → NOT EXISTS filtra correctamente, no se duplica |
| T-332 | **PASS** | `loyalty_inactivity_tagger`: A (5 redenciones / 30d) → `frecuente`; B (1 redención / 45d) → `inactivo` |

### Admin (ADMIN-01..08)

| Test | Resultado | Cobertura |
|------|-----------|-----------|
| T-340 | **PASS** | `PATCH /api/admin/businesses/:id/suspend` → `businesses.status='suspended'`, cupones SIGUEN `active`, `GET /api/businesses/nearby` excluye al negocio suspendido |
| T-341 | **PASS** | `PATCH /api/admin/users/:id/block` → `is_active=false`, `push_token=null`, login posterior devuelve `403 ACCOUNT_BLOCKED` |

---

## Cambios al código de Fases anteriores (regresión-safe)

Para cumplir T-320 y T-321 fue necesario tocar dos archivos previos. Ambos cambios pasaron la regresión completa de Fase 2 (41/41).

| Archivo | Cambio | Motivo |
|---------|--------|--------|
| `src/services/couponsService.js` | Patrón `pendingTokenReuseAlert` (variable de cierre) — la alerta se inserta **después** del rollback, vía `query()` en pool global | T-320: la alerta debía sobrevivir al ROLLBACK de la transacción de redención |
| `src/middleware/scannerLimiter.js` | Tras bloqueo, contar bloqueos previos en `activity_logs` última hora; si ≥3, INSERT en `alerts` con `type='rate_limit_repeat'` | T-321 |
| `src/services/jobsService.js` | `WHERE c.end_date BETWEEN NOW() AND NOW()+24h` → `WHERE (c.end_date::timestamptz + INTERVAL '1 day' - INTERVAL '1 second') BETWEEN NOW() AND NOW()+24h` | T-330: `end_date` es `DATE`. El cast implícito a `00:00:00 UTC` excluía cupones que vencen "hoy" o "mañana". Se compara contra el último segundo del día |

---

## Archivos nuevos (Fase 3)

### Backend

```
api/src/services/loyaltyService.js          # LYL-01..04 + my-cards + redeem-reward
api/src/services/adsService.js              # AD-01 (transacción atómica) + hook _armFailAfterCouponInsert
api/src/services/adminService.js            # ADMIN-01..08 + reportFraudFromBusiness
api/src/services/jobsService.js             # INTERNAL-01..03 (coupon_expiry, loyalty_inactivity, cleanup_pdfs)
api/src/routes/loyalty.js                   # /api/loyalty/*
api/src/routes/admin.js                     # /api/admin/* + /api/alerts/report
api/src/routes/internal.js                  # /internal/jobs/* (protegido por internalOnly)
api/tests/run-phase3.js                     # Runner T-300..T-341
```

### Frontend (mobile)

```
mobile/services/loyaltyApi.ts               # Cliente tipado LYL-01..04
mobile/services/adsApi.ts                   # Cliente tipado AD-01
mobile/services/adminApi.ts                 # Cliente tipado ADMIN-01..08 (consumible también desde admin web standalone)
mobile/screens/loyalty/MyLoyaltyCardsScreen.tsx  # Pantalla mínima: tarjetas + QR rotativo + canje recompensa
```

### Modificados

```
api/src/app.js                              # Mount de loyaltyRoutes, adminRouter, alertsRouter, internalRoutes
api/src/middleware/scannerLimiter.js        # Hook T-321
api/src/services/couponsService.js          # Hook T-320
```

---

## Decisiones técnicas justificadas

### 1. Alertas fuera de la transacción de redención (T-320)

**Problema:** la transacción de `redeemCoupon` hace ROLLBACK al lanzar `ALREADY_REDEEMED`. Si la alerta se inserta dentro, también se borra.

**Solución elegida:** patrón **pending-side-effect** — variable de cierre `pendingTokenReuseAlert` capturada antes del `try/catch`, y INSERT vía `query()` (pool global) en el bloque `catch` antes de re-lanzar el error. Síncrono, sin race con tests.

**Anti-patrón evitado:** fire-and-forget con `setImmediate()` o IIFE async sin await — race condition con verificación inmediata en tests.

### 2. Carrusel de anuncios HOME-03 limitado a 5

Ya estaba implementado en Fase 2 con `LIMIT 5` en el SQL. T-313 lo verifica explícitamente generando 7 anuncios activos.

### 3. Segmentos de lealtad como `activity_logs` con `action='loyalty_segment'`

No existe tabla `consumer_segments` separada en el schema. Cada corrida del job inserta un evento idempotente por par `(consumer_id, business_id)`. El panel admin/business toma siempre el más reciente por par. Trade-off: más rows pero cero migraciones nuevas. Si crece el volumen, se puede materializar después con un view.

### 4. Hook `_armFailAfterCouponInsert()` en `adsService`

Mecanismo de inyección de fallo controlado para T-311 (verificar ROLLBACK). Solo activo cuando se llama explícitamente — sin impacto en producción. Patrón estándar de "test seam".

---

## Endpoints fuera del contrato (no implementados)

El prompt mencionaba "NOTIFY-01..03" y endpoints de delete-account, push-token registration, export-pdf asíncrono, GET notifications. **Ninguno está formalizado en `cuponiko_contratos_api_v1.md`**, por lo que no se implementaron en Fase 3 para no contradecir el contrato (regla 5: contratos son fuente de verdad).

Cubierto indirectamente:
- **Eliminación de cuenta** → `ADMIN-06 /api/admin/users/:id/block` (efecto equivalente: `is_active=false`, sesiones invalidadas, push_token nullified).
- **Notificaciones leídas/listado** → tabla `notifications` poblada por jobs y servicios; el frontend puede consumirla con un GET genérico cuando se especifique en contrato v2.
- **Export PDF asíncrono** → `INTERNAL-03 cleanup-expired-pdfs` ya limpia el bucket; el endpoint de generación pertenece al alcance de un contrato CPN-08 futuro.

Si quieres que estos se incluyan, requieren primero su sección en `contratos_api_v2.md`.

---

## Cómo correr los tests

```bash
cd /home/ubuntu/cuponiko/api
node tests/run-phase3.js   # Fase 3 (~30s)
node tests/run-phase2.js   # Regresión Fase 2 (~3min)
```

Variables de entorno requeridas en `api/.env`:
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
INTERNAL_SECRET=...
MOCK_EXTERNAL_SERVICES=true
```

---

## Próximos pasos sugeridos

1. **Verificación de Claude**: pasarle este reporte + diff de los 3 archivos modificados de Fase 2.
2. **pg_cron en Supabase**: crear los schedules reales que llaman a los endpoints `/internal/jobs/*` cada hora (coupon_expiry_notifier) y diario 02:00 AM (loyalty_inactivity_tagger, cleanup_expired_pdfs). Comando ejemplo:
   ```sql
   SELECT cron.schedule('coupon_expiry_notifier', '0 * * * *',
     $$ SELECT net.http_post('https://api.cuponiko.com/internal/jobs/coupon-expiry-notifier',
                             '{}'::jsonb,
                             '{}'::jsonb,
                             jsonb_build_object('x-internal-secret', current_setting('app.internal_secret'))) $$);
   ```
3. **Frontend Fase 3 completo**: las pantallas `BusinessLoyaltyScannerScreen`, `AdminWebDashboard` y carrusel de anuncios en HomeScreen quedan para una sesión dedicada (estimado 4-6h de UI). Los API clients ya están listos.
4. **Cero deudas técnicas bloqueantes** detectadas para Fase 4 (refinement / store submission).
