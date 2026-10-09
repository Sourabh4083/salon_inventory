# Salon Inventory & Billing

A web application for running the back office of a salon, hair-replacement and wig shop: stock, customer
billing, purchase orders, staff, expenses and sales reports, for two roles (Owner and Manager).

It is built for daily use at the counter on a phone, tablet or PC. Every stock change is recorded in a
ledger, money is handled in integer paise, and all permissions are enforced on the server.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748)
![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18)

## Contents

- [Features](#features)
- [Roles and permissions](#roles-and-permissions)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Database and migrations](#database-and-migrations)
- [Business rules](#business-rules)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

## Features

### Inventory

- **Products** with auto-generated numbers (`PRD-000001`), category, unit, unique SKU and barcode, selling
  price, owner-only cost price, location and notes. Products are archived rather than deleted, so history
  is kept.
- **Stock ledger**: every quantity change writes one `StockMovement` (initial stock, stock in, sale,
  adjustment, bill cancelled, bill edited) with the previous and new quantity, a note and the user.
- **Low Stock** and **Out of Stock** screens, driven by a shop-wide threshold with an optional per-product
  override.
- **Barcode**: USB scanners (type and Enter), search by code, and phone-camera scanning at `/scan`.
- **Purchase orders** (`ORD-000001`): add products to an order, mark lines received as deliveries arrive
  (stock goes up on receipt), and the order stays active until everything is received or the owner
  closes it.
- **Prices & Margins** (owner): cost, selling price, profit per unit, margin and stock value, with inline
  price editing.

### Billing

- **New Bill**: scan or search products, tap saved salon services or add a one-off service, set quantity
  and price per line, discount, and payment by Cash, UPI or Card. Completing a bill saves it as
  `BILL-000001` and reduces stock in the same transaction. Prices are copied onto the bill, so later
  catalogue changes never alter old bills.
- **Open bills**: for a customer still in the shop, the manager picks the employee handling them, adds
  products and services as they are used, and taps **Keep open**. Open bills show as cards on the Bills
  page; the bill is completed when the customer pays. Stock changes only on completion.
- **Pay later**: part or nothing paid at the counter, with the balance tracked on the bill and collected
  in one or more later payments. Customer name and phone are required.
- **Bills list** with search, status and date filters, an "unpaid" view, and a printable receipt sized
  for 80 mm thermal rolls or A4.
- **Owner only**: edit a completed bill (stock, reports and profit follow), cancel a bill (stock is put
  back), manage the services catalogue.

### Shop operations

- **Expenses**: day-to-day spending with amount, description and payment method.
- **Calls**: new-customer leads (phone numbers from JustDial, WhatsApp or callers). Tap to dial, log the
  result (Coming, Call back, No answer, Not interested) with a follow-up date. A lead closes
  automatically as Visited when a bill is made for the same number.
- **Employees**: staff records, masked Aadhaar number, document uploads (JPG, PNG, WebP or PDF up to
  4 MB, stored in PostgreSQL), monthly salary, salary payment log and cash advances.
- **Attendance**: Present, Absent, Half day, Holiday and Leave per day, with a month summary and the pay
  cut it produces.
- **Sales Reports** (owner): sales, product and service income, gross profit, expenses, product
  purchases, payments received, sales by day, top products and services.
- **Excel export** (owner): products, bills, sales report, expenses, salaries and stock activity.

### Platform

- **Dashboard** with stock KPIs, low-stock and out-of-stock lists, quick actions and, for the owner,
  sales and gross profit today.
- **Night mode**: a sun/moon button in the side menu, remembered per device. The night palette is a warm
  charcoal with soft off-white text and muted accents; receipts always print black on white.
- **Responsive**: sidebar on desktop and tablet, slide-out menu on phones, tables become cards.
- **Audit log** of important events (logins, product and user changes, bills, payments, discarded open
  bills, settings).

## Roles and permissions

| Capability | Owner | Manager |
| --- | :---: | :---: |
| Dashboard, product list and details, barcode scan | ✓ | ✓ |
| Add products, edit basic product information | ✓ | ✓ |
| Add stock, reduce stock | ✓ | ✓ |
| Adjust stock to a counted quantity | ✓ | – |
| See cost prices, change prices, Prices & Margins | ✓ | – |
| Archive, restore or delete products | ✓ | – |
| Stock Activity (movement ledger) | ✓ | – |
| Create bills, open bills, print receipts | ✓ | ✓ |
| Record payments on pay-later bills | ✓ | ✓ |
| Edit or cancel bills, manage services | ✓ | – |
| View purchase orders, mark deliveries received | ✓ | ✓ |
| Place purchase orders, adding new products while ordering (no costs for the manager) | ✓ | ✓ |
| Edit and close purchase orders, see order costs | ✓ | – |
| Record expenses | ✓ | ✓ (own entries, today only) |
| Note an employee advance | ✓ | ✓ (today only) |
| See, total or remove employee advances | ✓ | – |
| Calls (leads) | ✓ | ✓ |
| Mark attendance, see attendance days | ✓ | ✓ |
| Decide whether a leave is paid, see pay cut amounts | ✓ | – |
| Employee names, designation, phone and joining date | ✓ | ✓ |
| Salaries, personal details, documents, salary payments | ✓ | – |
| Sales Reports, Excel export | ✓ | – |
| Users, business settings, categories, audit log | ✓ | – |

The matrix lives in [`src/lib/permissions.ts`](src/lib/permissions.ts). It is enforced in every server
action (`requirePermission`) and page (`requirePermissionPage`), in addition to the route proxy and the
hidden navigation. Cost prices are stripped on the server before a manager's page or action result is
sent to the browser.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript 5 |
| UI | Tailwind CSS 4, shadcn/ui on Base UI, Lucide icons, Sonner toasts |
| Forms and validation | React Hook Form, Zod 4 |
| Database | PostgreSQL 18, Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Auth | Argon2id password hashing, signed HttpOnly session cookie (`jose`, HS256) |
| Barcode | `@zxing/browser` |
| Spreadsheets | `xlsx` (seed import and Excel export) |
| Tests | Vitest against a real PostgreSQL database |

## Architecture

```
Browser
  │
  ▼
src/proxy.ts            redirects anonymous visitors, blocks owner-only paths
  │
  ▼
Pages (Server Components)  ──►  src/lib/services/*  ──►  Prisma  ──►  PostgreSQL
Server Actions             ──►  (business rules,
src/app/actions/*               transactions, audit)
  ▲
  │ Zod schemas (src/lib/validation/schemas.ts)
```

- **Pages** read through the service layer and render on the server. There is no client-side data
  fetching library.
- **Server Actions** validate input with Zod, check the permission, call one service function and
  revalidate the affected paths. They return `{ ok, data }` or `{ ok: false, error, fieldErrors }`.
- **Services** hold every business rule. Anything that changes stock or money runs in a database
  transaction with row locks.
- **The proxy** is a first line of defence only. The real authorisation is a fresh database lookup of
  the user in layouts, pages and actions, so a disabled account loses access immediately.

## Project structure

```
prisma/
  schema.prisma            Data model
  migrations/              SQL migrations, including the number sequences
  seed.ts                  Demo users, categories, settings and inventory import
scripts/
  db-start.ts              Starts the embedded PostgreSQL server for development
data/
  Hair accesories.xlsx     Optional stock sheet imported by the seed
  db/                      Embedded PostgreSQL data (git-ignored)
src/
  proxy.ts                 Route protection
  app/
    login/                 Login page
    (app)/                 Authenticated area: dashboard, billing, inventory, orders, expenses,
                           calls, reports, pricing, employees, attendance, activity, users, settings, scan
    actions/               Server Actions
    api/                   File routes: Excel export, employee documents
    globals.css            Design tokens for the day and night palettes, print styles
  components/
    ui/                    shadcn/ui primitives
    app/                   Application components
  lib/
    auth/                  Password hashing, session cookie, token, guards
    services/              Business logic, one file per area
    validation/            Zod schemas
    permissions.ts         Role to permission matrix
    stock-status.ts        IN_STOCK / LOW_STOCK / OUT_OF_STOCK rule
    money.ts               Paise arithmetic
    timezone.ts            Salon timezone helpers (Asia/Kolkata)
  generated/prisma/        Generated Prisma client
tests/                     Vitest suites; tests/http runs against a live server
```

## Getting started

### Prerequisites

- Node.js 20.9 or newer (developed on Node 22) and npm
- No PostgreSQL install is needed for development; an embedded server is included

### Install and run

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # the defaults point at the embedded database

npm run db:start            # terminal 1: PostgreSQL on 127.0.0.1:5433, keep it running

npm run db:deploy           # terminal 2: apply migrations
npm run db:seed             # demo accounts, categories, inventory
npm run dev                 # http://localhost:3000
```

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@salon.local` | `Owner@Salon2026!` |
| Manager | `manager@salon.local` | `Manager@Salon2026!` |

Set `SEED_OWNER_PASSWORD` and `SEED_MANAGER_PASSWORD` before seeding to use different passwords. Change
them before any real deployment.

The seed is idempotent. It creates the two accounts, 13 product categories, business settings (INR,
low-stock threshold 4) and the shop inventory, imported from `data/Hair accesories.xlsx` when that file
exists and from a built-in list otherwise.

## Environment variables

Copy `.env.example` to `.env`. The file is git-ignored; never commit secrets.

| Variable | Required | Purpose |
| --- | :---: | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma and the app |
| `SESSION_SECRET` | yes | Secret that signs session cookies. Use a long random value in production |
| `APP_URL` | yes | Public URL. When it starts with `https`, the session cookie is marked `Secure` in production |
| `TEST_DATABASE_URL` | no | Database used by the test suite. Defaults to `DATABASE_URL` with `_test` appended to the database name |
| `DB_POOL_MAX` | no | Connections per app instance. Defaults to 2 on Vercel and 5 elsewhere |
| `SEED_OWNER_PASSWORD`, `SEED_MANAGER_PASSWORD` | no | Passwords for the seeded demo accounts |
| `EMBEDDED_PG_PORT` | no | Port for the embedded development database (default 5433) |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (`prisma generate` then `next build`) |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit and integration tests (the database must be running) |
| `npm run test:http` | Route-protection tests against a running, seeded server |
| `npm run check` | Lint, typecheck, test and build |
| `npm run db:start` | Start the embedded PostgreSQL server |
| `npm run db:migrate` | `prisma migrate dev`: create and apply a migration in development |
| `npm run db:deploy` | `prisma migrate deploy`: apply pending migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |

## Database and migrations

### Development database

`npm run db:start` runs PostgreSQL from `./data/db` on port 5433 (user `postgres`, password `postgres`)
and creates the `salon_inventory` and `salon_inventory_test` databases. Stop it with Ctrl+C.

To use your own PostgreSQL instead (local install, Docker, Supabase, Neon, RDS), create a UTF-8 database
and set `DATABASE_URL`.

### Changing the schema

1. Edit `prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name <short_name>` against the development database.
3. Run `npx prisma generate` if the client was not regenerated, and restart `npm run dev`.
4. Commit the new folder under `prisma/migrations/`.
5. Apply it to each hosted database with `npm run db:deploy`.

Migrations are plain SQL and are applied in order. Product, bill and order numbers come from PostgreSQL
sequences (`product_number_seq`, `bill_number_seq`, `order_number_seq`) created by the migrations.

### Data model overview

| Area | Models |
| --- | --- |
| Accounts | `User`, `AuditLog`, `BusinessSettings` |
| Inventory | `Category`, `Product`, `StockMovement`, `PurchaseOrder`, `PurchaseOrderItem` |
| Billing | `Service`, `Bill`, `BillItem`, `BillPayment`, `OpenBill` |
| Staff | `Employee`, `EmployeeDocument`, `SalaryPayment`, `EmployeeAdvance`, `Attendance` |
| Shop | `Expense`, `Enquiry`, `EnquiryCall` |

## Business rules

### Stock status

| Quantity | Status |
| --- | --- |
| Above the threshold | In stock |
| 1 up to the threshold | Low stock |
| 0 | Out of stock |

The shop-wide threshold (default 4) is set in Settings; the owner can override it per product. The rule
is implemented once in `src/lib/stock-status.ts` and mirrored as one SQL expression for filters and
dashboard counts.

### Stock integrity

- Every quantity change goes through `src/lib/services/inventory.ts` in a transaction that locks the
  product row, re-reads the quantity, validates and writes exactly one movement. Two simultaneous sales
  of the last unit cannot both succeed.
- Quantities never go negative. Adjustments record the difference and require a reason.
- Editing a product never changes its quantity. Movements have no delete path.

### Bills and money

- Amounts travel as decimal strings and are calculated in integer paise (`src/lib/money.ts`).
- A bill stores a snapshot of each line's name, price and cost. Reports and profit use the snapshot.
- A bill's balance is its total minus its payments. Payments, edits and cancellation of one bill are
  serialised with a row lock so the balance cannot drift.
- Completing an open bill deletes the open bill in the same transaction as creating the bill, so one
  open bill can never produce two bills.

### Attendance and pay cuts

- One day's pay is the monthly salary divided by the days in that month.
- Absent days and unpaid leave are cut in full, a half day by half. One holiday per Monday-to-Sunday
  week is not cut. A leave is cut until the owner marks it paid. Unmarked days are not cut.
- The manager can edit the last 7 days; holidays and leave can be entered up to 60 days ahead.

### Dates and times

All day boundaries, reports and bill dates use the salon's timezone, `Asia/Kolkata`
(`src/lib/timezone.ts`), regardless of where the server runs.

## Testing

```bash
npm run db:start      # the database must be running
npm test              # 183 tests across 17 files

npm run dev           # then, in another terminal, against a seeded database:
npm run test:http     # redirects, forged cookies, owner-only routes
```

The suite covers authentication, permissions, products, the stock ledger, concurrency, billing, bill
edits, pay-later payments, open bills, purchase orders, employees, advances, expenses, enquiries and
attendance.

Integration tests run against a real PostgreSQL database, migrate it automatically and **wipe every
table in it**. They use `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test` appended to the database
name. Never point either at a database whose data you need.

## Deployment

The app runs anywhere Node.js and PostgreSQL are available. The reference setup is Vercel with Supabase.

1. **Database**: provision PostgreSQL (UTF-8).
2. **Environment**: set `DATABASE_URL`, a strong `SESSION_SECRET` and `APP_URL` (https).
3. **Migrate**: run `npm run db:deploy` against the database. Run `npm run db:seed` once to create the
   first owner account, then change its password under Users.
4. **Build and start**: `npm run build`, then `npm start` behind HTTPS, or let the host run the build.
5. **On every release** that adds a migration, run `npm run db:deploy` before or with the deploy.

### Serverless hosts and connection pooling

Each serverless instance keeps its own small connection pool. On Supabase:

- Point the app's `DATABASE_URL` at the **transaction pooler** (port 6543).
- Run migrations through the **session pooler** or a direct connection (port 5432); `prisma migrate`
  does not work through the transaction pooler.
- Keep instances × `DB_POOL_MAX` below the pooler's client limit.

### Backups

The database is the only place stock history, bills and employee documents live. Schedule regular
backups and test a restore.

## Security

- Passwords are stored only as Argon2id hashes.
- Sessions are a signed (HS256) HttpOnly cookie, `SameSite=Lax`, `Secure` over https, valid for 7 days.
  Every request re-checks the user in the database, so disabling an account takes effect at once.
- Authorisation is checked on the server in every action, page and file route. Hidden buttons are a
  convenience, not a control.
- All input is validated with Zod on the server.
- Employee documents are stored in the database and served through an owner-only route.
- Important actions are written to the audit log, visible to the owner in Settings.

To report a security issue, contact the repository owner privately instead of opening a public issue.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm run db:start` fails after a crash | Delete the stale `data/db/postmaster.pid` and start again |
| A new table or column is "missing" in the running app | Restart `npm run dev` after `prisma generate`; the dev server caches the old client |
| `prisma migrate dev` hangs | `DATABASE_URL` points at a transaction pooler. Use the local database or a session/direct connection |
| `npm ci` fails with `EPERM` on Windows | Another Node process (dev server, editor) is holding a native module. Stop it, or use `npm install` |
| Camera scanning does not start | Browsers allow camera access only on HTTPS or `localhost` |
| A second `next dev` refuses to start | Next.js allows one dev server per folder. Use `npm run build` and `npx next start -p 3001` for a second instance |

## Roadmap

Not in the current version: suppliers, GST invoices, returns and refunds, a customer list with visit
history, appointments, multiple branches, per-employee sales, a configurable shop logo, and WhatsApp
receipt sharing.

## License

No open-source license has been chosen. This is a private project; all rights are reserved by the
repository owner.
