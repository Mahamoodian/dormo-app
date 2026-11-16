# BedFlow — Multi-tenant Dormitory & Bed Revenue Management

Mobile-first web app for bed-space / dormitory operators. A Super Admin onboards independent
business owners; each owner manages their own buildings, beds, clients, rent collection,
vacating and expenses in a fully isolated data silo.

**Stack:** React 18 + Vite + Tailwind CSS · Node.js + Express · PostgreSQL 13+ · JWT auth

---

## Quick start

### Option A — Docker (recommended for production)
```bash
cp .env.example .env          # set JWT_SECRET, DB_PASSWORD, SUPERADMIN_* values
docker compose up -d --build
# open http://localhost:8080 and sign in with SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
```
The API container runs migrations and creates the super admin on start (both idempotent).
Put a TLS-terminating proxy (Caddy, Cloudflare, ALB…) in front of port 8080.

### Option B — Local development
```bash
# 1. API
cd server
cp .env.example .env          # point DATABASE_URL at your Postgres
npm install
npm run db:migrate            # creates tables + pre-defined expense categories
npm run db:seed               # creates the super admin from .env
npm run db:demo               # optional: demo owner  demo@bedflow.local / Demo12345
npm run dev                   # http://localhost:4000

# 2. Web
cd ../web
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

### Tests
```bash
cd server
DATABASE_URL=postgres://user:pass@localhost:5432/bedflow_test npm test   # ⚠ wipes that DB
```
12 end-to-end tests cover the forced password change, tenant isolation (API and database
level), overdue generation, partial collection, write-off, payment reversal, advance payment,
pro-rata vacate with deposit deductions and refund, custom settlement, expenses, reports, and
disable/reset session revocation.

---

## Project structure
```
bedflow/
├── docker-compose.yml
├── server/
│   ├── src/
│   │   ├── index.js              # boot + hourly rent-period job
│   │   ├── app.js                # express app, route mounting, guards
│   │   ├── config.js
│   │   ├── db/
│   │   │   ├── schema.sql        # full schema (idempotent)
│   │   │   ├── pool.js           # pg pool + tx() helper
│   │   │   ├── migrate.js · seed.js · demo.js
│   │   ├── middleware/           # auth (JWT + live user check), validation (zod), errors
│   │   ├── services/
│   │   │   ├── rentEngine.js     # period billing, allocation, write-offs, deposit ledger
│   │   │   └── vacate.js         # vacate preview + settlement
│   │   ├── routes/               # auth, admin, properties, clients, assignments,
│   │   │                         # receivables (+payments), expenses, dashboard
│   │   └── utils/                # dates (UTC string math), money, password, http
│   └── test/flow.test.js
└── web/
    └── src/
        ├── api/client.js · context/AuthContext.jsx · lib/format.js
        ├── components/           # Layout (sidebar + mobile bottom nav), ui kit,
        │                         # AssignModal, CollectModal, VacateModal, Toast, icons
        └── pages/
            ├── auth/             # Login, forced ChangePassword, Account
            ├── admin/            # AdminReports, AdminUsers, AdminUserView (read-only)
            └── owner/            # Dashboard, Beds, Properties, Clients, ClientDetail,
                                  # Receivables, Expenses
