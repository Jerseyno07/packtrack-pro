# PackTrack Pro

End-to-end packaging material inventory system for Ninjacart's fulfilment centre (FC) and collection centre (CC) network. Tracks stock from vendor purchase order through GRN inward, PM Store dispatch, FC/CC receipt, and daily consumption against packaged SKUs — with a full audit trail at every step.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Apps](#apps)
- [Key Workflows](#key-workflows)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Database](#database)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [User Roles](#user-roles)
- [Consumption Scraper](#consumption-scraper)
- [Slack Reports](#slack-reports)
- [PWA Install](#pwa-install)

---

## Overview

Packaging materials (LDPE covers, barcode labels, wax ribbons, cling wrap, net rolls, etc.) flow through a multi-step supply chain:

```
Vendor → PM Store (GRN Inward) → FC / CC Facility (Dispatch + Receipt) → Daily Consumption
```

PackTrack Pro gives each actor in this chain a purpose-built interface:

| Actor | App | URL |
|---|---|---|
| Admin / Supply Chain Team | Admin Portal | `/` |
| PM Store Executive | PM Store Ops | `/ops` |
| FC / CC Executive | Stock Receipt App | `/receipt` |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│               Railway (single service)       │
│                                              │
│  ┌──────────────────┐  ┌──────────────────┐ │
│  │  Express API     │  │  Vite SPA (dist) │ │
│  │  server/index.js │  │  served as static │ │
│  │  :3000           │◄─┤  from /frontend/ │ │
│  └────────┬─────────┘  └──────────────────┘ │
│           │                                  │
│  ┌────────▼─────────┐                        │
│  │  node-cron jobs  │                        │
│  │  Consumption     │                        │
│  │  Slack Reports   │                        │
│  └──────────────────┘                        │
└──────────────────────┬──────────────────────┘
                       │ pg (SSL)
              ┌────────▼────────┐
              │   Neon Postgres  │
              │   (serverless)   │
              └─────────────────┘
```

The frontend is a single React SPA. React Router serves three distinct apps from three URL paths — no separate deployments needed.

---

## Apps

### Admin Portal (`/`)

Full visibility and control over the entire supply chain.

- **Dashboard**: current stock across all warehouses, low-stock alerts
- **PO Management**: upload vendor POs via CSV, track inward progress, cancel or reverse-force-complete
- **Indent Management**: upload FC/CC indent requests via CSV, monitor fulfilment status
- **SKU Master**: upload FSN → packaging material mapping (primary, secondary, tertiary); upsert on conflict
- **Min Stock Levels**: set per-facility low-stock thresholds per material; inline editable grid
- **Consumption History**: date-range filtered view of daily material consumption per facility; CSV export
- **Current Stock**: live on-hand balances across all warehouses; facility + material filters; CSV export
- **Consumption Runs**: trigger manual scraper runs per facility, monitor progress, review deductions before committing, accept or discard
- **Users**: view all accounts, reset passwords
- **Audit Log**: full system action trail

### PM Store Ops (`/ops`) — Mobile PWA

Used by PM Store executives on the warehouse floor to process inbound and outbound stock.

- **GRN (Post GRN)**: select an open PO, enter received qty and date, attach invoice image, post to ledger. Supports partial inward — PO stays open for follow-up deliveries. Force Complete available to close short.
- **Issue Against Indent**: select a pending indent, see expected qty and live on-hand stock at both PM Store and destination facility, confirm dispatch qty and vehicle number.
- **Store Stock**: real-time on-hand balance at the PM Store.
- **Audit**: physical stock count with per-line system vs physical comparison, mandatory remark on discrepancy, confirmation modal before submit.

### Stock Receipt App (`/receipt`) — Mobile PWA

Used by FC / CC executives to acknowledge incoming stock, view consumption history, and run audits.

- **Receive**: list of pending dispatches from PM Store; enter received qty; Confirm Receipt (exact match) or Force Complete with reason (short delivery).
- **My Stock**: current on-hand balance at their facility.
- **Consumption**: last 7 days of material consumption at their facility, grouped by date.
- **Audit**: same physical count workflow as PM Store Ops.

---

## Key Workflows

### GRN Inward
1. Admin uploads vendor PO via CSV → creates `purchase_orders` rows.
2. PM Store exec opens `/ops`, selects the PO line, enters received qty.
3. System posts a `goods_receipts` record and a `GRN_INWARD` entry to `stock_ledger`.
4. PO status transitions: `OPEN` → `PARTIALLY_RECEIVED` → `CLOSED`.

### Stock Issue (Dispatch)
1. Admin uploads indent CSV → creates `indent_lines` rows.
2. PM Store exec selects indent line, confirms dispatch qty.
3. System posts `stock_issues` + `ISSUE_OUT` ledger entry.
4. Indent status transitions: `PENDING` → `PARTIALLY_ISSUED` → `FULLY_ISSUED`.

### Stock Receipt (Acknowledgement)
1. FC/CC exec sees dispatch in `/receipt`, enters qty received.
2. System posts `stock_receipts` + `RECEIPT_IN` ledger entry (and `RECEIPT_SHORTAGE_WRITE_OFF` if short).
3. Issue status transitions: `DISPATCHED` → `PARTIALLY_RECEIVED` → `RECEIVED`.

### Daily Consumption
1. Admin triggers a run for a facility (or all facilities).
2. Scraper fetches the previous day's packaged qty from Redash (FC and CC queries, configured via env vars) via streaming CSV.
3. Each SKU is looked up in `sku_packaging_master` → primary/secondary/tertiary PM codes.
4. Deductions computed: `packaged_qty × meters_per_unit` for roll materials; `packaged_qty × 1` for barcode labels and wax ribbon.
5. All deductions stored as `PENDING` lines in `consumption_run_lines`.
6. Admin reviews in a modal (material, qty, current stock, balance after) and either **Accept** (commits to ledger) or **Discard**.

### Audit
1. Exec counts physical stock and enters qty per material line.
2. Any line where physical ≠ system qty requires a typed remark.
3. Confirmation modal lists all discrepancies before final submit.
4. System posts `AUDIT_ADJUSTMENT` ledger entries to reconcile.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | Node.js 18+ · Express 4 |
| Auth | JWT (Bearer token) · bcrypt password hashing |
| Database | PostgreSQL (Neon serverless) · `pg` driver |
| Input validation | Zod |
| File uploads | multer · xlsx · csv-parse (streaming) |
| Scheduled jobs | node-cron |
| Frontend | React 18 · React Router 6 · Vite 5 |
| Styling | Tailwind CSS 3 |
| Icons | lucide-react |
| Deployment | Railway (single service — API + static frontend) |

---

## Repository Structure

```
packtrack-pro/
├── server/
│   ├── index.js              # Express app — all API routes
│   ├── cron/
│   │   ├── consumptionScraper.js   # Redash scraper + ledger logic
│   │   └── slackReports.js         # Slack report crons (disabled by default)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── index.html            # Single HTML entry point + PWA meta tags
│   ├── main.jsx              # React Router — mounts all three apps
│   ├── portal.jsx            # Admin Portal (/)
│   ├── pmstore-ops.jsx       # PM Store Ops (/ops)
│   ├── receipt-app.jsx       # Stock Receipt App (/receipt)
│   ├── AuditScreen.jsx       # Shared audit component
│   ├── TourOverlay.jsx       # Shared guided tour component
│   └── public/
│       ├── manifest.json     # PWA manifest
│       ├── sw.js             # Service worker (offline splash)
│       ├── offline.html      # Offline splash page
│       └── icon.svg          # App icon
├── db/
│   ├── 001_schema.sql        # Base schema
│   ├── 002_*.sql … 015_*.sql # Incremental migrations
│   └── data-patch-*.sql      # One-off data corrections
├── docs/
│   ├── db-schema.md          # Full database schema reference
│   ├── ui-guide.md           # UI walkthrough
│   ├── test-cases.md         # 115 test scenarios
│   ├── roadmap.md            # Feature backlog
│   └── issue-log.md          # Bug tracker
├── package.json              # Root — build + start scripts
└── railway.toml              # Railway deployment config
```

---

## Database

PostgreSQL on [Neon](https://neon.tech) (serverless). Schema is managed via numbered SQL migration files in `db/`.

### Core tables

| Table | Purpose |
|---|---|
| `users` / `sessions` | Auth |
| `warehouses` / `user_warehouses` | Facilities and user assignments |
| `materials` | Packaging material master (code, name, unit, `meters_per_unit`, `stickers_per_roll`) |
| `purchase_orders` / `goods_receipts` | Vendor inward chain |
| `indent_lines` / `stock_issues` / `stock_receipts` | FC/CC dispatch chain |
| `stock_ledger` | Append-only ledger of every movement |
| `sku_packaging_master` | FSN → primary/secondary/tertiary PM mapping |
| `consumption_runs` / `consumption_run_lines` | Scraper execution and deduction detail |
| `audit_entries` / `audit_entry_lines` | Physical stock count records |
| `min_stock_levels` | Per-facility low-stock thresholds |
| `audit_log` / `admin_reversals` | System audit trail |

### Views

| View | Purpose |
|---|---|
| `v_current_stock` | Live on-hand balance per warehouse × material |
| `v_po_schedule` | Open PO lines with remaining qty |
| `v_indent_to_process` | Pending indent lines with PM Store on-hand |
| `v_low_stock_alerts` | Materials below minimum threshold |

### Applying migrations

Migrations are plain SQL files. Run them in order against your Neon database:

```bash
psql $DATABASE_URL -f db/001_schema.sql
psql $DATABASE_URL -f db/002_force_complete_expected_actual.sql
# ... and so on
```

---

## Environment Variables

Create `server/.env` (see `server/.env.example`):

```env
# Required
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# Optional
PORT=3000                              # API port (default 3000)
FRONTEND_ORIGIN=http://localhost:5173  # CORS allowed origin

# Slack integrations (leave unset to disable)
SLACK_ERROR_WEBHOOK=https://hooks.slack.com/...   # 500 error alerts
SLACK_REPORTS_WEBHOOK=https://hooks.slack.com/... # Daily reports to #packtrack-reports

# Redash (required for consumption scraper)
REDASH_API_KEY=your_redash_key
REDASH_FC_QUERY_ID=your_fc_query_id
REDASH_CC_QUERY_ID=your_cc_query_id

# Flash integration (leave unset to disable, see "External Integrations" below)
FLASH_OUTBOUND_URL=https://flash.example.com/api/...
FLASH_OUTBOUND_API_KEY=your_flash_key
```

---

## Local Development

**Prerequisites:** Node.js 18+, a Postgres database (Neon free tier works).

```bash
# 1. Clone
git clone https://github.com/Jerseyno07/packtrack-pro.git
cd packtrack-pro

# 2. Set up server env
cp server/.env.example server/.env
# Edit server/.env with your DATABASE_URL

# 3. Apply migrations
psql $DATABASE_URL -f db/001_schema.sql
# ... repeat for 002 through 015

# 4. Install and start the API
cd server && npm install && npm run dev
# API runs at http://localhost:3000

# 5. In a new terminal — install and start the frontend
cd frontend && npm install && npm run dev
# Frontend runs at http://localhost:5173
```

The Vite dev server proxies `/api/*` to `localhost:3000` automatically (configured in `vite.config.js`).

---

## Deployment

Deployed on [Railway](https://railway.app) as a single service.

**Build command** (`railway.toml`):
```bash
npm run build && cd server && npm install
```
This runs `frontend/` Vite build (outputs to `frontend/dist/`), then installs server dependencies.

**Start command:**
```bash
npm start   # → cd server && node index.js
```

The Express server serves the built frontend from `../frontend/dist` as static files, and mounts all API routes under `/api/v1/`.

**Railway environment variables to set:**
- `DATABASE_URL`
- `JWT_SECRET`
- `SLACK_ERROR_WEBHOOK` (optional)
- `SLACK_REPORTS_WEBHOOK` (optional)
- `REDASH_API_KEY`, `REDASH_FC_QUERY_ID`, `REDASH_CC_QUERY_ID`
- `FLASH_OUTBOUND_URL`, `FLASH_OUTBOUND_API_KEY` (optional — required only for the Flash integration below)

---

## External Integrations

### Flash — SKU-GRN receiving blocker (push model)

A separate internal app, "Flash," does SKU-level GRN at CC/FC facilities and needs to know whether a facility still has un-received packaging-material dispatches from PM Store before allowing a GRN. Rather than Flash calling PackTrack synchronously on every SKU-GRN attempt (rejected — too much request volume for a real-time check), PackTrack pushes a notification to Flash only when a facility transitions to fully clear, and Flash caches that state on their own side.

**Trigger:** whenever `POST /api/v1/stock-receipts` or `POST /api/v1/stock-issues/:id/force-complete` closes out what turns out to be the last open dispatch (`stock_issues.status IN ('DISPATCHED','PARTIALLY_RECEIVED')`) to a facility, `checkAndNotifyFlashIfFacilityClear()` (`server/index.js`) fires an outbound call to `FLASH_OUTBOUND_URL` with `{ facility_code, cleared_at }`.

**Status: placeholder.** Flash's actual endpoint URL, payload shape, and auth header are not yet defined — `FLASH_OUTBOUND_URL`/`FLASH_OUTBOUND_API_KEY` are wired up and the trigger point is live, but the call is a no-op until `FLASH_OUTBOUND_URL` is set. Update the request in `notifyFlashFacilityCleared()` once Flash shares their API contract.

---

## User Roles

| Role | Access |
|---|---|
| `ADMIN` | Full access — admin portal, all APIs |
| `PM_STORE_EXEC` | PM Store Ops app — GRN, issue, stock, audit |
| `FC_EXEC` | Stock Receipt App — receive, stock, consumption, audit |
| `CC_EXEC` | Stock Receipt App — same as FC_EXEC |
| `FC_DP` / `CC_DP` | Read-only consumption and stock views |

Users are assigned to one or more warehouses via `user_warehouses`. Stock and audit views are automatically scoped to the user's assigned facility.

---

## Consumption Scraper

`server/cron/consumptionScraper.js`

Fetches the previous day's packaged quantity from Redash (streaming CSV to handle large payloads), maps each FSN to its packaging materials via `sku_packaging_master`, and computes material deductions.

**Special handling:**
- **Meters**: roll materials with `meters_per_unit` set — deduction = `packaged_qty × meters_per_unit`
- **Stickers**: `BCRL-SML` (1000/roll), `BCRL-BIG` (5000/roll), `WXRB-BLK` (5000/roll) — 1 label and 1 wax ribbon print per unit packed; auto-splits across BCRL-SML and BCRL-BIG based on available stock
- **Dedup**: rows are deduplicated on `(facility_id, sku_code, qty)` before processing to guard against dual-mapped FSN codes in Redash output

All deductions are written as `PENDING` lines; the admin reviews and accepts (or discards) via the consumption run modal before anything touches the live ledger.

Runs are triggered manually from the admin portal. An automatic midnight cron (`00:00 IST`) is wired in `slackReports.js` to support the daily Slack report but is currently disabled.

---

## Slack Reports

`server/cron/slackReports.js`

Three reports are ready to activate — uncomment the `cron.schedule` blocks to enable:

| Report | Schedule (IST) | Content |
|---|---|---|
| FC Dispatch → CC GRN | 17:00 daily | Today's stock issues vs receipts grouped by CC facility |
| Daily Consumption Details | 00:15 daily | Previous day's material consumption per facility (preceded by auto-run + auto-accept at 00:00) |
| CC Balance vs Audit | TBD | Current stock vs latest physical audit snapshot, delta per material |

All reports post to `#packtrack-reports` via `SLACK_REPORTS_WEBHOOK`. Messages are chunked to stay within Slack's 4,000-character block limit.

---

## PWA Install

Both `/ops` and `/receipt` are installable as Progressive Web Apps.

- **Android (Chrome)**: tap the "Add to Home Screen" prompt or use the browser menu
- **iOS (Safari)**: Share → Add to Home Screen

Once installed, the app opens in standalone mode (no browser chrome). If the device goes offline, a branded splash screen is shown with a Retry button. All data operations require an active connection — there is no offline data sync.
