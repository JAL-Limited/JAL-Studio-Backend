const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Router } = require('express');
const User = require('../models/user');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { email, password, z } = require('../utils/validators');
const { hashPassword, verifyPassword } = require('../utils/password');

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
}).strict();
const passwordResetRequestSchema = z.object({ email }).strict();
const passwordResetConfirmSchema = z.object({
  email,
  code: z.string().trim().min(20).max(100),
  password,
}).strict();

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email,
  password,
  phone: z.string().trim().max(30).optional(),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const googleSignInSchema = z.object({
  idToken: z.string().trim().min(20).max(8192),
}).strict();

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

function createAuthRouter({
  env,
  requireAuth,
  authLimiter,
  passwordResetLimiter,
  passwordResetEmail,
  googleAuth,
}) {
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
      const token = signAccessToken(user, env);
      response.status(201).json({ data: { user: publicUser(user), token } });
    }),
  );

  router.post(
    '/login',
    authLimiter,
    asyncHandler(async (request, response) => {
      const input = loginSchema.parse(request.body);
      const user = await User.findOne({ email: input.email }).select('+passwordHash');
      const isValid = user?.passwordHash
        && (await verifyPassword(input.password, user.passwordHash));
      if (!isValid) throw new ApiError(401, 'Email or password is incorrect');
      const token = signAccessToken(user, env);
      response.json({ data: { user: publicUser(user), token } });
    }),
  );

  router.post(
    '/google',
    authLimiter,
    asyncHandler(async (request, response) => {
      if (!googleAuth?.isConfigured) {
        throw new ApiError(503, 'Google sign-in is not configured on the server');
      }
      const { idToken } = googleSignInSchema.parse(request.body);
      let identity;
      try {
        identity = await googleAuth.verifyIdToken(idToken);
      } catch {
        throw new ApiError(401, 'Google sign-in token is invalid or expired');
      }
      const verifiedEmail = typeof identity?.email === 'string'
        ? identity.email.trim().toLowerCase()
        : '';
      if (
        identity?.email_verified !== true
        || !email.safeParse(verifiedEmail).success
      ) {
        throw new ApiError(401, 'Google account must have a verified email address');
      }

      let user = await User.findOne({ email: verifiedEmail });
      if (!user) {
        const fullName = typeof identity.name === 'string' && identity.name.trim()
          ? identity.name.trim().slice(0, 100)
          : verifiedEmail.split('@')[0].slice(0, 100);
        user = await User.create({ fullName, email: verifiedEmail });
      }
      const token = signAccessToken(user, env);
      response.json({ data: { user: publicUser(user), token } });
    }),
  );

  router.post(
    '/password',
    requireAuth,
    authLimiter,
    asyncHandler(async (request, response) => {
      const input = passwordChangeSchema.parse(request.body);
      if (input.currentPassword === input.newPassword) {
        throw new ApiError(400, 'Choose a new password different from your current one');
      }
      const user = await User.findById(request.user.id).select('+passwordHash');
      if (
        !user
        || !user.passwordHash
        || !(await verifyPassword(input.currentPassword, user.passwordHash))
      ) {
        throw new ApiError(400, 'Current password is incorrect');
      }
      user.passwordHash = await hashPassword(input.newPassword);
      user.tokenVersion += 1;
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpiresAt = undefined;
      user.passwordResetAttempts = 0;
      await user.save();
      response.json({
        data: {
          token: signAccessToken(user, env),
          message: 'Password changed. Other active sessions have been signed out.',
        },
      });
    }),
  );

  router.post(
    '/password-reset/request',
    passwordResetLimiter,
    asyncHandler(async (request, response) => {
      const input = passwordResetRequestSchema.parse(request.body);
      if (!passwordResetEmail?.isConfigured) {
        throw new ApiError(503, 'Password reset email is not configured on the server');
      }
      const user = await User.findOne({ email: input.email });
      if (user) {
        const code = crypto.randomBytes(24).toString('base64url');
        user.passwordResetTokenHash = hashResetCode(code);
        user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
        user.passwordResetAttempts = 0;
        await user.save();
        try {
          await passwordResetEmail.sendCode({ email: user.email, code });
        } catch (error) {
            console.error('Password reset email delivery failed', {
              requestId: request.id,
              code: error.code || 'SMTP_ERROR',
            });
            user.passwordResetTokenHash = undefined;
          user.passwordResetExpiresAt = undefined;
          await user.save();
          throw new ApiError(503, 'Could not send the reset code. Please try again later.');
        }
      }
      response.status(202).json({
        data: { message: 'If that email belongs to an account, a reset code has been sent.' },
      });
    }),
  );

  router.post(
    '/password-reset/confirm',
    passwordResetLimiter,
    asyncHandler(async (request, response) => {
      const input = passwordResetConfirmSchema.parse(request.body);
      const now = new Date();
      const user = await User.findOne({
        email: input.email,
        passwordResetTokenHash: hashResetCode(input.code),
        passwordResetExpiresAt: { $gt: now },
        passwordResetAttempts: { $lt: 5 },
      }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt +passwordResetAttempts');
      if (!user) {
        await User.updateOne(
          {
            email: input.email,
            passwordResetExpiresAt: { $gt: now },
            passwordResetAttempts: { $lt: 5 },
          },
          { $inc: { passwordResetAttempts: 1 } },
        );
        throw new ApiError(400, 'Reset code is invalid or expired');
      }
      const passwordHash = await hashPassword(input.password);
      const update = await User.updateOne(
        {
          _id: user.id,
          passwordResetTokenHash: hashResetCode(input.code),
          passwordResetExpiresAt: { $gt: now },
          passwordResetAttempts: { $lt: 5 },
        },
        {
          $set: {
            passwordHash,
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
            passwordResetAttempts: 0,
          },
          $inc: { tokenVersion: 1 },
        },
      );
      if (update.modifiedCount !== 1) {
        throw new ApiError(400, 'Reset code is invalid or expired');
      }
      response.json({
        data: { message: 'Password reset. Sign in with your new password.' },
      });
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

function signAccessToken(user, env) {
  return jwt.sign(
    { sub: user.id, role: user.role, ver: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: 'eko-store-api', audience: 'eko-store-app' },
  );
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

module.exports = { createAuthRouter, publicUser };
