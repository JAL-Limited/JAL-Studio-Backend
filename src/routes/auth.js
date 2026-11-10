const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Router } = require('express');
const User = require('../models/user');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { email, password, z } = require('../utils/validators');
const { hashPassword, verifyPassword } = require('../utils/password');

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email,
  password,
  phone: z.string().trim().max(30).optional(),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    wishlist: user.wishlist,
    addresses: user.addresses,
    measurements: user.measurements,
    notifications: user.notifications,
  };
}

function createAuthRouter({ env, requireAuth, authLimiter }) {
  const router = Router();

  router.post(
    '/register',
    authLimiter,
    asyncHandler(async (request, response) => {
      const input = registerSchema.parse(request.body);
      const passwordHash = await hashPassword(input.password);
      const user = await User.create({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
      });
      const token = jwt.sign(
        { sub: user.id, role: user.role },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN, issuer: 'eko-store-api', audience: 'eko-store-app' },
      );
      response.status(201).json({ data: { user: publicUser(user), token } });
    }),
  );

  router.post(
    '/login',
    authLimiter,
    asyncHandler(async (request, response) => {
      const input = loginSchema.parse(request.body);
      const user = await User.findOne({ email: input.email }).select('+passwordHash');
      const isValid = user && (await verifyPassword(input.password, user.passwordHash));
      if (!isValid) throw new ApiError(401, 'Email or password is incorrect');
      const token = jwt.sign(
        { sub: user.id, role: user.role },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN, issuer: 'eko-store-api', audience: 'eko-store-app' },
      );
      response.json({ data: { user: publicUser(user), token } });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (request, response) => {
      response.json({ data: { user: publicUser(request.user) } });
    }),
  );

  return router;
}

module.exports = { createAuthRouter, publicUser };
