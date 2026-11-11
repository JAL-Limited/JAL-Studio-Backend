const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { createApp } = require('../src/app');
const Cart = require('../src/models/cart');
const Order = require('../src/models/order');
const Product = require('../src/models/product');
const User = require('../src/models/user');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-123456';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/eko_test';

let mongo;
let app;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  app = createApp();
});

after(async () => {
  await disconnectDatabase();
  await mongo.stop();
});

test('health endpoint reports database readiness', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok', database: 'connected' });
});

test('CORS allows configured app origins and withholds headers from other sites', async () => {
  const allowed = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:8765');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:8765');
  const flutterDevPort = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:50123');
  assert.equal(flutterDevPort.headers['access-control-allow-origin'], 'http://localhost:50123');
  const loopbackAddress = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://127.0.0.1:50123');
  assert.equal(loopbackAddress.headers['access-control-allow-origin'], 'http://127.0.0.1:50123');
  const response = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'https://app.example.com');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('catalog is public, paginated, searchable, and validates its query', async () => {
  await Product.create([
    {
      slug: 'test-blazer',
      name: 'Test Blazer',
      category: 'menswear',
      brand: 'Test Atelier',
      priceKobo: 1200000,
      imageUrl: '/media/banner1.jpg',
      sizes: ['M'],
      stock: 3,
    },
    {
      slug: 'test-dress',
      name: 'Test Dress',
      category: 'womenswear',
      brand: 'Test Atelier',
      priceKobo: 900000,
      imageUrl: '/media/banner2.jpg',
      stock: 2,
    },
  ]);
  const list = await request(app).get('/api/v1/products?category=menswear&page=1&limit=1');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.pagination.total, 1);
  assert.equal(list.body.data[0].priceKobo, 1200000);

  const invalid = await request(app).get('/api/v1/products?limit=500');
  assert.equal(invalid.status, 400);

  const filtered = await request(app).get(
    '/api/v1/products?brand=Test%20Atelier&size=M&minPriceKobo=1000000&maxPriceKobo=1300000',
  );
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.length, 1);
  const invertedPrice = await request(app).get(
    '/api/v1/products?minPriceKobo=2000000&maxPriceKobo=1000000',
  );
  assert.equal(invertedPrice.status, 400);
});

test('admin product management is role-protected and can hide or restore a listing', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Marketplace Admin',
    email: 'marketplace-admin@example.com',
    password: 'a-secure-test-password',
  });
  const adminUserId = registration.body.data.user.id;
  await User.findByIdAndUpdate(adminUserId, { $set: { role: 'admin' } });
  const adminAuth = { Authorization: `Bearer ${registration.body.data.token}` };

  const customer = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Regular Customer',
    email: 'regular-customer@example.com',
    password: 'a-secure-test-password',
  });
  const customerAuth = { Authorization: `Bearer ${customer.body.data.token}` };
  const denied = await request(app)
    .get('/api/v1/products/admin')
    .set(customerAuth);
  assert.equal(denied.status, 403);

  const listed = await request(app)
    .get('/api/v1/products/admin')
    .set(adminAuth);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.length >= 2);

  const product = await Product.findOne({ slug: 'test-blazer' });
  const hidden = await request(app)
    .patch(`/api/v1/products/admin/${product.id}/status`)
    .set(adminAuth)
    .send({ isActive: false });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.data.isActive, false);
  assert.equal(
    (await request(app).get('/api/v1/products/test-blazer')).status,
    404,
  );
  const restored = await request(app)
    .patch(`/api/v1/products/admin/${product.id}/status`)
    .set(adminAuth)
    .send({ isActive: true });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.isActive, true);
});

test('registration, authentication, and server-priced cart operations work', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test Customer',
    email: 'customer@example.com',
    password: 'a-secure-test-password',
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.data.user.email, 'customer@example.com');
  const token = registration.body.data.token;

  const unauthenticated = await request(app).get('/api/v1/cart');
  assert.equal(unauthenticated.status, 401);

  const product = await Product.findOne({ slug: 'test-blazer' });
  const add = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId: product.id, quantity: 2 });
  assert.equal(add.status, 201);
  assert.equal(add.body.data.itemCount, 2);
  assert.equal(add.body.data.subtotalKobo, 2400000);

  const login = await request(app).post('/api/v1/auth/login').send({
    email: 'customer@example.com',
    password: 'wrong-password-123',
  });
  assert.equal(login.status, 401);
});

test('checkout rejects a missing saved address and never reports a payment as completed', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Order Customer',
    email: 'order@example.com',
    password: 'a-secure-test-password',
  });
  const token = registration.body.data.token;
  const response = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ addressId: '000000000000000000000000', paymentProvider: 'paystack' });
  assert.equal(response.status, 400);
});

