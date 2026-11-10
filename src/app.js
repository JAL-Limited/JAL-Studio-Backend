const path = require('node:path');
const { randomUUID } = require('node:crypto');
const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { getEnv } = require('./config/env');
const { createAuthMiddleware } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { createAccountRouter } = require('./routes/account');
const { createAuthRouter } = require('./routes/auth');
const { createCartRouter } = require('./routes/cart');
const { createOrdersRouter } = require('./routes/orders');
const { createPaymentsRouter } = require('./routes/payments');
const { createProductsRouter } = require('./routes/products');
const { createReviewsRouter } = require('./routes/reviews');
const { createPaystackService } = require('./services/paystack');
const { createSellerRouter } = require('./routes/seller');
const { createSupportRouter } = require('./routes/support');

function createApp(options = {}) {
  const env = options.env || getEnv();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  app.use((request, response, next) => {
    request.id = request.get('x-request-id') || randomUUID();
    response.set('X-Request-Id', request.id);
    next();
  });
  app.use(helmet());
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  app.use(cors({
    origin(origin, callback) {
      let isLocalDevelopmentOrigin = false;
      if (origin && env.NODE_ENV !== 'production') {
        try {
          const parsedOrigin = new URL(origin);
          isLocalDevelopmentOrigin = parsedOrigin.protocol === 'http:'
            && ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname);
        } catch {
          isLocalDevelopmentOrigin = false;
        }
      }
      if (!origin || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }));
  const paystack = options.paystack || createPaystackService(env, options.fetchImpl);
  app.use('/api/v1/payments', express.raw({ type: 'application/json', limit: '32kb' }));
  app.use('/api/v1/payments', createPaymentsRouter({ paystack }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/media', express.static(path.resolve(__dirname, '../../assets/images'), {
    fallthrough: false,
    immutable: true,
    maxAge: '1d',
  }));

  app.get('/api/v1/health', (_request, response) => {
    const ready = mongoose.connection.readyState === 1;
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      database: ready ? 'connected' : 'disconnected',
    });
  });

  const apiLimiter = rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    limit: env.API_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  const { requireAuth, requireRole } = createAuthMiddleware(env);
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', createAuthRouter({ env, requireAuth, authLimiter }));
  app.use('/api/v1', createReviewsRouter({ requireAuth }));
  app.use('/api/v1/products', createProductsRouter({ requireAuth, requireRole }));
  app.use('/api/v1/account', createAccountRouter({ requireAuth }));
  app.use('/api/v1/cart', createCartRouter({ requireAuth }));
  app.use('/api/v1/orders', createOrdersRouter({ requireAuth, requireRole, paystack }));
  app.use('/api/v1/seller', createSellerRouter({ requireAuth, requireRole }));
  app.use('/api/v1/support', createSupportRouter({ requireAuth, requireRole }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
