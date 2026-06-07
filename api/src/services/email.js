'use strict';

/**
 * Servicio de email — Cuponiko.
 *
 * Modos:
 * - MOCK_EXTERNAL_SERVICES=true  → no envía nada, registra el último email en memoria
 *   para inspección en tests (getLastEmail).
 * - MOCK_EXTERNAL_SERVICES=false → envía email real vía Resend usando RESEND_API_KEY.
 *
 * Plantillas HTML production-ready con fallback de texto plano.
 * Compatibilidad: Gmail, Outlook, Apple Mail, móvil y desktop.
 */

const { Resend } = require('resend');
const env = require('../config/env');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// Cliente Resend (lazy init)
// ─────────────────────────────────────────────
let _resendClient = null;
function getResendClient() {
  if (_resendClient) return _resendClient;
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY no configurada y MOCK_EXTERNAL_SERVICES=false');
  }
  _resendClient = new Resend(env.RESEND_API_KEY);
  return _resendClient;
}

// ─────────────────────────────────────────────
// Captura del último email enviado (para tests)
// ─────────────────────────────────────────────
const _lastEmail = { to: null, subject: null, body: null, html: null, at: null };
function getLastEmail() {
  return { ..._lastEmail };
}

// Backward-compat aliases (legacy test helpers)
function getLastMockEmail() {
  return getLastEmail();
}
function resetLastMockEmail() {
  _lastEmail.to = null;
  _lastEmail.subject = null;
  _lastEmail.body = null;
  _lastEmail.html = null;
  _lastEmail.at = null;
}

// ─────────────────────────────────────────────
// Wrapper genérico de envío
// Acepta html y/o text. Si solo se pasa text, se envía text.
// Si se pasa html, se envía multipart/alternative (html + text fallback).
// ─────────────────────────────────────────────
async function sendEmail(to, subject, content) {
  // Backward-compat: si se invoca como sendEmail(to, subject, 'texto plano')
  if (typeof content === 'string') {
    content = { text: content };
  }
  const { text, html } = content;

  if (!text && !html) {
    throw new Error('sendEmail requiere al menos text o html');
  }

  _lastEmail.to = to;
  _lastEmail.subject = subject;
  _lastEmail.body = text || null;
  _lastEmail.html = html || null;
  _lastEmail.at = new Date().toISOString();

  if (env.MOCK_EXTERNAL_SERVICES) {
    logger.info('email_mock', { to, subject, hasHtml: !!html, hasText: !!text });
    return { id: 'mock-' + Date.now() };
  }

  try {
    const resend = getResendClient();
    const payload = { from: env.RESEND_FROM, to, subject };
    if (html) payload.html = html;
    if (text) payload.text = text;

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      logger.error('email_send_failed', { to, subject, error: error.message || String(error) });
      throw new Error(`Resend error: ${error.message || String(error)}`);
    }

    logger.info('email_sent', { to, subject, id: data && data.id });
    return { id: (data && data.id) || 'resend-' + Date.now() };
  } catch (err) {
    logger.error('email_send_exception', { to, subject, error: err.message });
    throw err;
  }
}

// ─────────────────────────────────────────────
// Builders de HTML
// Centralizados para mantener consistencia visual entre plantillas
// ─────────────────────────────────────────────

const LOGO_SVG = `
<svg viewBox="0 0 100 100" width="64" height="64" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <g transform="rotate(-8 50 50)">
    <path d="M14 28 L72 28 Q78 28 78 34 Q72 34 72 40 Q72 46 78 46 L78 64 Q78 70 72 70 L14 70 Q8 70 8 64 Q14 64 14 58 Q14 52 8 52 L8 34 Q8 28 14 28 Z" fill="#F97316"/>
    <path d="M26 34 L86 34 Q92 34 92 40 Q86 40 86 46 Q86 52 92 52 L92 70 Q92 76 86 76 L26 76 Q20 76 20 70 Q26 70 26 64 Q26 58 20 58 L20 40 Q20 34 26 34 Z" fill="#7C3AED"/>
    <circle cx="42" cy="48" r="5" fill="#FFFFFF"/>
    <circle cx="64" cy="62" r="5" fill="#FFFFFF"/>
    <path d="M68 42 L36 68" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
  </g>
</svg>
`.trim();

