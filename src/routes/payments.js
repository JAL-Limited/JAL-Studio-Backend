const { Router } = require('express');
const Order = require('../models/order');
const { asyncHandler } = require('../utils/async-handler');
const { markPaid } = require('./orders');

function createPaymentsRouter({ paystack, deliveryKobo }) {
  const router = Router();

  router.get('/config', (_request, response) => {
    response.json({
      data: { paystackEnabled: paystack.isConfigured, deliveryKobo },
    });
  });

  router.post(
    '/paystack/webhook',
    asyncHandler(async (request, response) => {
      const signature = request.get('x-paystack-signature');
      if (!paystack.verifyWebhookSignature(request.body, signature)) {
        response.status(401).json({ error: { message: 'Invalid payment signature' } });
        return;
      }
      const event = JSON.parse(request.body.toString('utf8'));
      if (event.event === 'charge.success') {
        const reference = event.data?.reference;
        const order = reference ? await Order.findOne({ paymentReference: reference }) : null;
        if (order) await markPaid(order, event.data);
      }
      response.status(200).json({ received: true });
    }),
  );

  return router;
}

module.exports = { createPaymentsRouter };
