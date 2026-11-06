# MANI TRADERS

Business ledger for a trading shop: digital khata for customers and suppliers, GST billing, inventory, payments, expenses, WhatsApp reminders and reports.

**Live:** https://mani-traders-three.vercel.app (Vercel team `trade-813f`). Every push to `main` deploys automatically.

---

## Features

| Area | What you can do |
|---|---|
| **Khata / ledger** | Per-customer and per-supplier khata with a running balance. Record *You gave* (goods/credit) and *You got* (payments), adjustments and opening balances. Mistakes are corrected with reversal entries, so nothing is ever overwritten or deleted. |
| **Sales** | Cash, credit and partial-payment invoices. Barcode/SKU search, line discounts, GST (CGST+SGST or IGST), sales returns (credit notes), and invoice cancellation with a full audit trail. |
| **Purchases** | Supplier bills with GST. Stock goes in at landed cost, and the supplier's payable is updated. |
| **Inventory** | Products, stock in/out/count adjustments, moving-average cost, low-stock alerts, stock movement history. Negative stock is blocked unless authorised. |
| **Payments** | Receive or make payments (Cash, UPI, Bank, Cheque, Other), link them to invoices, settle in full or in part. Receipts are numbered per financial year. Duplicate submissions are blocked. |
| **Expenses** | Rent, electricity, transport, salary, maintenance, purchases and miscellaneous, with receipt upload. Expenses are kept separate from customer balances. |
| **Documents** | PDF tax invoice / bill of supply, payment receipts and statements. Print, download, or share on WhatsApp. |
| **WhatsApp** | Reminders, payment confirmations, statements, invoices, receipts and monthly summaries. Uses the WhatsApp Business Cloud API (approved templates, PDF attachments, delivery status) or manual share. |
| **Reports** | 16 reports: daily/monthly/yearly sales, product-wise sales, outstanding, payables, statements, collections, expenses, profit estimate, cash flow, GST summary, inventory valuation, stock movement, and trial balance with integrity checks. Export to PDF, Excel or CSV. |
| **Dashboard** | Receivables, payables, sales, collections, expenses, overdue credit, inventory value, net cash flow, charts, top/overdue customers, low stock. |
| **Access control** | Owner, Admin and Employee roles, with a permission editor. Employees can be limited to the customers assigned to them. Audit log of every change. |
| **Cash & bank** | Opening balances, owner's capital and drawings, and transfers between cash, bank and UPI. |

Formats: INR (₹), Indian digit grouping (₹12,34,567.00), DD-MM-YYYY, Asia/Kolkata time.

---

## First use (production)

1. Open the live URL. The first visit opens **Set up your business**. Create the **owner** account straight away; until an owner exists, anyone who opens the site can complete setup.
2. In **Settings → Business**, add your address, state and phone.
3. In **Settings → GST & tax**, choose whether you are GST registered (Regular or Composition). If you aren't registered, the app issues bills of supply with no tax.
4. In **Settings → Cash & bank**, enter your opening cash and bank balances.
5. Add products (Inventory), customers, and their opening balances from your old khata book.
6. In **Employees**, add staff. Each gets a temporary password and must change it at first sign-in.

---

## How the accounting works (for maintainers)

- **Double-entry.** Every financial event creates exactly one balanced `journal_entry`. The database enforces this: a deferred constraint trigger rejects any entry whose debits ≠ credits, and triggers block `UPDATE`/`DELETE` on journal lines, khata rows, payments and the audit log.
- **Sub-ledgers.** Customer and supplier balances are journal lines on Accounts Receivable (1100) and Accounts Payable (2000), tagged with the party. `ledger_transactions` is the human-readable khata row that mirrors each entry. The *Trial balance & integrity* report checks that debits equal credits and that every party's khata equals its control-account balance.
- **Exact money.** Amounts are `numeric(14,2)` in the database and integer paise in code (BigInt for multiplication). Floating point is never used for money.
- **Revenue ≠ collections.** Sales revenue comes from the Sales account (excl. GST). Collections are payments received. Profit estimate is revenue − cost of goods sold − expenses. Cash flow is the change in the cash, bank and UPI accounts.
- **Server is authoritative.** Totals, GST and balances are always recomputed on the server; browser previews are display-only.

Chart of accounts: `src/lib/accounts.ts`. Posting rules: `src/server/core.ts` and `src/server/services/*`.

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Radix UI · Lucide · Recharts · Drizzle ORM · PostgreSQL (Neon) · Zod · pdfkit · ExcelJS · Vercel Blob.