function buildEmailLayout({ preheader, headerAccentColor, bodyHtml }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Cuponiko</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1F1F1F;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#F5F5F5;mso-hide:all;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F5F5;">
<tr><td align="center" style="padding:20px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="padding:32px 24px 24px;border-bottom:4px solid ${headerAccentColor};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-bottom:8px;">${LOGO_SVG}</td></tr>
<tr><td align="center" style="font-size:28px;font-weight:800;color:#F97316;letter-spacing:-0.02em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1;">Cuponiko</td></tr></table>
</td></tr>
<tr><td style="padding:32px 24px;">${bodyHtml}</td></tr>
<tr><td style="background-color:#F9FAFB;padding:24px;text-align:center;border-top:1px solid #E5E7EB;">
<p style="font-size:13px;color:#6B7280;margin:0 0 10px;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">¿Necesitas ayuda? Escríbenos a <a href="mailto:soporte@cuponiko.com" style="color:#F97316;text-decoration:none;font-weight:500;">soporte@cuponiko.com</a></p>
<p style="font-size:12px;color:#9CA3AF;margin:8px 0 0;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">© 2026 Cuponiko · Ricardo Juárez Bravo<br>Apaxco, Estado de México</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildVerificationCodeBlock(code) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
<tr><td align="center" style="border:2px solid #7C3AED;border-radius:12px;padding:22px;background-color:#F5F3FF;">
<div style="font-size:40px;font-weight:700;color:#4D2D7E;letter-spacing:10px;font-family:'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;">${code}</div>
</td></tr></table>`;
}

function buildPrimaryButton(href, label, accentColor = '#F97316') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px;">
<tr><td align="center" style="background-color:${accentColor};border-radius:10px;">
<a href="${href}" style="display:inline-block;padding:16px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.2;">${label}</a>
</td></tr></table>`;
}

// ─────────────────────────────────────────────
// PLANTILLA 1: Verificación de correo
// Uso compartido entre consumer y business (idéntico para ambos)
// ─────────────────────────────────────────────
function buildVerificationHtml(code) {
  const body = `
<h1 style="font-size:24px;font-weight:700;margin:0 0 14px;color:#1F1F1F;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Verifica tu correo</h1>
<p style="font-size:16px;line-height:1.6;color:#4B5563;margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Gracias por unirte a Cuponiko. Estás a un paso de descubrir los mejores cupones de los negocios cerca de ti.</p>
<p style="font-size:14px;color:#6B7280;margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Ingresa este código en la app:</p>
${buildVerificationCodeBlock(code)}
<p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Este código expira en <strong style="color:#1F1F1F;">30 minutos</strong>. Si no creaste esta cuenta, puedes ignorar este correo.</p>
`.trim();

  return buildEmailLayout({
    preheader: `Tu código de verificación: ${code}. Expira en 30 minutos.`,
    headerAccentColor: '#F97316',
    bodyHtml: body
  });
}

function buildVerificationText(code) {
  return `Verifica tu correo en Cuponiko\n\nIngresa este código en la app:\n\n${code}\n\nEste código expira en 30 minutos.\n\nSi no creaste esta cuenta, puedes ignorar este correo.\n\n¿Necesitas ayuda? Escríbenos a soporte@cuponiko.com\n\n© 2026 Cuponiko · Ricardo Juárez Bravo · Apaxco, Estado de México`;
}

async function sendVerificationEmail(to, code) {
  return sendEmail(to, 'Verifica tu correo en Cuponiko', {
    html: buildVerificationHtml(code),
    text: buildVerificationText(code)
  });
}

