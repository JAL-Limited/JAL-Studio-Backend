const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true, min: 1, max: 10 },
        size: { type: String, trim: true, maxlength: 20 },
        color: { type: String, trim: true, maxlength: 40 },
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model('Cart', cartSchema);
