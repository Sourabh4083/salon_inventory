# Salon & Hair Inventory Management System (MVP)

Internal inventory application for a salon / hair replacement / wig shop. It answers the daily questions
the owner and manager have: what is on the shelf, how many, what is running low, what is out, and who
changed stock and when.

Version 1 covers products, stock movements, low/out-of-stock views, barcode lookup, two roles (Owner, Manager),
business settings and simple customer **billing** with sales reports. It is **not** a CRM, accounting or booking system.

---

## Features

- **Dashboard** with KPI cards (total products, units in stock, low stock, out of stock), low-stock and
  out-of-stock lists, recent stock activity and quick actions (Add Product, Add Stock, Record Sale, Scan).
- **Inventory** list: search by name / SKU / barcode, category filter, stock-status filter, sorting, pagination.
  Table on desktop, touch-friendly cards on phones.
- **Product details** with current quantity, prices, identifiers, and the complete stock history.
- **Sell / reduce stock**, **Add stock**, **Adjust stock** dialogs with big `[-] 1 [+]` steppers.
  Overselling is rejected server-side; stock can never go negative.
- **Stock movement ledger**: every quantity change creates a `StockMovement`
  (`INITIAL_STOCK`, `STOCK_IN`, `SALE`, `ADJUSTMENT`) with previous/new quantity, note and user.
- **Low Stock** and **Out of Stock** screens with an Add Stock button on every row.
- **Barcode**: manual entry, search-by-barcode, USB keyboard-wedge scanners (type + Enter opens the product),
  and optional phone-camera scanning (`/scan`, uses `@zxing/browser`).
- **Add / edit / archive** products with auto-generated numbers (`PRD-000001`), unique SKU / barcode.
- **Billing**: New Bill screen with barcode scan / search, one-tap salon services, per-line price and quantity,
  customer name/phone, discount, payment method (Cash / UPI / Card). Completing a bill saves it as `BILL-000001`
  and reduces stock in the same transaction (one `SALE` movement per product, linked by `billId`). Prices are
  snapshotted on the bill, so later catalogue changes never alter old bills. Printable 80 mm receipt.
- **Bills list** with search (number, customer, phone, item), status and date filters; bill detail with reprint.
- **Owner-only**: cancel a bill (kept on record as CANCELLED, stock restored via `BILL_CANCELLED` movements),
  manage the services catalogue, **Sales Reports** (sales, product vs service income, gross profit from cost
  prices, payments split, sales by day, top products/services) and a "Sales today" card on the dashboard.
- **Owner-only**: manager accounts (create, rename, disable, reset password), business settings
  (name, currency, low-stock threshold), product categories, permanent product delete, audit log.
- **Audit log** of important events (product created/edited/archived, user created/disabled, settings changed, logins).
- Responsive layout: sidebar on desktop/tablet, hamburger sheet navigation on mobile, no horizontal overflow.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript |
| UI | Tailwind CSS 4, shadcn/ui (Base UI), Lucide icons, Sonner toasts |
| Forms / validation | React Hook Form, Zod |
| Database | PostgreSQL 18 (embedded local server for development), Prisma 7 with `@prisma/adapter-pg` |
| Auth | Argon2id password hashing, signed HttpOnly session cookie (jose / HS256) |
| Tests | Vitest (unit + integration against a real Postgres test database, plus HTTP route tests) |

## Folder structure

