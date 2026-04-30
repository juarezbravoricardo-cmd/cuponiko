'use strict';

/**
 * Servicio Stripe.
 *
 * Producción: usa el SDK oficial `stripe` con STRIPE_SECRET_KEY y verifica
 * firmas de webhooks con `constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`.
 *
 * Mock: expone `verifyWebhookSignature(rawBody, signature)` que acepta si el
 * signature es exactamente `mock-sig-ok` y rechaza lo demás, más un helper
 * `createCheckoutSession` que fabrica una URL determinista.
 *
 * Esto permite escribir tests de BILL-02 (T-150/151/152/154) que envían el
 * body JSON directamente sin depender de Stripe real.
 */

const env = require('../config/env');
const { AppError } = require('../utils/AppError');
const logger = require('../utils/logger');

let _stripeClient = null;
function getClient() {
  if (env.MOCK_EXTERNAL_SERVICES) return null;
  if (!_stripeClient) {
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    _stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return _stripeClient;
}

/**
 * Crea una sesión de checkout Stripe para subscripción Premium.
 * @param {{ businessId:number, email:string, customerId?:string }} args
 * @returns {Promise<{ id:string, url:string, customer_id?:string }>}
 */
async function createCheckoutSession({ businessId, email, customerId }) {
  if (env.MOCK_EXTERNAL_SERVICES) {
    const id = `cs_test_mock_${businessId}_${Date.now()}`;
    return {
      id,
      url: `https://mock.checkout.cuponiko/${id}`,
      customer_id: customerId || `cus_mock_${businessId}`,
    };
  }
  const stripe = getClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: env.STRIPE_PRICE_PREMIUM, quantity: 1 }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email,
    metadata: { business_id: String(businessId) },
    subscription_data: {
      metadata: { business_id: String(businessId) },
    },
  });
  return {
    id: session.id,
    url: session.url,
    customer_id: session.customer || null,
  };
}

/**
 * Verifica la firma del webhook y devuelve el evento parseado.
 * rawBody DEBE ser Buffer (o string sin parsear).
 * @returns {object} evento Stripe
 */
function verifyWebhookSignature(rawBody, signature) {
  if (env.MOCK_EXTERNAL_SERVICES) {
    if (signature !== 'mock-sig-ok') {
      throw new AppError(400, 'STRIPE_SIGNATURE', 'Firma de webhook inválida.');
    }
    try {
      const event = JSON.parse(rawBody.toString('utf8'));
      if (!event || !event.id || !event.type) {
        throw new Error('bad shape');
      }
      return event;
    } catch (_e) {
      throw new AppError(400, 'STRIPE_SIGNATURE', 'Payload de webhook inválido.');
    }
  }

  const stripe = getClient();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn('stripe_webhook_signature_failed', { message: err.message });
    throw new AppError(400, 'STRIPE_SIGNATURE', 'Firma de webhook inválida.');
  }
}

module.exports = {
  createCheckoutSession,
  verifyWebhookSignature,
};
