const crypto = require('node:crypto');
const { ApiError } = require('../utils/api-error');

const PAYSTACK_API = 'https://api.paystack.co';

function createPaystackService(env, fetchImpl = global.fetch) {
  function requireConfigured() {
    if (!env.PAYSTACK_SECRET_KEY) {
      throw new ApiError(503, 'Paystack is not configured. Add the test secret key to the backend environment.');
    }
  }

  async function request(endpoint, options = {}) {
    requireConfigured();
    let response;
    try {
      response = await fetchImpl(`${PAYSTACK_API}${endpoint}`, {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (error) {
      console.error('Paystack request failed', { endpoint, error });
      throw new ApiError(502, 'The payment provider could not be reached. Please try again.');
    }
    let result;
    try {
      result = await response.json();
    } catch (error) {
      console.error('Paystack returned an invalid response', { endpoint, error });
      throw new ApiError(502, 'The payment provider returned an invalid response');
    }
    if (!response.ok || result.status !== true) {
      throw new ApiError(502, result.message || 'The payment provider could not process the request');
    }
    return result.data;
  }

  return {
    isConfigured: Boolean(env.PAYSTACK_SECRET_KEY),
    callbackUrl: env.PAYSTACK_CALLBACK_URL,
    initialize: (payload) => request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    verify: (reference) => request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    ),
    verifyWebhookSignature(rawBody, signature) {
      if (!env.PAYSTACK_SECRET_KEY || !signature || !Buffer.isBuffer(rawBody)) return false;
      const expected = crypto
        .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
        .update(rawBody)
        .digest();
      let actual;
      try {
        actual = Buffer.from(signature, 'hex');
      } catch {
        return false;
      }
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    },
  };
}

module.exports = { createPaystackService };