// ─────────────────────────────────────────────
// PLANTILLA 2: Restablecer contraseña (con URL, no código)
// ─────────────────────────────────────────────
function buildPasswordResetHtml(resetUrl) {
  const body = `
<h1 style="font-size:24px;font-weight:700;margin:0 0 14px;color:#1F1F1F;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Restablece tu contraseña</h1>
<p style="font-size:16px;line-height:1.6;color:#4B5563;margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Recibimos una solicitud para cambiar la contraseña de tu cuenta. Toca el botón para crear una nueva:</p>
${buildPrimaryButton(resetUrl, 'Crear nueva contraseña', '#F97316')}
<p style="font-size:13px;color:#9CA3AF;line-height:1.6;margin:18px 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">¿No se abre el botón? Copia y pega este enlace en tu navegador:<br><span style="word-break:break-all;color:#6B7280;">${resetUrl}</span></p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;"><tr><td style="background-color:#FEF3C7;border-left:4px solid #D97706;padding:14px 16px;border-radius:6px;">
<p style="font-size:14px;line-height:1.6;color:#78350F;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><strong>¿No fuiste tú?</strong> Si no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá funcionando.</p>
</td></tr></table>
<p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Este enlace expira en <strong style="color:#1F1F1F;">30 minutos</strong>.</p>
`.trim();

  return buildEmailLayout({
    preheader: 'Toca el botón para crear una contraseña nueva. Expira en 30 minutos.',
    headerAccentColor: '#F97316',
    bodyHtml: body
  });
}

function buildPasswordResetText(resetUrl) {
  return `Restablece tu contraseña en Cuponiko\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta.\n\nUsa este enlace para crear una nueva:\n${resetUrl}\n\nEste enlace expira en 30 minutos.\n\n¿No fuiste tú? Si no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá funcionando.\n\n¿Necesitas ayuda? Escríbenos a soporte@cuponiko.com\n\n© 2026 Cuponiko · Ricardo Juárez Bravo · Apaxco, Estado de México`;
}

async function sendPasswordResetEmail(to, resetUrl) {
  return sendEmail(to, 'Restablece tu contraseña en Cuponiko', {
    html: buildPasswordResetHtml(resetUrl),
    text: buildPasswordResetText(resetUrl)
  });
}

// ─────────────────────────────────────────────
// PLANTILLA 3: Confirmación de eliminación de cuenta
// ─────────────────────────────────────────────
function buildAccountDeletionHtml(code) {
  const body = `
<h1 style="font-size:24px;font-weight:700;margin:0 0 14px;color:#1F1F1F;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Confirma la eliminación de tu cuenta</h1>
<p style="font-size:16px;line-height:1.6;color:#4B5563;margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Recibimos una solicitud para eliminar tu cuenta de Cuponiko. Ingresa este código en la app para confirmar:</p>
${buildVerificationCodeBlock(code)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;"><tr><td style="background-color:#FEE2E2;border-left:4px solid #DC2626;padding:14px 16px;border-radius:6px;">
<p style="font-size:14px;line-height:1.6;color:#7F1D1D;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><strong>Esta acción es permanente.</strong> Al confirmar, se eliminarán todos tus cupones, lealtades y datos personales. No podrá recuperarse.</p>
</td></tr></table>
<p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Este código expira en <strong style="color:#1F1F1F;">30 minutos</strong>. Si no fuiste tú, ignora este correo.</p>
`.trim();

  return buildEmailLayout({
    preheader: `Código para eliminar tu cuenta: ${code}. Esta acción es permanente.`,
    headerAccentColor: '#DC2626',
    bodyHtml: body
  });
}

function buildAccountDeletionText(code) {
  return `Confirma la eliminación de tu cuenta de Cuponiko\n\nRecibimos una solicitud para eliminar tu cuenta.\n\nTu código de confirmación es: ${code}\n\nEste código expira en 30 minutos.\n\nIMPORTANTE: la eliminación es permanente. Si no fuiste tú, ignora este correo.\n\n¿Necesitas ayuda? Escríbenos a soporte@cuponiko.com\n\n© 2026 Cuponiko · Ricardo Juárez Bravo · Apaxco, Estado de México`;
}

async function sendAccountDeletionEmail(to, code) {
  return sendEmail(to, 'Confirma la eliminación de tu cuenta de Cuponiko', {
    html: buildAccountDeletionHtml(code),
    text: buildAccountDeletionText(code)
  });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountDeletionEmail,
  getLastEmail,
  getLastMockEmail,
  resetLastMockEmail,
};
