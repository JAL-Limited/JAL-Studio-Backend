const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const Cart = require('../models/cart');
const Order = require('../models/order');
const Product = require('../models/product');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId, z } = require('../utils/validators');

const checkoutSchema = z.object({ addressId: objectId }).strict();
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const returnSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

function createOrdersRouter({ requireAuth, requireRole, paystack, deliveryKobo }) {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const input = checkoutSchema.parse(request.body);
      const checkoutKey = request.get('idempotency-key') || randomUUID();
      if (checkoutKey.length > 100) throw new ApiError(400, 'Invalid checkout request key');
      const previous = await Order.findOne({ user: request.user.id, checkoutKey });
      if (previous) {
        response.status(200).json({ data: { order: previous, payment: paymentSummary(previous, paystack) } });
        return;
      }
      const address = request.user.addresses.id(input.addressId);
      if (!address) throw new ApiError(400, 'Select a saved delivery address');
      const cart = await Cart.findOne({ user: request.user.id }).populate('items.product');
      if (!cart || !cart.items.length) throw new ApiError(400, 'Your bag is empty');

      const items = cart.items.map((item) => {
        const product = item.product;
        if (!product || !product.isActive) throw new ApiError(409, 'A product in your bag is no longer available');
        if (product.stock < item.quantity) throw new ApiError(409, `${product.name} no longer has the requested stock`);
        return {
          product: product.id,
          seller: product.seller,
          name: product.name,
          imageUrl: product.imageUrl,
          unitPriceKobo: product.priceKobo,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
        };
      });
      const subtotalKobo = items.reduce((total, item) => total + item.unitPriceKobo * item.quantity, 0);
      const sellerIds = [...new Set(items.map((item) => item.seller?.toString()).filter(Boolean))];
      const sellerFulfillments = sellerIds.map((seller) => ({
        seller,
        status: 'pending_payment',
        updatedAt: new Date(),
      }));
      const order = await Order.create({
        user: request.user.id,
        checkoutKey,
        orderNumber: `EKO-${randomUUID().slice(0, 8).toUpperCase()}`,
        items,
        subtotalKobo,
        deliveryKobo,
        totalKobo: subtotalKobo + deliveryKobo,
        paymentProvider: 'paystack',
        shippingAddress: address.toObject(),
        sellerFulfillments,
      });

      response.status(201).json({
        data: {
          order,
          payment: {
            status: 'pending',
            configured: paystack.isConfigured,
            message: paystack.isConfigured
              ? 'Order created. Start secure Paystack checkout to pay.'
              : 'Order is pending. Configure Paystack test credentials to accept payment.',
          },
        },
      });
    }),
  );

  router.post(
    '/:orderId/paystack',
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const order = await Order.findOne({ _id: orderId, user: request.user.id });
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status !== 'pending_payment') throw new ApiError(409, 'This order is no longer awaiting payment');
      if (order.paymentAuthorizationUrl && order.paymentReference) {
        response.json({ data: paymentRedirect(order) });
        return;
      }
      const reference = order.paymentReference || `eko_${randomUUID().replaceAll('-', '')}`;
      const transaction = await paystack.initialize({
        email: request.user.email,
        amount: order.totalKobo,
        currency: 'NGN',
        reference,
        callback_url: paystack.callbackUrl,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      });
      order.paymentReference = transaction.reference;
      order.paymentAuthorizationUrl = transaction.authorization_url;
      order.paymentAccessCode = transaction.access_code;
      await order.save();
      response.json({ data: paymentRedirect(order) });
    }),
  );

  router.post(
    '/:orderId/verify-payment',
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const order = await Order.findOne({ _id: orderId, user: request.user.id });
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status === 'paid' || order.status === 'processing' || order.status === 'shipped' || order.status === 'delivered') {
        response.json({ data: order });
        return;
      }
      if (!order.paymentReference) throw new ApiError(409, 'Start Paystack checkout before verifying payment');
      const transaction = await paystack.verify(order.paymentReference);
      await markPaid(order, transaction);
      response.json({ data: order });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const orders = await Order.find({ user: request.user.id }).sort({ createdAt: -1 }).lean();
      response.json({ data: orders });
    }),
  );

  router.post(
    '/:orderId/cancellation',
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const { reason } = cancellationSchema.parse(request.body);
      const order = await Order.findOne({ _id: orderId, user: request.user.id });
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status === 'cancelled') {
        response.json({ data: order });
        return;
      }
      if (!['pending_payment', 'paid', 'processing'].includes(order.status)) {
        throw new ApiError(409, 'This order can no longer be cancelled online');
      }
      if (order.status === 'pending_payment' && order.paymentReference) {
        throw new ApiError(
          409,
          'A payment session has started. Verify its result before requesting cancellation.',
        );
      }
      order.cancellationReason = reason;
      if (order.status === 'pending_payment') {
        order.status = 'cancelled';
        order.sellerFulfillments.forEach((fulfillment) => {
          fulfillment.status = 'cancelled';
          fulfillment.updatedAt = new Date();
        });
      }
      await order.save();
      response.json({
        data: order,
        message: order.status === 'cancelled'
          ? 'Unpaid order cancelled.'
          : 'Cancellation requested. Contact support if payment was already collected; refunds are handled separately.',
      });
    }),
  );

  router.post(
    '/:orderId/return-request',
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const { reason } = returnSchema.parse(request.body);
      const order = await Order.findOne({ _id: orderId, user: request.user.id });
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status !== 'delivered') throw new ApiError(409, 'A return can only be requested for a delivered order');
      if (order.returnRequest?.status === 'requested') throw new ApiError(409, 'A return request is already being reviewed');
      order.returnRequest = { reason, status: 'requested', requestedAt: new Date() };
      await order.save();
      response.status(201).json({ data: order });
    }),
  );

  router.get(
    '/seller',
    requireRole('seller', 'admin'),
    asyncHandler(async (request, response) => {
      const orders = await Order.find({
        'items.seller': request.user.role === 'admin' ? { $exists: true } : request.user.id,
      }).populate('user', 'fullName email').sort({ createdAt: -1 });
      for (const order of orders) {
        initializeSellerFulfillments(order);
        if (order.isModified('sellerFulfillments')) await order.save();
      }
      const data = orders.map((order) => {
        const serialized = order.toObject();
        if (request.user.role === 'admin') return serialized;
        return sellerOrderResponse(order, request.user.id);
      });
      response.json({ data });
    }),
  );

  router.patch(
    '/seller/:orderId/status',
    requireRole('seller', 'admin'),
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const input = z.object({ status: z.enum(['processing', 'shipped', 'delivered']) }).strict().parse(request.body);
      const order = await Order.findById(orderId);
      if (!order) throw new ApiError(404, 'Order not found');
      initializeSellerFulfillments(order);
      if (order.isModified('sellerFulfillments')) await order.save();
      if (request.user.role === 'admin') {
        const nextStatus = nextFulfillmentStatus(order.status);
        if (nextStatus !== input.status) {
          throw new ApiError(409, `Order cannot move from ${order.status} to ${input.status}`);
        }
        advanceSellerFulfillments(order, input.status);
      } else {
        const fulfillment = order.sellerFulfillments.find(
          (entry) => entry.seller.toString() === request.user.id,
        );
        if (!fulfillment) throw new ApiError(404, 'Order not found');
        const nextStatus = nextFulfillmentStatus(fulfillment.status);
        if (nextStatus !== input.status) {
          throw new ApiError(409, `Your items cannot move from ${fulfillment.status} to ${input.status}`);
        }
        fulfillment.status = input.status;
        fulfillment.updatedAt = new Date();
        order.status = aggregateFulfillmentStatus(order.sellerFulfillments);
      }
      await order.save();
      response.json({
        data: request.user.role === 'admin'
          ? order
          : sellerOrderResponse(order, request.user.id),
      });
    }),
  );

  router.patch(
    '/:orderId/admin-status',
    requireRole('admin'),
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const input = z.object({
        status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']).optional(),
        returnStatus: z.enum(['approved', 'rejected']).optional(),
      }).strict().parse(request.body);
      if (!input.status && !input.returnStatus) {
        throw new ApiError(400, 'Provide an order status or return decision');
      }
      const order = await Order.findById(orderId);
      if (!order) throw new ApiError(404, 'Order not found');
      if (input.status) {
        if (input.status === 'cancelled' && order.status === 'pending_payment') {
          if (order.paymentReference) {
            throw new ApiError(409, 'Verify the payment result before cancelling this order');
          }
          order.status = 'cancelled';
          initializeSellerFulfillments(order);
          order.sellerFulfillments.forEach((fulfillment) => {
            fulfillment.status = 'cancelled';
            fulfillment.updatedAt = new Date();
          });
        } else if (input.status !== 'cancelled') {
          const nextStatus = {
            paid: 'processing',
            processing: 'shipped',
            shipped: 'delivered',
          }[order.status];
          if (nextStatus !== input.status) {
            throw new ApiError(409, `Order cannot move from ${order.status} to ${input.status}`);
          }
          initializeSellerFulfillments(order);
          advanceSellerFulfillments(order, input.status);
        } else {
          throw new ApiError(409, 'Paid-order cancellation requires a separately verified refund process');
        }
      }
      if (input.returnStatus) {
        if (!order.returnRequest) throw new ApiError(409, 'This order has no return request');
        order.returnRequest.status = input.returnStatus;
      }
      await order.save();
      response.json({ data: order });
    }),
  );

  router.get(
    '/:orderId',
    asyncHandler(async (request, response) => {
      const orderId = objectId.parse(request.params.orderId);
      const order = await Order.findOne({ _id: orderId, user: request.user.id }).lean();
      if (!order) throw new ApiError(404, 'Order not found');
      response.json({ data: order });
    }),
  );

  return router;
}

