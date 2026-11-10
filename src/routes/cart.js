const { Router } = require('express');
const Cart = require('../models/cart');
const Product = require('../models/product');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId, quantity, z } = require('../utils/validators');

const addItemSchema = z.object({
  productId: objectId,
  quantity: quantity.default(1),
  size: z.string().trim().max(20).optional(),
  color: z.string().trim().max(40).optional(),
});
const updateItemSchema = z.object({ quantity }).strict();

async function getPopulatedCart(userId) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) return { items: [], itemCount: 0, subtotalKobo: 0, currency: 'NGN' };
  const items = cart.items
    .filter((item) => item.product && item.product.isActive)
    .map((item) => ({
      product: item.product,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      lineTotalKobo: item.product.priceKobo * item.quantity,
    }));
  return {
    id: cart.id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalKobo: items.reduce((sum, item) => sum + item.lineTotalKobo, 0),
    currency: 'NGN',
  };
}

function createCartRouter({ requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', asyncHandler(async (request, response) => {
    response.json({ data: await getPopulatedCart(request.user.id) });
  }));

  router.post(
    '/items',
    asyncHandler(async (request, response) => {
      const input = addItemSchema.parse(request.body);
      const product = await Product.findOne({ _id: input.productId, isActive: true });
      if (!product) throw new ApiError(404, 'Product not found');
      if (product.stock < input.quantity) throw new ApiError(409, 'Not enough stock for this item');
      if (input.size && product.sizes.length && !product.sizes.includes(input.size)) {
        throw new ApiError(400, 'This size is not available');
      }
      const cart = await Cart.findOneAndUpdate(
        { user: request.user.id },
        { $setOnInsert: { items: [] } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const existing = cart.items.find(
        (item) => item.product.toString() === input.productId
          && item.size === input.size
          && item.color === input.color,
      );
      const nextQuantity = (existing?.quantity || 0) + input.quantity;
      if (nextQuantity > 10 || nextQuantity > product.stock) {
        throw new ApiError(409, 'Requested quantity exceeds the available limit or stock');
      }
      if (existing) existing.quantity = nextQuantity;
      else cart.items.push({ product: product.id, quantity: input.quantity, size: input.size, color: input.color });
      await cart.save();
      response.status(201).json({ data: await getPopulatedCart(request.user.id) });
    }),
  );

  router.patch(
    '/items/:productId',
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      const input = updateItemSchema.parse(request.body);
      const cart = await Cart.findOne({ user: request.user.id });
      const item = cart?.items.find((entry) => entry.product.toString() === productId);
      if (!item) throw new ApiError(404, 'Cart item not found');
      const product = await Product.findOne({ _id: productId, isActive: true });
      if (!product || input.quantity > product.stock) throw new ApiError(409, 'Requested quantity exceeds available stock');
      item.quantity = input.quantity;
      await cart.save();
      response.json({ data: await getPopulatedCart(request.user.id) });
    }),
  );

  router.delete(
    '/items/:productId',
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      await Cart.updateOne({ user: request.user.id }, { $pull: { items: { product: productId } } });
      response.status(204).end();
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (request, response) => {
      await Cart.updateOne({ user: request.user.id }, { $set: { items: [] } });
      response.status(204).end();
    }),
  );

  return router;
}

module.exports = { createCartRouter, getPopulatedCart };