```
src/
  app/(auth)/        login, setup, forgot/reset password
  app/(app)/         all business screens
  app/_actions/      server actions (auth + permission check → service)
  app/api/           PDFs, report exports, files, search, WhatsApp webhook, cron, health
  components/        UI kit, shell, forms, bill editor, ledger, charts
  lib/               money, GST, dates, validators, permissions, accounts (shared client/server)
  server/
    db/              schema, client (Postgres or embedded PGlite), migrations runner, seed
    auth/            password hashing, sessions, rate limiting
    services/        parties, khata, payments, sales, purchases, inventory, expenses,
                     reports, notifications, whatsapp, cashbook, jobs, admin, search
    core.ts          posting engine, numbering, audit, permissions
    pdf.ts           invoice/receipt/statement/report PDFs
drizzle/             SQL migrations (incl. ledger-integrity triggers)
tests/               unit + ledger integration tests, Playwright E2E smoke test
```

---

## Local development

Requirements: Node.js 20+ (tested on 24). No database install is needed: locally the app uses **PGlite**, a real PostgreSQL engine embedded in Node, stored in `./data/pglite`.

```bash
npm install
cp .env.example .env      # leave DATABASE_URL empty for the embedded database
npm run dev               # http://localhost:3000 → first visit opens owner setup
```

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server (applies migrations automatically) |
| `npm test` | Unit + ledger integration tests (in-memory PostgreSQL) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (stop `dev` first when using the embedded DB) |
| `npm run db:backup` | Back up the local database to `./backups` |

End-to-end test (needs a fresh database and Chrome):

```bash
PGLITE_DIR=./data/e2e npm run dev        # in one terminal
node tests/e2e/smoke.mjs                 # in another; screenshots go to ./e2e-out
```

---

## Deploying to Vercel

The project is already set up. To recreate it elsewhere:

1. **Import** the GitHub repo in Vercel (framework: Next.js; defaults are fine).
2. **Storage → Neon Postgres** (Marketplace): connect it to the project. This sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. Migrations run automatically on first request over the direct connection, guarded by an advisory lock.
3. **Storage → Blob**: create a **private** store and connect it. This sets `BLOB_READ_WRITE_TOKEN`. Uploads and generated PDFs are stored there and served only to signed-in users.
4. **Environment variables:** add `CRON_SECRET` (a long random string). Optionally add `APP_URL` (defaults to the production domain), the WhatsApp variables, and `SMTP_URL`/`SMTP_FROM` for reset emails.
5. Deploy. `vercel.json` schedules the daily job (`/api/cron/daily`, 06:00 IST), which sends overdue alerts and the daily summary.

> **Plan note:** Vercel's Hobby plan is for non-commercial use. For a business, use Vercel Pro.

### Backups & recovery

- **Neon** keeps continuous backups with point-in-time restore. Use the Neon console (Vercel → Storage → your database → *Open in Neon*) to restore or branch to any moment within the retention window.
- For your own off-site copy, run `pg_dump "$DATABASE_URL_UNPOOLED" -Fc -f mani-traders.dump` regularly. Restore with `pg_restore --clean --no-owner -d "$DATABASE_URL_UNPOOLED" mani-traders.dump`.
- Uploaded files live in the Vercel Blob store.

### WhatsApp Business Cloud API (optional)

1. In Meta for Developers, create an app with WhatsApp, and get a permanent access token and the phone number ID.
2. Set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (any random string) and `WHATSAPP_APP_SECRET` in Vercel, then redeploy.
3. In Meta, set the webhook URL to `https://<your-domain>/api/whatsapp/webhook` with the same verify token, and subscribe to `messages`.
4. Get message templates approved (the parameters for each type are listed in **Settings → WhatsApp**), enter their names there, and switch the mode to *WhatsApp Business API*.

Without the API, **Open WhatsApp** pre-fills the message (and on phones, shares the PDF). These are logged as *opened*, never as *delivered*.

---

## Security

- Passwords hashed with scrypt. Session tokens are random, stored only as SHA-256 hashes, in httpOnly SameSite cookies, with sliding expiry (`SESSION_TTL_HOURS`).
- Login rate limiting, plus account lockout after 5 failed attempts. Password reset uses single-use 30-minute tokens.
- Authorisation is checked on the server in every action, route and query, including customer visibility scoping for employees.
- Zod validation on all inputs. Parameterised SQL via Drizzle. Server Actions have built-in origin checks against CSRF.
- Uploads are restricted by checking file contents (JPG/PNG/WEBP/PDF, max 5 MB) and are served only to signed-in users.
- WhatsApp webhooks are verified with `X-Hub-Signature-256`. The cron endpoint requires `CRON_SECRET`.
- Secrets live only in environment variables. The audit log is append-only.
