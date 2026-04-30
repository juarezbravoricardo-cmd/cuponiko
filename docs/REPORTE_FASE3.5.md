# Cuponiko — Reporte Fase 3.5

**Fecha:** 30 abril 2026  
**Alcance:** Migración `020_exports.sql` + 10 endpoints complementarios (NOTIFY-01..04, ACCT-01..02, EXPORT-01..02, BIZ-01, CPN-08).  
**Pre-requisito:** Fases 0-3 completadas (entregadas como zips).  
**Entorno de pruebas:** Supabase real (`postgresql://postgres.sfqrgibyuujsmvkapind:***@aws-1-us-east-2.pooler.supabase.com:5432/postgres`), `MOCK_EXTERNAL_SERVICES=true`.

---

## Resumen ejecutivo

**Fase 3.5: 35/35 PASS (100%).** Todos los tests bloqueantes (⚡T-422, ⚡T-433, ⚡T-434, ⚡T-464) pasaron. Migración `020_exports.sql` aplicada y verificada. Cero anti-patrones introducidos. Cero modificaciones a código de Fases 0-3. La regresión confirma que Fase 1 sigue 24/24, Fase 2 sigue 41/41 y Fase 3 sigue 16/19 — los 3 fails de Fase 3 son **pre-existentes en el zip entregado** y están documentados al final.

---

## Resultados por suite

| Suite | Tests | PASS | FAIL | Cobertura |
|-------|-------|------|------|-----------|
| **Fase 3.5 (nueva)** | 35 | **35** | 0 | T-400, T-410..T-415, T-420..T-422, T-430..T-436, T-440..T-446, T-450..T-455, T-460..T-464 |
| Fase 1 (regresión) | 24 | 24 | 0 | T-100..T-154 |
| Fase 2 (regresión) | 41 | 41 | 0 | T-200..T-282 |
| Fase 3 (regresión) | 19 | 16 | 3* | T-300..T-341 |
| **Total** | **119** | **116** | **3** | — |

*Los 3 fails de Fase 3 son pre-existentes en el código entregado, no introducidos por Fase 3.5. Detalle al final.*

---

## Detalle Fase 3.5 (T-400 a T-464)

### Migración

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-400 | Tabla `exports` creada con columnas, FKs e índices correctos | **PASS** |

### Notificaciones (NOTIFY-01, NOTIFY-02)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-410 | Listar notificaciones — paginación correcta (25 → 3 páginas de 10) | **PASS** |
| T-411 | Filtro `unread_only=true` retorna solo no leídas | **PASS** |
| T-412 | `limit=100` rechazado con mensaje literal | **PASS** |
| T-413 | Marcar como leída — éxito y persistencia en DB | **PASS** |
| T-414 | Marcar como leída — notificación ajena → 403 FORBIDDEN | **PASS** |
| T-415 | Marcar como leída — id inexistente → 404 NOT_FOUND | **PASS** |

### Push token (NOTIFY-03)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-420 | Registrar push token — éxito y verificación en `users.push_token` | **PASS** |
| T-421 | Plataforma inválida (`windows`) → 400 con mensaje literal | **PASS** |
| ⚡ T-422 | **Desvincula a usuario anterior:** A pierde token (NULL), B lo gana | **PASS** |

### Eliminación de cuenta (ACCT-01, ACCT-02)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-430 | Solicitar eliminación — código generado con TTL 30 min, activity_log creado | **PASS** |
| T-431 | Cuenta ya inactiva → 400 ACCOUNT_ALREADY_INACTIVE | **PASS** |
| T-432 | Negocio Premium con suscripción activa → 400 ACTIVE_SUBSCRIPTION | **PASS** |
| ⚡ T-433 | **Confirmar eliminación consumer:** is_active=false, push_token=NULL, login posterior 403 ACCOUNT_BLOCKED | **PASS** |
| ⚡ T-434 | **Cascada negocio:** users.is_active=false, businesses.status='suspended', 3 cupones → status='expired' | **PASS** |
| T-435 | Código incorrecto → 400 INVALID_CODE | **PASS** |
| T-436 | Código expirado → 400 CODE_EXPIRED | **PASS** |