function paymentSummary(order, paystack) {
  return {
    status: order.status === 'paid' ? 'success' : 'pending',
    configured: paystack.isConfigured,
    ...(order.paymentReference ? { reference: order.paymentReference } : {}),
    ...(order.paymentAuthorizationUrl ? { authorizationUrl: order.paymentAuthorizationUrl } : {}),
    message: paystack.isConfigured
      ? 'Start secure Paystack checkout to pay.'
      : 'Configure Paystack test credentials to accept payment.',
  };
}

function paymentRedirect(order) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    reference: order.paymentReference,
    authorizationUrl: order.paymentAuthorizationUrl,
    status: order.status,
  };
}

async function markPaid(order, transaction) {
  if (
    transaction.status !== 'success'
    || transaction.reference !== order.paymentReference
    || transaction.amount !== order.totalKobo
    || transaction.currency !== 'NGN'
  ) {
    throw new ApiError(400, 'Payment could not be verified against this order');
  }
  if (order.status !== 'pending_payment') return order;
  order.status = 'paid';
  order.paymentPaidAt = new Date();
  initializeSellerFulfillments(order);
  order.sellerFulfillments.forEach((fulfillment) => {
    fulfillment.status = 'paid';
    fulfillment.updatedAt = order.paymentPaidAt;
  });
  await order.save();
  await Cart.updateOne({ user: order.user }, { $set: { items: [] } });
  return order;
}

