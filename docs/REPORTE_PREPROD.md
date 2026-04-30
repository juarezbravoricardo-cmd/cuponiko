# Cuponiko — Reporte de cambios pre-producción

**Fecha:** 30 abril 2026  
**Tipo:** Sesión de ajustes pre-deploy. Sin features nuevas.  
**Entorno de pruebas:** Supabase real (Session Pooler, puerto 5432), `MOCK_EXTERNAL_SERVICES=true`.

---

## Resumen ejecutivo

Se aplicaron los 2 cambios solicitados. El Cambio 2 (puerto DB) ya estaba aplicado en el repo desde Fase 3.5; solo se verificó. El Cambio 1 (diferir verificación telefónica) se aplicó como modificación quirúrgica a `src/services/authService.js` con 3 ediciones puntuales. **Suite completa: 119/119 PASS**, sin regresiones.

| Suite | Resultado |
|-------|-----------|
| Fase 1 (auth + billing) | **24/24 PASS** |
| Fase 2 (cupones + redención + home) | **41/41 PASS** |
| Fase 3 (lealtad + anuncios + admin + jobs) | **19/19 PASS** |
| Fase 3.5 (notif + cuenta + export + público) | **35/35 PASS** |
| **Total** | **119/119 PASS** |

---

## Cambio 1 — Diferir verificación telefónica

**Motivación:** eliminar dependencia de Twilio/Meta para el lanzamiento y reducir fricción de onboarding. La columna `users.phone_verified` y la tabla `phone_verification_tokens` permanecen intactas para reactivación en fase de tracción (+50 negocios).

### Archivo único modificado: `api/src/services/authService.js`

**Edición 1 — bloque SMS en `registerBusiness()`** (línea ~268):

```diff
     const businessId = bizIns.rows[0].id;
     const emailCode = await createEmailVerificationCode(client, userId, emailLower);
-    const phoneCode = await createPhoneVerificationCode(client, userId, phone);
+    // DIFERIDO: verificación telefónica se activa en fase de tracción (+50 negocios).
+    // El campo `phone` se sigue recolectando y guardando en businesses (es necesario
+    // para el perfil del negocio), pero no se inserta token ni se envía SMS.
+    // const phoneCode = await createPhoneVerificationCode(client, userId, phone);
     // Envío de códigos
     await sendVerificationEmail(emailLower, emailCode);
-    await sendSmsCode(phone, phoneCode);
+    // DIFERIDO: ver comentario arriba.
+    // await sendSmsCode(phone, phoneCode);
```

**Edición 2 — referencia a `phoneCode` en el `return`** (línea ~285). Sin esta edición, el código rompe con `ReferenceError: phoneCode is not defined`:

```diff
       _debug_email_code: process.env.NODE_ENV === 'test' ? emailCode : undefined,
-      _debug_phone_code: process.env.NODE_ENV === 'test' ? phoneCode : undefined,
+      // DIFERIDO: phoneCode no se genera mientras la verificación telefónica esté desactivada.
+      _debug_phone_code: undefined,
```

**Edición 3 — guard `phone_verified` en `login()`** (línea ~439):

```diff
-  if (user.role === 'business' && !user.phone_verified) {
-    throw new AppError(
-      403,
-      'PHONE_NOT_VERIFIED',
-      'Verifica tu teléfono para acceder como negocio.'
-    );
-  }
+  // DIFERIDO: verificación telefónica se activa en fase de tracción (+50 negocios).
+  // La condición phone_verified se mantiene en DB pero no bloquea login.
+  // if (user.role === 'business' && !user.phone_verified) {
+  //   throw new AppError(
+  //     403,
+  //     'PHONE_NOT_VERIFIED',
+  //     'Verifica tu teléfono para acceder como negocio.'
+  //   );
+  // }
```

### Lo que NO se tocó (verificado)

- Tabla `phone_verification_tokens` y migración 003 → intactas.
- Columna `users.phone_verified` con default `false` → intacta.
- Endpoint `POST /api/auth/verify-phone` → permanece registrado en `routes/auth.js`. No se usa pero queda funcional para activación futura.
- `phone` sigue siendo obligatorio en el body de `POST /api/auth/register-business` y se persiste en `users.phone` (validación `assertPhone` y el `INSERT INTO users (... phone ...)` quedaron intactos).
- `src/services/twilio.js` → intacto.
- `src/config/env.js` → sin cambios. Variables `TWILIO_*` ya eran opcionales (no están en el array `required`), confirmado en el código.

