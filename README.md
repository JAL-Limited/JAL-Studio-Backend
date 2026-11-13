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
- `JWT_SECRET`: generate a private random secret of at least 32 characters,
  for example with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
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

### Configure Gmail SMTP for password reset

For a personal Gmail account:

1. Turn on 2-Step Verification for the Google account that will send JAL Studio
   email.
2. In that account's Google Account security settings, create an **App
   Password**. Use it as `SMTP_PASS`; do not use your normal Google password.
   If Google does not offer App Passwords for the account, use an SMTP provider
   that issues an app-specific SMTP credential.
3. Add these values to the backend `.env` for local testing:

   ```dotenv
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-sending-account@gmail.com
   SMTP_PASS=your-16-character-app-password
   SMTP_FROM=JAL Studio <your-sending-account@gmail.com>
   ```

4. On Render, open the backend service's **Environment** settings and add the
   same six variables there. Save and redeploy. Keep the app password only in
   the backend secret settings and a local, ignored `.env`; never add it to
   Flutter, source control, or chat.
5. Test password reset using an account whose mailbox you can access. Gmail has
   sending limits; for production/high volume, use a transactional email
   provider and its SMTP host, port, username, and password instead.

### Configure Google sign-in

Google sign-in is implemented for Android and iOS. The app sends a Google ID
token to the API, and the API verifies the token's signature, audience, and
expiry with Google before creating/signing into a customer account. The app does
not send or need an OAuth client secret.

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a
   project and configure the OAuth consent screen. Set the app name and support
   email. While the consent screen is in **Testing**, add the Google accounts
   that should be allowed to sign in as test users; publish it when ready for
   public sign-in.
2. Create a **Web application** OAuth client ID. This is the server/audience
   client ID. Add it as `GOOGLE_CLIENT_ID` in the backend `.env` and Render
   Environment settings. The client ID ends in
   `.apps.googleusercontent.com`; it is not a password or client secret.
3. In Google Cloud Console, create an **Android** OAuth client with package
   name `com.jalstudio.jal_studio` and the SHA-1 certificate fingerprints for
   the Android signing keys you use. For local debug builds, get the SHA-1
   with `Push-Location android; .\gradlew signingReport; Pop-Location`.
   Register the production
   release-signing certificate fingerprint separately.
4. Create an **iOS** OAuth client with bundle ID `com.jalstudio.jalStudio`.
   Copy its client ID and its reversed client ID from the Google configuration.
   Add the iOS client ID under `CFBundleURLTypes` > `CFBundleURLSchemes` in
   `ios/Runner/Info.plist` using that reversed client ID. This URL scheme is
   required for the iOS sign-in callback.
5. Build the Flutter app with the web client ID as the server client ID, and
   supply the iOS client ID for iOS builds:

   ```powershell
   flutter run `
     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1 `
     --dart-define=GOOGLE_SERVER_CLIENT_ID=your-web-client-id.apps.googleusercontent.com `
     --dart-define=GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
   ```

   For a release APK, use the production API URL for `API_BASE_URL` and the
   same `GOOGLE_SERVER_CLIENT_ID`. These client IDs are public app
   configuration, not secrets. The backend still requires the matching
   `GOOGLE_CLIENT_ID` environment variable; sign-in returns an explicit
   configuration error until it is set and deployed.
6. Test with one registered account on both platforms. Verify both a new Google
   account and a Google email that already has a JAL account; existing account
   roles and marketplace data are retained.

### Production environment variable checklist

- Required: `MONGODB_URI`, `JWT_SECRET`.
- Password reset email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`.
- Google sign-in: `GOOGLE_CLIENT_ID` on the API. The Flutter build also needs
  `GOOGLE_SERVER_CLIENT_ID`; iOS additionally needs
  `GOOGLE_IOS_CLIENT_ID` and the reversed-client-ID URL scheme.
- Paystack checkout: `PAYSTACK_SECRET_KEY` and `PAYSTACK_CALLBACK_URL`.
- Optional operations: `CORS_ORIGINS`, `DELIVERY_FEE_KOBO`, rate-limit settings.

Never put `JWT_SECRET`, SMTP passwords, MongoDB credentials, or Paystack secret
keys in Flutter `--dart-define` values or app source. Store backend secrets in
Render's Environment settings and change them there if they are ever exposed.

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
