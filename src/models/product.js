const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    category: {
      type: String,
      enum: ['menswear', 'womenswear', 'accessories', 'activewear'],
      required: true,
      index: true,
    },
    brand: { type: String, required: true, trim: true, maxlength: 80 },
    priceKobo: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    currency: { type: String, enum: ['NGN'], default: 'NGN' },
    imageUrl: { type: String, required: true },
    sizes: { type: [String], default: [] },
    colors: { type: [String], default: [] },
    styles: { type: [String], default: [], index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    stock: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

productSchema.index({ name: 'text', brand: 'text', description: 'text', styles: 'text' });

module.exports = mongoose.model('Product', productSchema);
