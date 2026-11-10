const { Router } = require('express');
const Product = require('../models/product');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { z } = require('../utils/validators');

const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.enum(['menswear', 'womenswear', 'accessories', 'activewear']).optional(),
  brand: z.string().trim().max(80).optional(),
  size: z.string().trim().max(20).optional(),
  color: z.string().trim().max(40).optional(),
  style: z.string().trim().max(40).optional(),
  minPriceKobo: z.coerce.number().int().min(0).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['recommended', 'newest', 'price_asc', 'price_desc']).default('recommended'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const productSchema = z.object({
  slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(['menswear', 'womenswear', 'accessories', 'activewear']),
  brand: z.string().trim().min(2).max(80),
  priceKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  imageUrl: z.string().trim().min(1).max(500),
  sizes: z.array(z.string().trim().min(1).max(20)).max(30).default([]),
  colors: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  styles: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  stock: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

function createProductsRouter({ requireAuth, requireRole }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const query = querySchema.parse(request.query);
      const filter = { isActive: true };
      if (query.category) filter.category = query.category;
      if (query.search) filter.$text = { $search: query.search };
      if (query.brand) filter.brand = new RegExp(`^${query.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (query.size) filter.sizes = query.size;
      if (query.color) filter.colors = new RegExp(`^${query.color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (query.style) filter.styles = new RegExp(`^${query.style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (query.minPriceKobo !== undefined || query.maxPriceKobo !== undefined) {
        filter.priceKobo = {
          ...(query.minPriceKobo !== undefined ? { $gte: query.minPriceKobo } : {}),
          ...(query.maxPriceKobo !== undefined ? { $lte: query.maxPriceKobo } : {}),
        };
      }
      if (
        query.minPriceKobo !== undefined
        && query.maxPriceKobo !== undefined
        && query.minPriceKobo > query.maxPriceKobo
      ) {
        throw new ApiError(400, 'Minimum price cannot exceed maximum price');
      }
      const sort = {
        recommended: { rating: -1, createdAt: -1 },
        newest: { createdAt: -1 },
        price_asc: { priceKobo: 1 },
        price_desc: { priceKobo: -1 },
      }[query.sort];
      const [items, total] = await Promise.all([
        Product.find(filter)
          .sort(sort)
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        Product.countDocuments(filter),
      ]);
      response.json({
        data: items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit),
        },
      });
    }),
  );

  router.use('/seller', requireAuth, requireRole('seller', 'admin'));

  router.post(
    '/seller',
    asyncHandler(async (request, response) => {
      const input = productSchema.parse(request.body);
      const product = await Product.create({ ...input, seller: request.user.id });
      response.status(201).json({ data: product });
    }),
  );

  router.get(
    '/seller',
    asyncHandler(async (request, response) => {
      const filter = request.user.role === 'admin' ? {} : { seller: request.user.id };
      const products = await Product.find(filter).sort({ createdAt: -1 }).lean();
      response.json({ data: products });
    }),
  );

  router.get(
    '/:idOrSlug',
    asyncHandler(async (request, response) => {
      const value = request.params.idOrSlug;
      const product = await Product.findOne({
        isActive: true,
        $or: [
          { slug: value.toLowerCase() },
          ...( /^[a-f\d]{24}$/i.test(value) ? [{ _id: value }] : []),
        ],
      }).lean();
      if (!product) throw new ApiError(404, 'Product not found');
      response.json({ data: product });
    }),
  );

  router.patch(
    '/seller/:productId',
    asyncHandler(async (request, response) => {
      const productId = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.productId);
      const input = productSchema.partial().strict().parse(request.body);
      const filter = { _id: productId, ...(request.user.role === 'admin' ? {} : { seller: request.user.id }) };
      const product = await Product.findOneAndUpdate(filter, { $set: input }, { new: true, runValidators: true });
      if (!product) throw new ApiError(404, 'Product not found');
      response.json({ data: product });
    }),
  );

  router.delete(
    '/seller/:productId',
    asyncHandler(async (request, response) => {
      const productId = z.string().regex(/^[a-f\d]{24}$/i).parse(request.params.productId);
      const filter = { _id: productId, ...(request.user.role === 'admin' ? {} : { seller: request.user.id }) };
      const product = await Product.findOneAndUpdate(filter, { $set: { isActive: false } }, { new: true });
      if (!product) throw new ApiError(404, 'Product not found');
      response.status(204).end();
    }),
  );

  return router;
}

module.exports = { createProductsRouter };
