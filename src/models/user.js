const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 40 },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    street: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 30 },
    passwordHash: { type: String, select: false },
    tokenVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordResetAttempts: { type: Number, default: 0, select: false },
    role: { type: String, enum: ['customer', 'seller', 'admin'], default: 'customer' },
    sellerApplication: {
      businessName: { type: String, trim: true, maxlength: 120 },
      contactPhone: { type: String, trim: true, maxlength: 30 },
      description: { type: String, trim: true, maxlength: 1000 },
      status: { type: String, enum: ['pending', 'approved', 'rejected'] },
      submittedAt: Date,
      reviewedAt: Date,
    },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    addresses: { type: [addressSchema], default: [] },
    measurements: {
      chestCm: Number,
      waistCm: Number,
      seatCm: Number,
      shoulderCm: Number,
      sleeveCm: Number,
      insideLegCm: Number,
    },
    notifications: {
      orderUpdates: { type: Boolean, default: true },
      privateStyling: { type: Boolean, default: true },
      newCollections: { type: Boolean, default: true },
      offers: { type: Boolean, default: false },
    },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model('User', userSchema);
