# Product Ideas & Roadmap — PackTrack Pro

Brain dump of enhancement ideas, ranked by urgency. Not a sprint plan — just a place to capture what's worth building next.

---

## Need to Have

These fill real operational gaps. Either already breaking things or blocking adoption.

### ERR-01 — Autonomous Error Monitoring (Slack + Auto-Fixer)
When a 500 hits, no one knows unless a user complains. Two-phase fix:
- **Slack alert** — Done (2026-07-29): fire-and-forget `fetch()` in the global error handler → instant notification in a dedicated channel
- **In-DB capture** (partly done): write every error to `server_errors` table; admin portal "Server Errors" tab with status badges and stack trace viewer
- **CronCreate auto-fixer**: durable cron job fires every 15 min, diagnoses root cause from stack trace, applies fix, commits + pushes to main (Railway auto-deploys), marks error `FIXED` with commit SHA

**Auto-fixer deployment options (needs decision):**
- CronCreate on laptop — only works when laptop + Claude Code are running (rejected)
- CronCreate on always-on server — spin up a cheap VPS (Oracle Cloud free tier, or Hetzner ~€3.50/mo), install Claude Code CLI, `claude auth login`, clone repo, run inside a `tmux` session. Cron fires 24/7 regardless of laptop state. Server only runs Claude Code — Railway still handles the actual app.
- GitHub Actions scheduler — runs on GitHub's cloud every 15 min, calls Claude API with error + stack trace, commits fix, pushes to main. Requires `ANTHROPIC_API_KEY` stored as a GitHub Actions secret (encrypted, never visible in logs).
- Railway-native cron (simplest, no extra infra) — `node-cron` inside the existing Railway service, calls `@anthropic-ai/sdk` every 15 min, reads OPEN rows from `server_errors` table, sends error + stack trace + source file content to Claude Sonnet, writes fix back to disk, `git commit + push` via `GITHUB_TOKEN` env var, Railway auto-redeploys. Cost: ~$1.50–$3/month (Sonnet) or ~$0.50/month (Haiku). Needs `ANTHROPIC_API_KEY` + `GITHUB_TOKEN` (PAT, repo write scope) added to Railway.

**Effort:** DB capture + admin tab ~2 hrs; auto-fixer ~1 hr once deployment option is decided

### LDPE-01 — Kg Conversion for LDPE Pouches/Bags
Ground team can't practically count individual LDPE pieces — vendor delivery, PM Store dispatch, and CC/FC receipt are all done by weighing. Indent stays in pieces (that's how planning works and how consumption is deducted); PO/GRN, Issue Against Indent, and Receipt screens take Kg and convert to pieces for storage; CC/FC current stock and PM Store stock stay in pieces; Audit shows both.
- Extends the existing `materials.pieces_per_kg` conversion (already used for butter paper) with a new per-material scope flag (`kg_display_scope`: `ALWAYS` vs `PHYSICAL`) so butter paper's current "Kg everywhere" behavior is untouched while LDPE gets the new scoped behavior.
- Full implementation plan: `~/Documents/ninjacart/PackTrack Pro/13 - LDPE Kg Conversion Plan.md`
- **Status:** Planned, not started
- **Effort:** Medium — new migration, new `PUT /api/v1/materials/:id` endpoint, ~9 backend query touches, new shared frontend conversion module + changes across 4 screen files

### FLASH-01 — SKU-GRN Receiving Blocker (Flash Integration)
Flash (separate internal app, does SKU-level GRN at CC/FC facilities) needs to block GRN if the facility hasn't finished receiving its packaging-material dispatches in PackTrack's `/receipt` app. Design pivoted from a pull model (Flash calls PackTrack synchronously per GRN attempt) to a **push model**: PackTrack notifies Flash only when a facility's receiving fully clears, and Flash caches that state on their side instead of calling out per attempt — avoids real-time latency at 1000s of GRNs/day.
- Full implementation plan: `~/Documents/ninjacart/PackTrack Pro/14 - Flash SKU-GRN Blocker Plan.md`
- **Status:** Code live (commits `4a53f7d`, `61d13cd`, `1be558d`) — `notifyFlashFacilityCleared()` matches Flash's confirmed API contract (`POST .../grnAllowed`, Basic auth, `{facilityId, deliveryDate, keyParam, valueParam}`), tested successfully against Flash's QA server. Remaining: set real `FLASH_OUTBOUND_URL`/`FLASH_OUTBOUND_USERNAME`/`FLASH_OUTBOUND_PASSWORD` in Railway, then one end-to-end test with the Flash team on production.
- **Effort:** Small — one outbound notify function, no schema changes

