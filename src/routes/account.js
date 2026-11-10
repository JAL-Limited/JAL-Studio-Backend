const { Router } = require('express');
const Product = require('../models/product');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId, z } = require('../utils/validators');
const { publicUser } = require('./auth');

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  measurements: z.object({
    chestCm: z.number().positive().max(300).optional(),
    waistCm: z.number().positive().max(300).optional(),
    seatCm: z.number().positive().max(300).optional(),
    shoulderCm: z.number().positive().max(150).optional(),
    sleeveCm: z.number().positive().max(200).optional(),
    insideLegCm: z.number().positive().max(200).optional(),
  }).partial().optional(),
  notifications: z.object({
    orderUpdates: z.boolean().optional(),
    privateStyling: z.boolean().optional(),
    newCollections: z.boolean().optional(),
    offers: z.boolean().optional(),
  }).partial().optional(),
}).strict();
const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(30),
  street: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().max(20).optional(),
  isDefault: z.boolean().optional(),
}).strict();

function createAccountRouter({ requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', (request, response) => {
    response.json({ data: { user: publicUser(request.user) } });
  });

  router.patch(
    '/me',
    asyncHandler(async (request, response) => {
      const patch = profileSchema.parse(request.body);
      for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          request.user[key] = { ...request.user[key]?.toObject?.(), ...value };
        } else {
          request.user[key] = value;
        }
      }
      await request.user.save();
      response.json({ data: { user: publicUser(request.user) } });
    }),
  );

  router.get('/wishlist', asyncHandler(async (request, response) => {
    const user = await request.user.populate('wishlist');
    response.json({ data: user.wishlist });
  }));

  router.post(
    '/wishlist/:productId',
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      const exists = await Product.exists({ _id: productId, isActive: true });
      if (!exists) throw new ApiError(404, 'Product not found');
      await request.user.updateOne({ $addToSet: { wishlist: productId } });
      response.status(204).end();
    }),
  );

  router.delete(
    '/wishlist/:productId',
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      await request.user.updateOne({ $pull: { wishlist: productId } });
      response.status(204).end();
    }),
  );

  router.get('/addresses', (request, response) => {
    response.json({ data: request.user.addresses });
  });

  router.post(
    '/addresses',
    asyncHandler(async (request, response) => {
      const input = addressSchema.parse(request.body);
      const isDefault = input.isDefault === true || request.user.addresses.length === 0;
      if (isDefault) {
        request.user.addresses.forEach((address) => { address.isDefault = false; });
      }
      request.user.addresses.push({ ...input, isDefault });
      await request.user.save();
      response.status(201).json({ data: request.user.addresses.at(-1) });
    }),
  );

  router.patch(
    '/addresses/:addressId',
    asyncHandler(async (request, response) => {
      const addressId = objectId.parse(request.params.addressId);
      const input = addressSchema.partial().parse(request.body);
      const address = request.user.addresses.id(addressId);
      if (!address) throw new ApiError(404, 'Address not found');
      if (input.isDefault) {
        request.user.addresses.forEach((item) => { item.isDefault = false; });
      }
      address.set(input);
      await request.user.save();
      response.json({ data: address });
    }),
  );

  router.delete(
    '/addresses/:addressId',
    asyncHandler(async (request, response) => {
      const addressId = objectId.parse(request.params.addressId);
      const address = request.user.addresses.id(addressId);
      if (!address) throw new ApiError(404, 'Address not found');
      const wasDefault = address.isDefault;
      address.deleteOne();
      if (wasDefault && request.user.addresses.length) {
        request.user.addresses[0].isDefault = true;
      }
      await request.user.save();
      response.status(204).end();
    }),
  );

  return router;
}

module.exports = { createAccountRouter };
