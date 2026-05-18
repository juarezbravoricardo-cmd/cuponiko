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
 *
 * Pricing v2: el price_id se selecciona desde el map `PRICE_IDS` según el
 * `billingInterval` ('monthly' | 'quarterly'). Ambas variables ya están
 * configuradas en Railway (STRIPE_PRICE_MONTHLY, STRIPE_PRICE_QUARTERLY).
 */

const env = require('../config/env');
const { AppError } = require('../utils/AppError');
const logger = require('../utils/logger');

const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  quarterly: process.env.STRIPE_PRICE_QUARTERLY,
};

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
 * @param {{ businessId:number, email:string, customerId?:string, billingInterval:'monthly'|'quarterly' }} args
 * @returns {Promise<{ id:string, url:string, customer_id?:string }>}
 */
async function createCheckoutSession({ businessId, email, customerId, billingInterval }) {
  const priceId = PRICE_IDS[billingInterval];
  if (!priceId && !env.MOCK_EXTERNAL_SERVICES) {
    // Defensa profunda: la validación de billing_interval ocurre antes en BILL-01,
    // pero si llega aquí sin price configurado, fallar explícito.
    throw new AppError(500, 'STRIPE_PRICE_MISSING', 'Configuración de pricing incompleta.');
  }

  if (env.MOCK_EXTERNAL_SERVICES) {
    const id = `cs_test_mock_${billingInterval}_${businessId}_${Date.now()}`;
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
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email,
    metadata: {
      business_id: String(businessId),
      billing_interval: billingInterval, // CRITICO: para que el webhook lo lea
    },
    subscription_data: {
      metadata: {
        business_id: String(businessId),
        billing_interval: billingInterval,
      },
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

async function createAdCheckoutSession({ businessId, email, customerId, amountMXN, adId, packageKey, packageDays }) {
  if (env.MOCK_EXTERNAL_SERVICES) {
    const id = `cs_test_mock_ad_${adId}_${Date.now()}`;
    return { id, url: `https://mock.checkout.cuponiko/${id}`, customer_id: customerId || `cus_mock_${businessId}` };
  }
  const stripe = getClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'mxn',
        unit_amount: Math.round(amountMXN * 100),
        product_data: {
          name: `Anuncio Cuponiko — Paquete ${packageKey}`,
          description: `Campaña publicitaria de ${packageDays} días en el mapa de Cuponiko`,
        },
      },
      quantity: 1,
    }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email,
    metadata: {
      business_id: String(businessId),
      type: 'ad_payment',
      ad_id: String(adId),
      package_key: packageKey,
      package_days: String(packageDays),
    },
  });
  return { id: session.id, url: session.url, customer_id: session.customer || null };
}

module.exports = {
  createCheckoutSession,
  createAdCheckoutSession,
  verifyWebhookSignature,
  PRICE_IDS,
};
