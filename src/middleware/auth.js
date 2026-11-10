const jwt = require('jsonwebtoken');
const User = require('../models/user');
const { ApiError } = require('../utils/api-error');

function createAuthMiddleware(env) {
  async function requireAuth(request, _response, next) {
    try {
      const header = request.get('authorization');
      if (!header || !header.startsWith('Bearer ')) {
        throw new ApiError(401, 'Sign in to continue');
      }
      const claims = jwt.verify(header.slice(7), env.JWT_SECRET);
      if (typeof claims !== 'object' || typeof claims.sub !== 'string') {
        throw new ApiError(401, 'Invalid or expired access token');
      }
      const user = await User.findById(claims.sub);
      if (!user) throw new ApiError(401, 'Account no longer exists');
      request.user = user;
      next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return next(new ApiError(401, 'Invalid or expired access token'));
      }
      next(error);
    }
  }

  function requireRole(...roles) {
    return function roleGuard(request, _response, next) {
      if (!request.user || !roles.includes(request.user.role)) {
        return next(new ApiError(403, 'You do not have permission to do that'));
      }
      next();
    };
  }

  return { requireAuth, requireRole };
}

module.exports = { createAuthMiddleware };