```
prisma/
  schema.prisma          Data model
  migrations/            SQL migrations (incl. product-number sequence)
  seed.ts                Demo users, categories, settings, inventory import
data/
  Hair accesories.xlsx   Shop stock sheet imported by the seed (optional)
  db/                    Embedded PostgreSQL data (git-ignored)
scripts/
  db-start.ts            Starts the embedded PostgreSQL server
src/
  proxy.ts               Route protection (redirects, owner-only paths)
  app/
    login/               Login page
    (app)/               Authenticated area: dashboard, inventory, activity, users, settings, scan
    actions/             Server Actions (auth, products, inventory, users, settings)
  components/
    ui/                  shadcn/ui primitives
    app/                 Application components (product list, dialogs, forms, nav ...)
  lib/
    auth/                Password hashing, session cookie, token, guards
    services/            Business logic: products, inventory (transactions), users, settings, audit
    validation/          Zod schemas
    permissions.ts       Role -> permission matrix
    stock-status.ts      IN_STOCK / LOW_STOCK / OUT_OF_STOCK rule
    format.ts            ₹ money and date formatting
tests/                   Vitest suites (tests/http runs against a live server)
```

## Environment variables

Copy `.env.example` to `.env` and adjust:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma and the app |
| `SESSION_SECRET` | Long random secret used to sign session cookies (min 16 chars, use 48+ in production) |
| `APP_URL` | Public URL; when it starts with `https` the cookie is marked `Secure` in production |
| `TEST_DATABASE_URL` | Optional; test database (defaults to `DATABASE_URL` + `_test`) |
| `DB_POOL_MAX` | Optional; DB connections per app instance (default 2 on Vercel, 5 elsewhere). On serverless hosts point `DATABASE_URL` at a transaction-mode pooler (Supabase port 6543) |
| `SEED_OWNER_PASSWORD`, `SEED_MANAGER_PASSWORD` | Optional; passwords for the seeded demo accounts |

`.env` is git-ignored. Never commit secrets.

## PostgreSQL configuration

**Option A: embedded local server (zero install, used for development)**

```bash
npm run db:start
```

This downloads/starts PostgreSQL in `./data/db` on port `5433` (user `postgres`, password `postgres`) and creates
`salon_inventory` and `salon_inventory_test`. Keep the terminal open; press Ctrl+C to stop.
The matching `DATABASE_URL` is already in `.env.example`.

**Option B: your own PostgreSQL** (local install, Docker, Supabase, Neon, RDS ...)

Create a database (UTF-8 encoding) and set `DATABASE_URL`, e.g.
`postgresql://user:password@host:5432/salon_inventory?schema=public`.

## Installation

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then edit values
npm run db:start            # (Option A) in a separate terminal
npm run db:migrate          # apply migrations (development)
npm run db:seed             # demo accounts, categories, inventory
npm run dev                 # http://localhost:3000
```

### Prisma migration commands

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | `prisma migrate dev` - create/apply migrations in development |
| `npm run db:deploy` | `prisma migrate deploy` - apply migrations in production/CI |
| `npm run db:studio` | Prisma Studio data browser |
| `npx prisma migrate reset` | Drop, re-migrate and re-seed the development database |

### Seed

`npm run db:seed` (or `npx prisma db seed`) creates:

- Owner `owner@salon.local` and Manager `manager@salon.local`
- 13 categories (Hair System, Wig, Topper, Hair Extension, Adhesive, Glue, Tape, Solvent / Remover,
  Softener, Scalp Care, Hair Accessory, Tool, Other)
- Business settings (INR / ₹, low-stock threshold 4)
- The shop inventory. If `data/Hair accesories.xlsx` exists it is imported (columns
  *Products*, *Price*, *Available stock*; empty rows skipped, names trimmed, no duplicates);
  otherwise the same list is created from a built-in table. A few hair-system / topper /
  extension items are added as well.

The seed is idempotent: re-running it never duplicates products or users.

### Other commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit + integration tests (needs the database running) |
| `npm run test:http` | Route-protection tests against a running server (`npm run dev` first, seeded DB) |
| `npm run check` | lint + typecheck + test + build |

## Demo credentials

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@salon.local` | `Owner@Salon2026!` |
| Manager | `manager@salon.local` | `Manager@Salon2026!` |

Override with `SEED_OWNER_PASSWORD` / `SEED_MANAGER_PASSWORD` before seeding. Passwords are stored only
as Argon2id hashes. Change these before any real deployment.

## How stock status works

