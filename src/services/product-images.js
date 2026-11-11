const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');
const { ApiError } = require('../utils/api-error');

const PRODUCT_IMAGE_BUCKET = 'product_images';

function getProductImageBucket() {
  const database = mongoose.connection.db;
  if (!database) throw new ApiError(503, 'Image storage is unavailable');
  return new mongoose.mongo.GridFSBucket(database, {
    bucketName: PRODUCT_IMAGE_BUCKET,
  });
}

function inspectProductImage(buffer) {
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  throw new ApiError(400, 'Choose a JPEG, PNG, or WebP product image');
}

async function saveProductImage(buffer, sellerId) {
  const image = inspectProductImage(buffer);
  const bucket = getProductImageBucket();
  const upload = bucket.openUploadStream(`seller-product.${image.extension}`, {
    contentType: image.contentType,
    metadata: {
      sellerId: String(sellerId),
      contentType: image.contentType,
    },
  });
  await pipeline(Readable.from(buffer), upload);
  return String(upload.id);
}

async function deleteProductImage(imageId) {
  const bucket = getProductImageBucket();
  await bucket.delete(new mongoose.Types.ObjectId(imageId));
}

module.exports = {
  PRODUCT_IMAGE_BUCKET,
  deleteProductImage,
  getProductImageBucket,
  saveProductImage,
};
