const { Router } = require('express');
const mongoose = require('mongoose');
const { getProductImageBucket } = require('../services/product-images');
const { ApiError } = require('../utils/api-error');
const { asyncHandler } = require('../utils/async-handler');
const { objectId } = require('../utils/validators');

function createMediaRouter() {
  const router = Router();

  router.get(
    '/products/:imageId',
    asyncHandler(async (request, response, next) => {
      const imageId = new mongoose.Types.ObjectId(
        objectId.parse(request.params.imageId),
      );
      const bucket = getProductImageBucket();
      const [file] = await bucket.find({ _id: imageId }).limit(1).toArray();
      if (!file) throw new ApiError(404, 'Product image not found');
      const contentType = file.metadata?.contentType;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        throw new ApiError(415, 'Product image format is not supported');
      }

      response.set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(file.length),
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      });
      const image = bucket.openDownloadStream(imageId);
      image.on('error', (error) => {
        if (response.headersSent) {
          response.destroy(error);
        } else {
          next(error);
        }
      });
      image.pipe(response);
    }),
  );

  return router;
}

module.exports = { createMediaRouter };