### Exportación PDF (EXPORT-01, EXPORT-02)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-440 | Solicitar exportación — 202, registro `status=pending` en DB | **PASS** |
| T-441 | Tipo inválido → 400 VALIDATION_ERROR | **PASS** |
| T-442 | Fechas invertidas → 400 con mensaje literal | **PASS** |
| T-443 | Otra ya en `processing` → 429 EXPORT_IN_PROGRESS | **PASS** |
| T-444 | Plan free → 403 PLAN_RESTRICTED | **PASS** |
| T-445 | Consultar completada — `file_url` y `expires_at` presentes | **PASS** |
| T-446 | Consultar export ajena → 403 FORBIDDEN | **PASS** |

### Perfiles públicos (BIZ-01, CPN-08)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-450 | Perfil público negocio — `active_coupons_count=5`, `has_loyalty_program=true`, sin campos `stripe_*` | **PASS** |
| T-451 | Negocio suspendido → 404 (no revelar estado) | **PASS** |
| T-452 | Negocio inexistente → 404 | **PASS** |
| T-453 | Cupón público — `remaining_uses=85`, sin `uses_count` directo, anidado `business.business_name` | **PASS** |
| T-454 | Cupón con `end_date < CURRENT_DATE` → 410 COUPON_EXPIRED | **PASS** |
| T-455 | Cupón inexistente → 404 | **PASS** |

### Notificaciones a segmentos (NOTIFY-04)

| Test | Descripción | Resultado |
|------|-------------|-----------|
| T-460 | Envío `segment=all` con 10 consumers — `sent_to≥5`, 10 INSERTs en `notifications`, `activity_log` con `notification_sent` | **PASS** |
| T-461 | Plan free → 403 PLAN_RESTRICTED | **PASS** |
| T-462 | Segmento `vip` inválido → 400 con mensaje literal | **PASS** |
| T-463 | Título vacío → 400 con mensaje literal | **PASS** |
| ⚡ T-464 | **Rate limit 3/24h:** cuarta solicitud rechazada con 429 NOTIFICATION_LIMIT | **PASS** |

---

## Anti-patrones honrados

Cada endpoint nuevo se diseñó cruzando contra `cuponiko_antipatrones_v1.md`:

- **AP-01 (atomicidad):** `markRead` usa `UPDATE ... WHERE id=$1 AND user_id=$2 RETURNING id`. La distinción 404 vs 403 se resuelve con un SELECT post-rowCount=0, no con un SELECT-then-UPDATE racy.
- **AP-03 (transacciones multi-tabla):** `confirmAccountDeletion` corre dentro de `withTransaction`, abarcando `users` + `businesses` + `coupons` + `email_verification_tokens` + `activity_logs`. Cualquier excepción → ROLLBACK total.
- **AP-04 (UNIQUE en device):** `registerPushToken` ejecuta UPDATE de desvinculación atómica del owner anterior antes de asignar al nuevo, todo dentro de la misma transacción.
- **AP-05 (validación backend):** `sendToSegment` valida plan, segmento, longitud de title/body y rate limit antes de cualquier write.
- **AP-08 (mensajes literales):** todos los strings de error y `code` se copiaron textualmente del contrato. Verificación adicional en los asserts de los tests.
- **AP-12 (no inventar columnas):** la migración 020 usa exactamente los nombres del contrato (`file_path`, `file_url`, `expires_at`, `error_message`, `completed_at`); ningún campo extra.
- **EXPORT race condition:** `requestExport` ejecuta el SELECT-FOR-UPDATE de exports activas y el INSERT del nuevo dentro de una sola transacción. Dos solicitudes simultáneas del mismo negocio → solo una crea el registro `pending`, la otra recibe 429.
- **Idempotencia ACCT-02:** el UPDATE del token es atómico con `WHERE used=false AND expires_at > NOW() RETURNING id`. Si rowCount=0, distinguimos `INVALID_CODE` vs `CODE_EXPIRED` con un SELECT post-fallo (camino frío, no afecta atomicidad).

---

## Archivos creados / modificados

### Nuevos

