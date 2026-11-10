const { ApiError } = require('../utils/api-error');

function notFoundHandler(request, _response, next) {
  next(new ApiError(404, `Route not found: ${request.method} ${request.path}`));
}

function errorHandler(error, request, response, _next) {
  if (response.headersSent) return;

  let status = error.status || 500;
  let message = error.message || 'An unexpected server error occurred';
  let details = error.details;

  if (error.name === 'ValidationError') {
    status = 400;
    message = 'Request validation failed';
    details = Object.values(error.errors).map((item) => item.message);
  } else if (error.name === 'ZodError') {
    status = 400;
    message = 'Request validation failed';
    details = error.issues.map((item) => ({
      path: item.path.join('.'),
      message: item.message,
    }));
  } else if (error.code === 11000) {
    status = 409;
    message = 'A record with that value already exists';
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  }

  if (status >= 500) {
    console.error('Unhandled API request error', {
      requestId: request.id,
      method: request.method,
      path: request.path,
      error,
    });
    message = 'An unexpected server error occurred';
  }

  response.status(status).json({
    error: {
      message,
      ...(details ? { details } : {}),
      requestId: request.id,
    },
  });
}

module.exports = { errorHandler, notFoundHandler };
