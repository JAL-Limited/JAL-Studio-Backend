const { Router } = require('express');
const SupportTicket = require('../models/support-ticket');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId, z } = require('../utils/validators');

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(3000),
  orderId: objectId.optional(),
}).strict();

function createSupportRouter({ requireAuth, requireRole }) {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/tickets',
    asyncHandler(async (request, response) => {
      const input = ticketSchema.parse(request.body);
      const ticket = await SupportTicket.create({
        user: request.user.id,
        order: input.orderId,
        subject: input.subject,
        message: input.message,
      });
      response.status(201).json({ data: ticket });
    }),
  );

  router.get(
    '/tickets',
    asyncHandler(async (request, response) => {
      const tickets = await SupportTicket.find({ user: request.user.id }).sort({ createdAt: -1 }).lean();
      response.json({ data: tickets });
    }),
  );

  router.get(
    '/admin/tickets',
    requireRole('admin'),
    asyncHandler(async (_request, response) => {
      const tickets = await SupportTicket.find().populate('user', 'fullName email').sort({ createdAt: -1 }).lean();
      response.json({ data: tickets });
    }),
  );

  router.patch(
    '/admin/tickets/:ticketId',
    requireRole('admin'),
    asyncHandler(async (request, response) => {
      const ticketId = objectId.parse(request.params.ticketId);
      const input = z.object({
        status: z.enum(['open', 'in_progress', 'resolved']),
        staffNote: z.string().trim().max(2000).optional(),
      }).strict().parse(request.body);
      const ticket = await SupportTicket.findByIdAndUpdate(
        ticketId,
        { $set: input },
        { new: true, runValidators: true },
      );
      if (!ticket) throw new ApiError(404, 'Support request not found');
      response.json({ data: ticket });
    }),
  );

  return router;
}

module.exports = { createSupportRouter };