### Nota sobre Edición 2

Esta edición no estaba enumerada en el documento de cambio, pero es necesaria. El `return` original referencia la variable `phoneCode` que ya no se declara. La opción más segura y reversible fue cambiarla a `undefined` literal con un comentario explícito; en la reactivación futura solo hay que descomentar las dos líneas y devolver el ternario original.

---

## Cambio 2 — Puerto DATABASE_URL

**Estado al inicio:** Verificado, ya aplicado.

```
$ grep DATABASE_URL api/.env
DATABASE_URL=postgresql://postgres.sfqrgibyuujsmvkapind:***@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

`api/.env.example`:
```
# Database (Supabase Session Pooler)
DATABASE_URL=postgres://postgres:<password>@<host>:5432/postgres
```

Búsqueda exhaustiva (`grep -rn "6543" --exclude-dir=node_modules`) en todo el proyecto: las únicas ocurrencias son los strings `'654321'` que aparecen como código de verificación de 6 dígitos en `tests/run-phase1.js` y `tests/run-phase3.5.js`, no son URLs de DB.

**Razón documentada:** el Transaction Pooler (6543) usa connection multiplexing y rompe transacciones multi-statement (`BEGIN/COMMIT`), que son críticas para la redención de cupones (CPN-07), la creación de anuncios (AD-01), los webhooks Stripe (BILL-02), la eliminación de cuenta (ACCT-02) y los exports asíncronos. El Session Pooler (5432) mantiene sesiones persistentes.

**Acción tomada:** ninguna; ya estaba correcto.

---

## Detalle de tests por fase

### Fase 1 (24/24 — incluye T-130 que valida login business)

```
T-100..T-103 PASS  (registro consumer)
T-110..T-113 PASS  (registro business)
T-120..T-122 PASS  (verify-email)
T-130 PASS         (login business — ya no requiere phone_verified)
T-131..T-133 PASS  (login flows)
T-140..T-143 PASS  (refresh token)
T-150..T-154 PASS  (forgot/reset password)
```

**T-130 ahora pasa porque el seed planta a `business` con `email_verified=true` y `phone_verified=false`. Antes del fix, este test fallaba con 403 PHONE_NOT_VERIFIED.** Verifiqué que sigue PASS, lo que confirma que el cambio 1 funciona end-to-end.

### Fase 2 (41/41)

T-200..T-209, T-220..T-222, T-230..T-234, T-240..T-249, T-260..T-265, T-270..T-273, T-280..T-282 → todos PASS. Cero regresiones.

### Fase 3 (19/19)

T-300..T-306 (lealtad), T-310..T-313 (anuncios), T-320..T-322 (antifraude), T-330..T-332 (jobs), T-340..T-341 (admin) → todos PASS.

### Fase 3.5 (35/35)

T-400 (migración exports), T-410..T-415 (notif), T-420..T-422 (push token), T-430..T-436 (eliminación cuenta), T-440..T-446 (exports), T-450..T-455 (perfiles públicos), T-460..T-464 (push segmentos) → todos PASS.

---

## Reactivación futura (checklist para fase de tracción)

Cuando se alcancen +50 negocios y se decida reactivar verificación SMS/WhatsApp:

1. En `src/services/authService.js`, descomentar las 4 líneas marcadas con `// DIFERIDO:` (3 en `registerBusiness`, 1 en `login`) y restaurar el ternario `phoneCode` en el return.
2. Migrar `src/services/twilio.js` al canal WhatsApp Business (Twilio Programmable Messaging, Camino B). El módulo `sendVerificationCode` ya existe y se llama igual; solo cambia el transporte interno.
3. Agregar variables de entorno reales `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` al `.env` de producción.
4. Re-ejecutar `node tests/run-phase1.js` y validar que T-110..T-113 y T-120..T-122 sigan en verde con el seed de phone code.

No se requiere migración de DB ni cambios de schema en la reactivación.

---

## Comandos para reproducir

```bash
cd api
node tests/run-phase1.js    # 24/24 PASS
node tests/run-phase2.js    # 41/41 PASS
node tests/run-phase3.js    # 19/19 PASS
node tests/run-phase3.5.js  # 35/35 PASS
```

---

## Veredicto

Listo para promoción a producción. Los 2 cambios pre-deploy quedaron aplicados (Cambio 1 vía edición quirúrgica de `authService.js`, Cambio 2 ya estaba presente y validado). Suite 119/119 PASS sin regresiones.