function initializeSellerFulfillments(order) {
  if (order.sellerFulfillments.length) return;
  const sellerIds = [...new Set(
    order.items.map((item) => item.seller?.toString()).filter(Boolean),
  )];
  if (!sellerIds.length) return;
  const status = order.status === 'pending_payment' ? 'pending_payment' : order.status;
  if (!['pending_payment', 'paid', 'processing', 'shipped', 'delivered'].includes(status)) return;
  order.sellerFulfillments = sellerIds.map((seller) => ({
    seller,
    status,
    updatedAt: order.updatedAt || order.createdAt || new Date(),
  }));
}

function nextFulfillmentStatus(status) {
  return {
    paid: 'processing',
    processing: 'shipped',
    shipped: 'delivered',
  }[status];
}

function aggregateFulfillmentStatus(fulfillments) {
  const rank = { paid: 0, processing: 1, shipped: 2, delivered: 3 };
  const aggregate = Math.min(...fulfillments.map((fulfillment) => rank[fulfillment.status]));
  return ['paid', 'processing', 'shipped', 'delivered'][aggregate];
}

function advanceSellerFulfillments(order, targetStatus) {
  const rank = { paid: 0, processing: 1, shipped: 2, delivered: 3 };
  order.sellerFulfillments.forEach((fulfillment) => {
    if (rank[fulfillment.status] < rank[targetStatus]) {
      fulfillment.status = targetStatus;
      fulfillment.updatedAt = new Date();
    }
  });
  order.status = order.sellerFulfillments.length
    ? aggregateFulfillmentStatus(order.sellerFulfillments)
    : targetStatus;
}

function sellerOrderResponse(order, sellerId) {
  const serialized = order.toObject();
  const items = serialized.items.filter(
    (item) => item.seller?.toString() === sellerId,
  );
  const fulfillment = order.sellerFulfillments.find(
    (entry) => entry.seller.toString() === sellerId,
  );
  return {
    ...serialized,
    items,
    sellerStatus: order.status === 'cancelled'
      ? 'cancelled'
      : fulfillment?.status ?? order.status,
    sellerSubtotalKobo: items.reduce(
      (total, item) => total + item.unitPriceKobo * item.quantity,
      0,
    ),
  };
}

module.exports = { createOrdersRouter, markPaid };
