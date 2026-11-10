require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { getEnv } = require('./config/env');
const Product = require('./models/product');

const products = [
  {
    slug: 'stitched-leather-silk-blazer',
    name: 'Stitched Leather Silk Blazer',
    category: 'menswear',
    brand: 'Atelier Urbanett',
    priceKobo: 7000000,
    imageUrl: '/media/banner1.jpg',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Navy', 'Black', 'Sand', 'Stone'],
    stock: 12,
    rating: 4.8,
    reviewCount: 124,
    description: 'A tailored silk-blend statement piece from Atelier Urbanett.',
  },
  {
    slug: 'linen-blend-suit',
    name: 'Linen Blend Suit',
    category: 'menswear',
    brand: 'Atelier Urbanett',
    priceKobo: 9500000,
    imageUrl: '/media/banner2.jpg',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Sand', 'Cream'],
    stock: 8,
    rating: 4.7,
    reviewCount: 38,
  },
  {
    slug: 'classic-overcoat',
    name: 'Classic Overcoat',
    category: 'menswear',
    brand: 'EKŌ Studio',
    priceKobo: 12000000,
    imageUrl: '/media/banner3.jpg',
    sizes: ['M', 'L', 'XL'],
    colors: ['Black', 'Camel'],
    stock: 6,
    rating: 4.9,
    reviewCount: 19,
  },
  {
    slug: 'two-piece-set',
    name: 'Two Piece Set',
    category: 'womenswear',
    brand: 'EKŌ Studio',
    priceKobo: 8000000,
    imageUrl: '/media/banner4.jpg',
    sizes: ['S', 'M', 'L'],
    colors: ['Olive', 'Brown'],
    stock: 10,
    rating: 4.6,
    reviewCount: 26,
  },
  {
    slug: 'floral-midi-dress',
    name: 'Floral Midi Dress',
    category: 'womenswear',
    brand: 'Atelier Urbanett',
    priceKobo: 3200000,
    imageUrl: '/media/banner2.jpg',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Blue floral'],
    stock: 15,
    rating: 4.8,
    reviewCount: 41,
  },
  {
    slug: 'oversized-tee-set',
    name: 'Oversized Tee Set',
    category: 'menswear',
    brand: 'EKŌ Studio',
    priceKobo: 2800000,
    imageUrl: '/media/banner3.jpg',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black', 'White'],
    stock: 20,
    rating: 4.5,
    reviewCount: 17,
  },
];

async function seed() {
  await connectDatabase(getEnv().MONGODB_URI);
  for (const product of products) {
    await Product.updateOne({ slug: product.slug }, { $set: product }, { upsert: true });
  }
  console.info(`Upserted ${products.length} EKŌ catalog products`);
}

seed()
  .catch((error) => {
    console.error('Failed to seed catalog', error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
