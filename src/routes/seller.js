const { Router } = require('express');
const User = require('../models/user');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { z } = require('../utils/validators');

const applicationSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(6).max(30),
  description: z.string().trim().min(20).max(1000),
}).strict();

function createSellerRouter({ requireAuth, requireRole }) {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/applications',
    asyncHandler(async (request, response) => {
      if (request.user.role !== 'customer') {
        throw new ApiError(409, 'Only customer accounts can submit a seller application');
      }
      if (request.user.sellerApplication?.status === 'pending') {
        throw new ApiError(409, 'Your seller application is already being reviewed');
      }
      const input = applicationSchema.parse(request.body);
      request.user.sellerApplication = {
        ...input,
        status: 'pending',
        submittedAt: new Date(),
      };
      await request.user.save();
      response.status(201).json({ data: request.user.sellerApplication });
    }),
  );

  router.get('/applications/me', (request, response) => {
    response.json({ data: request.user.sellerApplication || null });
  });

  router.get(
    '/admin/applications',
    requireRole('admin'),
    asyncHandler(async (_request, response) => {
      const applications = await User.find({ 'sellerApplication.status': 'pending' })
        .select('fullName email phone sellerApplication')
        .sort({ 'sellerApplication.submittedAt': 1 })
        .lean();
      response.json({ data: applications });
    }),
  );

  router.patch(
    '/admin/applications/:userId',
    requireRole('admin'),
    asyncHandler(async (request, response) => {
      const decision = z.object({ status: z.enum(['approved', 'rejected']) }).strict().parse(request.body);
      const user = await User.findById(request.params.userId);
      if (!user || user.sellerApplication?.status !== 'pending') {
        throw new ApiError(404, 'Pending seller application not found');
      }
      user.sellerApplication.status = decision.status;
      user.sellerApplication.reviewedAt = new Date();
      if (decision.status === 'approved') user.role = 'seller';
      await user.save();
      response.json({
        data: {
          userId: user.id,
          role: user.role,
          sellerApplication: user.sellerApplication,
        },
      });
    }),
  );

  router.get('/me', requireRole('seller', 'admin'), (request, response) => {
    response.json({
      data: {
        business: request.user.sellerApplication,
        role: request.user.role,
      },
    });
  });

  return router;
}

module.exports = { createSellerRouter };
