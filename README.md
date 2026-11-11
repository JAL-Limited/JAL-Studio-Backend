# JAL Studio API

The JAL Studio Flutter app uses this Express/MongoDB service for customer
accounts, catalog/search, cart, checkout, orders, seller applications, and
support requests.

## Local setup

Use Node.js 20+ and MongoDB 7+. In PowerShell:

```powershell
Copy-Item .env.example .env
npm install
```

Edit the local `.env` file. Do not send it over chat or commit it. The minimum
required values are:

- `MONGODB_URI`: local or Atlas connection string; percent-encode special
  characters in a MongoDB username/password.
- `JWT_SECRET`: generate a private random secret of at least 32 characters.
- `PAYSTACK_SECRET_KEY`: Paystack **test secret key** (`sk_test_...`) for
  local test transactions. Keep it on this Node server only.
- `CORS_ORIGINS`: comma-separated allowed web origins. Native Flutter apps do
  not send a browser Origin header. In development, HTTP loopback origins
  (`localhost`, `127.0.0.1`, or `[::1]`) are allowed on any port for Flutter's
  local web server. Production requires the deployed web app origin to be
  listed explicitly.

Start and seed the API:

```powershell
npm run dev
npm run seed
```

The API listens at `http://localhost:4000/api/v1`. Android emulators reach the
host machine at `10.0.2.2`, so run Flutter with:

```powershell
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
```

The web development app uses `http://localhost:4000/api/v1`.

## Password and account security

The API hashes passwords with scrypt. Authenticated users can change their
password by providing the current password; doing so revokes all other access
tokens for that account. Password reset uses a cryptographically random,
one-time code that expires after 15 minutes. Codes are stored only as SHA-256
hashes, limited to five failed attempts, and emailed through optional SMTP.
Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
and `SMTP_FROM` in the hosting secret manager to enable reset requests. Without
all four required SMTP values, the API responds that password reset delivery
is unavailable rather than pretending an email was sent. Reset requests are
rate-limited separately from other authentication routes.

The Flutter app can optionally use device Face ID or fingerprint to unlock an
existing saved session. Biometric templates never leave the device; biometrics
gate the locally stored session token and are not sent to the API.

## Paystack test setup

1. Create/sign in to your Paystack business dashboard and use **test mode**.
2. Copy the **test secret key** (`sk_test_...`) into the backend `.env` as
   `PAYSTACK_SECRET_KEY`. The Flutter app does not need a Paystack public key:
   payments use Paystack-hosted checkout initialized by the backend.
3. Configure the dashboard webhook to the publicly reachable endpoint
   `https://YOUR_API_HOST/api/v1/payments/paystack/webhook`. A localhost URL
   is not reachable by Paystack. Keep the same test secret key on the server
   so webhook signatures can be verified.
4. Configure the allowed app/web origin in `CORS_ORIGINS` and use HTTPS for
   staging/production.
5. Test successful, failed, abandoned, and duplicate callbacks before enabling
   live payments. A live `sk_live_...` key must be configured only in the
   production secret manager after launch approvals; never put it in Flutter,
   source control, or chat.

Orders remain unpaid until Paystack's server-side verification or a valid
signed webhook confirms the exact amount, currency, and transaction reference.
The API never stores card numbers or CVVs. Refunds, escrow, courier labels, and
seller settlements still require separately selected providers and approved
business policies.

The delivery fee is configured in kobo with `DELIVERY_FEE_KOBO` (default
`1500000`, or NGN 15,000). Checkout reads the fee from the API, which also
calculates the authoritative order total. This is a flat fee, not a courier
quote or zone-based delivery integration.

## Seller product photos

Approved sellers can submit a JPEG, PNG, or WebP product image (up to 5 MB)
with each new listing. The API validates the image signature and stores its
bytes in MongoDB GridFS; public image URLs are served by
`/api/v1/media/products/:imageId`. No separate disk volume or image-hosting
credential is required, but the MongoDB deployment must have sufficient
storage and these API changes must be deployed before uploads are available.

## Seller fulfilment

Each seller sees only their own items in a multi-seller order and updates those
items through `paid → processing → shipped → delivered`. The customer's
order-level status advances only when every seller reaches that stage. These
are seller-reported updates; courier tracking and delivery confirmation are
not integrated.

## API/test commands

```powershell
npm test
npm audit
```

Integration tests use an in-memory MongoDB and do not require live database or
payment credentials.