```
api/migrations/020_exports.sql                  (nueva tabla exports)
api/src/services/notificationsService.js        (NOTIFY-01..04)
api/src/services/accountService.js              (ACCT-01..02)
api/src/services/exportsService.js              (EXPORT-01..02 + job async)
api/src/services/publicService.js               (BIZ-01 + CPN-08)
api/src/routes/notifications.js                 (notificationsRouter + pushRouter)
api/src/routes/account.js
api/src/routes/exports.js
api/src/routes/public.js                        (publicBusinessesRouter + publicCouponsRouter)
api/tests/run-phase3.5.js                       (35 tests autoejecutables)
```

### Modificados (mínimo necesario)

- `api/src/app.js` — registro de los nuevos routers. Las rutas públicas (`publicBusinessesRouter`, `publicCouponsRouter`) se montan **antes** de los routers autenticados de `/api/businesses` y `/api/coupons` para evitar que `:id/public` sea capturado por `jwtVerify` upstream.

**No se tocó:** `auth.js`, `billing.js`, `coupons.js`, `wallet.js`, `home.js`, `loyalty.js`, `admin.js`, `internal.js`, `webhooks.js`, ningún service de Fases 1-3, ningún middleware existente, ninguna migración previa.

---

## Pre-existing failures detectados durante regresión Fase 3

Al ejecutar `tests/run-phase3.js` (incluso ANTES de tocar nada), 3 de 19 tests fallan:

| Test | Síntoma | Causa raíz |
|------|---------|------------|
| T-310 | `POST /api/ads/create` → 404 NOT_FOUND | El service `adsService.createAd` existe, pero la ruta NO está montada en `routes/home.js`. Falta agregar el handler `adsRouter.post('/create', jwtVerify, requireRole('business'), planChecker.requirePremium, ...)`. |
| T-312 | Mismo síntoma — POST /api/ads/create no existe | Ídem T-310. |
| T-330 | `coupon_expiry_notifier` no inserta notificación | El test plantea un `coupon_instance` que vence en menos de 24h, pero el job filtra por `instance.expires_at` y/o por estado del cupón, y la condición no se cumple con el seed mínimo del test. Es un timing/seed mismatch entre test y servicio. |

**Por qué no los arreglé en este patch:** Tu Regla 4 ("construye sobre el código existente, no reescribas Fases 0-3") es explícita. Estos tres fixes están fuera del scope de Fase 3.5 (no son endpoints nuevos, son fixes a Fase 3). Si los quieres en este mismo patch, confírmamelo y los aplico en una iteración cerrada — son 2 cambios:

1. Agregar a `routes/home.js`:
   ```js
   adsRouter.post('/create', jwtVerify, requireRole('business'), asyncHandler(async (req, res) => {
     const data = await adsService.createAd(req.user.id, req.body);
     res.status(201).json({ data });
   }));
   ```
2. Revisar el seed de T-330 vs la query SQL de `jobsService.couponExpiryNotifier` para que el `coupon_instance` plantado por el test caiga dentro de la ventana del job.

---

## Comandos para reproducir

```bash
cd api
node tests/run-phase3.5.js   # → 35/35 PASS
node tests/run-phase1.js     # → 24/24 PASS
node tests/run-phase2.js     # → 41/41 PASS
node tests/run-phase3.js     # → 16/19 PASS (3 pre-existing)
```

Variables de entorno usadas (en `.env`): `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SECRET`, `MOCK_EXTERNAL_SERVICES=true`.

---

## Checklist de aceptación

- [x] T-400 PASS (migración exports)
- [x] T-410 a T-415 PASS (notificaciones)
- [x] T-420 a T-422 PASS (⚡ push token)
- [x] T-430 a T-436 PASS (⚡ eliminación cuenta)
- [x] T-440 a T-446 PASS (exportación PDF)
- [x] T-450 a T-455 PASS (perfiles públicos)
- [x] T-460 a T-464 PASS (⚡ push segmentos)
- [x] Regresión Fase 1: 24/24 PASS
- [x] Regresión Fase 2: 41/41 PASS
- [ ] Regresión Fase 3: 16/19 PASS (3 fails pre-existentes — fuera de scope de Fase 3.5)

**Veredicto:** Fase 3.5 completa. Listo para verificación con Claude y promoción a producción tras decidir si los 3 pre-existing fails de Fase 3 se corrigen en este patch o en uno separado.
