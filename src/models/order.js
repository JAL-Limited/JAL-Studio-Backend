const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true },
    checkoutKey: { type: String },
    paymentReference: { type: String, unique: true, sparse: true },
    paymentAuthorizationUrl: { type: String },
    paymentAccessCode: { type: String },
    paymentPaidAt: { type: Date },
    cancellationReason: { type: String, maxlength: 500 },
    returnRequest: {
      reason: { type: String, maxlength: 1000 },
      status: { type: String, enum: ['requested', 'approved', 'rejected'] },
      requestedAt: Date,
    },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, required: true },
        imageUrl: { type: String, required: true },
        unitPriceKobo: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        size: String,
        color: String,
      },
    ],
    sellerFulfillments: [
      {
        seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        status: {
          type: String,
          enum: ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
          required: true,
        },
        updatedAt: { type: Date, required: true },
      },
    ],
    subtotalKobo: { type: Number, required: true, min: 0 },
    deliveryKobo: { type: Number, required: true, min: 0 },
    totalKobo: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['NGN'], default: 'NGN' },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    paymentProvider: { type: String, enum: ['paystack', 'flutterwave', 'bank_transfer'] },
    shippingAddress: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

orderSchema.index({ user: 1, checkoutKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Order', orderSchema);