```

---

## Database schema (PostgreSQL)

| Table | Purpose |
|---|---|
| `users` | Super admins and business owners. `must_change_password`, `is_active`, `token_version` (bumped on reset/disable to kill sessions), `currency` |
| `admin_audit` | Log of every admin action (create, reset, enable/disable, view) |
| `buildings → flats → areas → beds` | Property hierarchy. `flats.kind` = flat / dormitory; `beds.in_service=false` = maintenance |
| `clients` | Client register (master directory per owner) |
| `assignments` | A tenancy: client ↔ bed, rent amount, frequency (`day/week/month × count`), deposit, `current_period_end` (the expiry date), status, vacate summary |
| `receivables` | Every amount owed: `rent` periods, `deposit`, `settlement`. Tracks `amount_due / amount_paid / amount_written_off`, status `open/paid/written_off/void` |
| `payments` | Each collection, applied to a receivable (method, date, note) |
| `write_offs` | Each write-off with reason |
| `deposit_ledger` | Deposit liability: `collected`, `refunded`, `converted_to_revenue`, `applied_to_dues` |
| `expense_categories` | Built-in (owner_id NULL) + owner-defined custom categories |
| `expenses` | Expenses recorded against a flat/dormitory |

**Tenant isolation is enforced by the database itself:** every operational table carries
`owner_id`, and every relation uses a composite foreign key `(parent_id, owner_id) →
parent(id, owner_id)`. A row physically cannot reference another owner's building, bed or
client. The API also scopes every query by `owner_id`. Partial unique indexes guarantee one
active tenancy per bed and per client.

---

## How the money logic works

**Assignment.** Creates the first rent period `start → expiry` (expiry defaults to one
frequency period but can be any custom date, with an optional custom first-period amount)
plus a deposit receivable. Prepaid amounts are applied immediately (the default, since most
tenants pay upfront). Back-dated entries automatically bill any periods that already started.

**Billing and overdue.** When `today > current_period_end`, the next period
(`expiry + 1 → +1 frequency`) is billed as a rent receivable due on its first day. Billing
runs before every owner request and in an hourly background job. An unpaid receivable whose
due date has arrived shows as **Overdue** on the Receivables page, the bed board, the
dashboard and the client file. The business "today" uses `APP_TIMEZONE`.

**Collection.** Type an amount and press **Enter**.
- Less than the balance: the rest stays open in the register.
- Exactly the balance: settled.
- More than the balance: the extra pays the tenant's older dues, then pre-pays future periods.

Mistaken entries can be reversed from the client file. **W/O** writes off part or all of a
balance, with a reason.

**Vacate.**
1. Pick the date. The preview runs the real calculation inside a transaction that is rolled
   back, so it has no side effects.
2. If the client stayed past the paid expiry, choose **pro-rata** (`period rent × days used /
   period days`), **full period**, **custom** (any amount, less or more than due) or **waive**.
3. Unbilled future periods and any uncollected deposit are cancelled.
4. Deposit: add deductions (Cleaning, Damages… these become revenue), optionally use the
   deposit to settle dues, and the rest is refunded. That covers full refund, partial refund
   and full conversion.
5. Collect cash now, then either write off the remainder or leave it in Receivables.

---

## API reference (all under `/api`)

**Auth**: `POST /auth/login` · `GET /auth/me` · `POST /auth/change-password`

**Super admin** (`role=super_admin`):
`GET /admin/reports` · `GET|POST /admin/users` · `PATCH /admin/users/:id` ·
`POST /admin/users/:id/reset-password` · `PATCH /admin/users/:id/status` ·
`GET /admin/users/:id/view` (read-only) · `GET /admin/audit`

There are deliberately **no** admin routes that write a tenant's operational data. Owner
routes reject the super admin role with 403.

**Owner** (tenant-scoped):
- Properties: `GET /properties/tree` · `GET /properties/flats` ·
  `POST|PATCH|DELETE /properties/{buildings|flats|areas|beds}[/:id]` (beds support `count` for bulk)
- Clients: `GET|POST /clients` · `GET|PATCH|DELETE /clients/:id`
- Tenancies: `POST /assignments` · `GET|PATCH /assignments/:id` (rent terms, expiry, bed transfer) ·
  `POST /assignments/:id/collect` · `POST /assignments/:id/vacate/preview` · `POST /assignments/:id/vacate`
- Receivables: `GET /receivables?tab=due|upcoming|open|closed&q=` · `GET /receivables/summary` ·
  `POST /receivables/:id/collect` · `POST /receivables/:id/write-off`
- Payments: `GET /payments?from&to` · `DELETE /payments/:id` (reverse)
- Expenses: `GET /expenses?month&flat_id&category_id` · `POST|PATCH|DELETE /expenses[/:id]` ·
  `GET|POST|DELETE /expenses/categories[/:id]`
- Dashboard: `GET /dashboard?month=YYYY-MM`

---

## Security notes
- bcrypt (cost 12) password hashes. Admin-generated temporary passwords are shown once.
  Users are forced to change them, and every API returns `403 PASSWORD_CHANGE_REQUIRED`
  until they do.
- The JWT is re-validated against the database on every request, so disabling an account or
  resetting its password takes effect immediately.
- Login rate limiting, helmet headers, CORS allow-list, zod validation on every input, and
  parameterised SQL only.
- In production, set a 32+ character `JWT_SECRET` (enforced at boot) and serve over HTTPS.