test('Paystack checkout verifies the server-side amount and replays idempotently', async () => {
  const paymentReference = 'eko_test_reference';
  const paystack = {
    isConfigured: true,
    callbackUrl: 'https://example.test/return',
    initialize: async ({ reference }) => ({
      reference,
      authorization_url: 'https://checkout.paystack.com/example',
      access_code: 'test-access-code',
    }),
    verify: async (reference) => ({
      status: 'success',
      reference,
      amount: 2700000,
      currency: 'NGN',
    }),
    verifyWebhookSignature: () => true,
  };
  const paymentApp = createApp({ paystack });
  const registration = await request(paymentApp).post('/api/v1/auth/register').send({
    fullName: 'Paying Customer',
    email: 'paying@example.com',
    password: 'a-secure-test-password',
  });
  const token = registration.body.data.token;
  const auth = { Authorization: `Bearer ${token}` };
  const address = await request(paymentApp)
    .post('/api/v1/account/addresses')
    .set(auth)
    .send({
      label: 'Home',
      fullName: 'Paying Customer',
      phone: '+2348012345678',
      street: '1 Test Street',
      city: 'Lagos',
      state: 'Lagos',
    });
  assert.equal(address.status, 201);

  const product = await Product.findOne({ slug: 'test-blazer' });
  await request(paymentApp)
    .post('/api/v1/cart/items')
    .set(auth)
    .send({ productId: product.id, quantity: 1 });

  const create = () => request(paymentApp)
    .post('/api/v1/orders')
    .set({ ...auth, 'Idempotency-Key': paymentReference })
    .send({ addressId: address.body.data._id });
  const first = await create();
  assert.equal(first.status, 201);
  const orderId = first.body.data.order._id;
  const retry = await create();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.order._id, orderId);

  const start = await request(paymentApp)
    .post(`/api/v1/orders/${orderId}/paystack`)
    .set(auth);
  assert.equal(start.status, 200);
  assert.equal(start.body.data.authorizationUrl, 'https://checkout.paystack.com/example');

  const cancelDuringPayment = await request(paymentApp)
    .post(`/api/v1/orders/${orderId}/cancellation`)
    .set(auth)
    .send({ reason: 'Changed my mind' });
  assert.equal(cancelDuringPayment.status, 409);

  const paid = await request(paymentApp)
    .post(`/api/v1/orders/${orderId}/verify-payment`)
    .set(auth);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.status, 'paid');
  assert.ok(paid.body.data.paymentPaidAt);
  const cart = await Cart.findOne({ user: registration.body.data.user.id });
  assert.equal(cart.items.length, 0);

  const wrongAmount = await request(paymentApp)
    .post('/api/v1/payments/paystack/webhook')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({
      event: 'charge.success',
      data: {
        status: 'success',
        reference: paid.body.data.paymentReference,
        amount: 1,
        currency: 'NGN',
      },
    }));
  assert.equal(wrongAmount.status, 400);
  assert.equal((await Order.findById(orderId)).status, 'paid');
});

test('seller applications do not grant seller privileges without admin approval', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'New Seller',
    email: 'seller-applicant@example.com',
    password: 'a-secure-test-password',
  });
  const auth = { Authorization: `Bearer ${registration.body.data.token}` };
  const application = await request(app)
    .post('/api/v1/seller/applications')
    .set(auth)
    .send({
      businessName: 'Lagos Atelier',
      contactPhone: '+2348012345678',
      description: 'An independent fashion atelier in Lagos.',
    });
  assert.equal(application.status, 201);
  assert.equal(application.body.data.status, 'pending');
  const denied = await request(app).get('/api/v1/products/seller').set(auth);
  assert.equal(denied.status, 403);
});

test('admin can decide a return request without changing the order fulfilment state', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Return Admin',
    email: 'return-admin@example.com',
    password: 'a-secure-test-password',
  });
  await User.findByIdAndUpdate(registration.body.data.user.id, {
    $set: { role: 'admin' },
  });
  const auth = { Authorization: `Bearer ${registration.body.data.token}` };
  const customer = await User.create({
    fullName: 'Return Customer',
    email: 'return-customer@example.com',
    passwordHash: 'not-used-by-this-test',
  });
  const order = await Order.create({
    user: customer.id,
    orderNumber: 'EKO-RETURN-TEST',
    items: [],
    subtotalKobo: 0,
    deliveryKobo: 0,
    totalKobo: 0,
    shippingAddress: { city: 'Lagos' },
    status: 'delivered',
    returnRequest: {
      reason: 'Item arrived damaged',
      status: 'requested',
      requestedAt: new Date(),
    },
  });
  const response = await request(app)
    .patch(`/api/v1/orders/${order.id}/admin-status`)
    .set(auth)
    .send({ returnStatus: 'approved' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'delivered');
  assert.equal(response.body.data.returnRequest.status, 'approved');
});

test('Paystack requires a secret key and signs webhooks with a timing-safe HMAC', async () => {
  const { createPaystackService } = require('../src/services/paystack');
  const unavailable = createPaystackService({});
  assert.equal(unavailable.isConfigured, false);
  await assert.rejects(
    unavailable.initialize({ amount: 100 }),
    (error) => error.status === 503,
  );

  const secret = 'sk_test_local_only_secret';
  const service = createPaystackService({ PAYSTACK_SECRET_KEY: secret });
  const rawBody = Buffer.from('{"event":"charge.success"}');
  const signature = require('node:crypto')
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');
  assert.equal(service.verifyWebhookSignature(rawBody, signature), true);
  assert.equal(service.verifyWebhookSignature(rawBody, '00'.repeat(64)), false);
});

test('support tickets are authenticated and scoped to the customer', async () => {
  const registration = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Support Customer',
    email: 'support@example.com',
    password: 'a-secure-test-password',
  });
  const auth = { Authorization: `Bearer ${registration.body.data.token}` };
  const unauthenticated = await request(app)
    .post('/api/v1/support/tickets')
    .send({ subject: 'Help', message: 'Please help me with my delivery.' });
  assert.equal(unauthenticated.status, 401);
  const submitted = await request(app)
    .post('/api/v1/support/tickets')
    .set(auth)
    .send({
      subject: 'Delivery question',
      message: 'Please let me know when my package will arrive.',
    });
  assert.equal(submitted.status, 201);
  const tickets = await request(app).get('/api/v1/support/tickets').set(auth);
  assert.equal(tickets.status, 200);
  assert.equal(tickets.body.data.length, 1);
  assert.equal(tickets.body.data[0].status, 'open');
});