### ALERT-01 — Low Stock Alerts
Min stock levels are already configured per facility. We should fire an alert (Slack and/or email) when any material's running stock drops below its threshold after a consumption run is accepted.
- Trigger point: end of `acceptRun()` — compare new balance against `min_stock_levels`
- Alert payload: facility, material, current qty, min threshold, deficit
- **Effort:** ~2 hrs

### GRN-01 — OCR Invoice Pre-Fill + PDF Upload Fix
PM Store execs already attach one invoice per GRN (including partial GRNs — already works today). Two gaps found while scoping this:
- **Bug:** frontend advertises PDF invoice upload but backend `fileFilter` rejects anything non-`image/*` — PDF attach silently fails (`server/index.js:809-812`)
- **Feature:** let the exec upload just the invoice photo/PDF and have Claude's vision API pre-fill GRN fields (invoice no., date, etc. — kept configurable, field list undecided), fully editable before submit. No LLM integration exists in this codebase today — new capability, follows the existing R2 upload pattern rather than the legacy disk-storage path GRN images currently use
- Full plan: `~/.claude/plans/in-pm-store-ops-recursive-boot.md`
- **Effort:** ~1 day (R2 migration + PDF fix + new Anthropic API integration + frontend pre-fill UX)

### REPORT-01 — Export to CSV/Excel
Consumption History and Store Stock views have no download option. CC/FC managers copy-paste to WhatsApp or Excel manually.
- Add a download button to: Consumption History (admin + CC app), Store Stock tab (PM Store Ops), Audit Log
- Use `Papa.unparse()` or a simple CSV blob on the frontend — no backend change needed
- **Effort:** ~1 hr

---

## Good to Have

High-value features that would meaningfully improve day-to-day use but aren't blocking anything right now.

### VIZ-01 — Consumption Trend Charts
Right now consumption history is just a flat table. Seeing trends (which facility is consuming most, which materials spike week-on-week) would be far more useful for planning.
- Recharts or Chart.js bar chart in the admin Consumption History tab: X = date, Y = qty, grouped by material or facility
- Selectable aggregation: daily / weekly / monthly
- **Effort:** ~3 hrs

### ALERT-02 — Daily Consumption Summary Digest
Auto-generated daily summary pushed to a Slack channel each evening: total consumption per facility, any materials that went below min stock, and any runs that are still PENDING_REVIEW.
- Can reuse the CronCreate infrastructure from ERR-01
- **Effort:** ~2 hrs (after ERR-01 infra is in place)

### MOBILE-01 — Mobile-Friendly PWA for CC/FC Execs — Done (2026-07-31)
CC/FC execs work on phones on the warehouse floor. The receipt app is functional but not thumb-friendly — forms are small, buttons need zooming.
- Larger touch targets, sticky action buttons at bottom, simplified confirmation screens
- Add PWA manifest + service worker so it installs to home screen with offline splash
- **Shipped:** PWA manifest + service worker + offline splash; `text-base` inputs (prevents iOS zoom); `py-3`/`py-4` touch targets throughout; sticky bottom action bars on GRN and Receipt forms; full-width mobile tab bar on PM Store Ops; sticky header. Commit: `a61ff4c`
- **Effort:** ~4 hrs

### UX-01 — Inline Stock Balance on GRN Screen
When a PM Store exec posts a GRN, they can't see the current stock for that material in the same view. They have to switch to Store Stock tab.
- Show a small "Current stock: X units" inline on the GRN material row after PO selection
- **Effort:** ~1 hr

