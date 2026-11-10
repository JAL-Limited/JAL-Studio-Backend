const { Router } = require('express');
const Order = require('../models/order');
const Product = require('../models/product');
const Review = require('../models/review');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId, z } = require('../utils/validators');

const reviewSchema = z.object({
  orderId: objectId,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(1200),
}).strict();

function createReviewsRouter({ requireAuth }) {
  const router = Router();

  router.get(
    '/products/:productId/reviews',
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      const reviews = await Review.find({ product: productId })
        .populate('user', 'fullName')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      response.json({ data: reviews });
    }),
  );

  router.post(
    '/products/:productId/reviews',
    requireAuth,
    asyncHandler(async (request, response) => {
      const productId = objectId.parse(request.params.productId);
      const input = reviewSchema.parse(request.body);
      const product = await Product.findOne({ _id: productId, isActive: true });
      if (!product) throw new ApiError(404, 'Product not found');
      const order = await Order.findOne({
        _id: input.orderId,
        user: request.user.id,
        status: { $in: ['paid', 'processing', 'shipped', 'delivered'] },
        'items.product': productId,
      });
      if (!order) throw new ApiError(403, 'Only customers who purchased this product can review it');
      const review = await Review.create({
        product: productId,
        user: request.user.id,
        order: order.id,
        rating: input.rating,
        comment: input.comment,
      });
      const [summary] = await Review.aggregate([
        { $match: { product: product._id } },
        { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      product.rating = summary.average;
      product.reviewCount = summary.count;
      await product.save();
      response.status(201).json({ data: review });
    }),
  );

  return router;
}

module.exports = { createReviewsRouter };