The shop-wide **low stock threshold** (default **4**) lives in Business Settings and can be changed by the Owner.
A product may optionally override it (Owner only, on the edit form).

| Quantity | Status |
| --- | --- |
| `> threshold` (5 and above with the default) | **IN STOCK** (green) |
| `1 … threshold` (1 to 4) | **LOW STOCK** (amber) |
| `0` | **OUT OF STOCK** (red) |

The rule is implemented once in `src/lib/stock-status.ts` and, for database filtering and dashboard counts,
as a single SQL expression using `COALESCE(product.lowStockThreshold, settings.lowStockThreshold)`.

### Inventory rules

- Every change to a quantity goes through `src/lib/services/inventory.ts`, inside a database transaction
  that locks the product row (`SELECT ... FOR UPDATE`), re-reads the quantity, validates, updates the product and
  inserts exactly one `StockMovement`. Two simultaneous sales of the last unit cannot both succeed.
- Selling more than available returns "Only N units are currently available."; quantities never go negative.
- Adjustments record the difference and require a reason. Nothing overwrites a quantity silently.
- Product edits never change quantity. Products are archived, never deleted; history is kept.
- Movement records have no delete path in the application.

## How barcode lookup works

1. Every product has an optional, unique `barcode` (and SKU).
2. The inventory search box searches name, SKU and barcode as you type (debounced, server-rendered results).
3. Pressing **Enter** (which is what a USB scanner sends after the digits) triggers an exact lookup
   (`barcode`, then SKU, then product number). On a match the product page opens immediately; otherwise the
   text is used as a normal search.
4. The **Scan Barcode** page (`/scan`) adds phone-camera scanning with `@zxing/browser` (needs HTTPS or
   `localhost` for camera access) and a plain input for USB scanners.
5. The dashboard quick actions ("Record Sale", "Add Stock") also accept a scanned code in their product picker.

## Owner vs Manager

| Capability | Owner | Manager |
| --- | --- | --- |
| Dashboard, search, scan, product list, product details | ✓ | ✓ |
| Add product, edit basic product info | ✓ | ✓ |
| Reduce stock (no bill), add stock, adjust stock, view history | ✓ | ✓ |
| Create bills, view bills, print receipts | ✓ | ✓ |
| Cancel bills, manage services catalogue, sales reports | ✓ | – |
| Set per-product low-stock override | ✓ | – |
| Archive / restore / permanently delete products | ✓ | – |
| Manage manager accounts | ✓ | – |
| Business settings, categories, audit log | ✓ | – |

Permissions are defined in `src/lib/permissions.ts` and enforced **server-side** in every Server Action
(`requirePermission`) and page (`requirePermissionPage`), in addition to the route proxy and hidden UI.

## Testing

```bash
npm run db:start      # database must be running
npm test              # 45 tests: auth, permissions, products, inventory, ledger, search, archive, concurrency
npm run dev           # then, in another terminal:
npm run test:http     # 12 HTTP tests: redirects, forged cookies, owner-only routes
```

Integration tests run against the `salon_inventory_test` database (migrated automatically).

## Deployment

1. Provision PostgreSQL (UTF-8) and set `DATABASE_URL`, a strong `SESSION_SECRET`, and `APP_URL` (https).
2. `npm ci && npm run build`
3. `npm run db:deploy` (applies migrations) and optionally `npm run db:seed` for the first owner account.
   Change the owner password immediately via Users → Change password.
4. `npm start` behind a reverse proxy (Nginx/Caddy) with HTTPS, or deploy to Vercel/Railway/Render
   (build command `npm run build`, start command `npm start`, run `npm run db:deploy` as a release step).
5. Back up the database regularly; it is the only place stock history lives.

## Roadmap (out of scope for V1)

Suppliers and purchase orders, GST invoices, returns/refunds, a customer list with history, appointments,
multiple branches, wig attribute schema (base, length, colour), notifications, WhatsApp receipt sharing. The service layer and schema are structured so these can be added
without changing the stock ledger.