### OBS-01 — Sentry Integration
If Slack alerts from ERR-01 aren't enough, Sentry gives proper error grouping, fingerprinting, breadcrumbs, and source maps — the industry-standard error triage experience.
- `@sentry/node` + Express middleware wrapper; Sentry DSN via Railway env var
- Free tier: 100K events/month — more than sufficient
- **Effort:** ~2 hrs (alongside or instead of ERR-01 DB approach)

### CONS-02 — Multi-Date Consumption Run
Right now each run covers a single day (today). For catch-up scenarios (system down for a day), admin needs to trigger runs for past dates.
- Add a date picker to the "Run Now" form
- Scraper already reads `run_date` — just pass it through instead of defaulting to today
- **Effort:** ~1 hr

---

## Can Figure Later

Worth thinking about, but not urgent. Revisit when core flows are rock-solid.

### OBS-02 — Grafana Loki Log Drain
Zero code changes — just Railway Dashboard → Log Drains → Grafana Cloud Loki. Full observability: all stdout/stderr, crashes, OOM, startup errors. Needs Grafana Cloud account (free tier).
- Good complement to Sentry (Sentry = app errors; Loki = infra/process logs)
- **Effort:** ~4–6 hrs setup (mostly Grafana config)

### VENDOR-01 — Vendor Self-Service Portal
Vendors call the PM Store team to confirm delivery status. A read-only vendor portal (new role: VENDOR) where they can view their open POs, see GRN receipts, and acknowledge delivery would cut those calls.
- Separate login flow + scoped API endpoints (only their PO data)
- Relates to the vendor master table being planned in `~/Documents/ninjacart/PackTrack Pro/15 - PO Creation & Vendor Payments Plan.md` (Phase 1) — a self-service portal would sit naturally on top of that once it exists
- **Effort:** ~1 day

### SCAN-01 — Barcode/QR Scan for GRN
Typing SKU codes manually on a warehouse floor is error-prone. Camera-based barcode scan (using `@zxing/browser`) on the GRN material selector would speed things up and reduce typos.
- Progressive enhancement — fallback to text input if camera not available
- **Effort:** ~4 hrs

### FORECAST-01 — Demand Forecasting
With 3–6 months of daily consumption data, we'll have enough signal for basic forecasting: "At current rate, Facility X will run out of Material Y in N days."
- Simple linear regression or rolling 7-day average × days-remaining
- Surface as a "Forecast" tab in admin, with a sortable "Days Until Stockout" column
- **Effort:** ~1 day (once data accumulates)

### INDENT-01 — Auto-Indent Creation on Low Stock
When a material's balance drops below min threshold (post consumption accept), auto-create a draft indent for the PM Store to review and approve — so replenishment is triggered without anyone manually noticing the alert.
- Builds on ALERT-01 infra; draft indent needs PM Store approval before it counts
- **Effort:** ~3 hrs (after ALERT-01 is done)

### ERP-01 — Automated PO Sync from ERP/SAP
POs are currently uploaded via CSV. If Ninjacart's ERP exposes an API or webhook, we could auto-ingest POs as soon as they're raised — no manual upload step.
- Depends on ERP team's API availability; PackTrack side is a scheduled import job
- Superseded in direction by `~/Documents/ninjacart/PackTrack Pro/15 - PO Creation & Vendor Payments Plan.md`, which flips this around — PO creation moves *into* PackTrack and pushes out to DICE (Ninjacart's admin/ERP tool), rather than PackTrack pulling from ERP. Phase 3 of that plan is blocked on the same open question: whether DICE exposes any API at all.
- **Effort:** Unknown — ERP dependency

### MULTI-01 — Multi-Tenant Support
If other BUs or external clients want to use PackTrack, we'd need data isolation (schema-per-tenant or row-level with `tenant_id`). Not relevant now but worth keeping in mind before the schema grows further.
- **Effort:** ~2 days (schema migration + auth overhaul)

---

*Last updated: 2026-08-24*
