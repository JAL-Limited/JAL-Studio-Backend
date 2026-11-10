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
  not send a browser Origin header; add the deployed web app origin for web.

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

## API/test commands

```powershell
npm test
npm audit
```

Integration tests use an in-memory MongoDB and do not require live database or
payment credentials.
