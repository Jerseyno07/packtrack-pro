# Product Ideas & Roadmap — PackTrack Pro

Brain dump of enhancement ideas, ranked by urgency. Not a sprint plan — just a place to capture what's worth building next.

---

## Need to Have

These fill real operational gaps. Either already breaking things or blocking adoption.

### ERR-01 — Autonomous Error Monitoring (Slack + Auto-Fixer)
When a 500 hits, no one knows unless a user complains. Two-phase fix:
- **Slack alert** (Option 1): fire-and-forget `fetch()` in the global error handler → instant notification in a dedicated channel
- **In-DB capture + CronCreate** (Option 2): write every error to `server_errors` table; durable cron job fires every 15 min, diagnoses root cause from stack trace, applies fix, pushes to main (Railway auto-deploys)
- Admin portal gets a "Server Errors" tab with status badges and stack trace viewer
- **Effort:** ~3 hrs combined

### ALERT-01 — Low Stock Alerts
Min stock levels are already configured per facility. We should fire an alert (Slack and/or email) when any material's running stock drops below its threshold after a consumption run is accepted.
- Trigger point: end of `acceptRun()` — compare new balance against `min_stock_levels`
- Alert payload: facility, material, current qty, min threshold, deficit
- **Effort:** ~2 hrs

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

### MOBILE-01 — Mobile-Friendly PWA for CC/FC Execs
CC/FC execs work on phones on the warehouse floor. The receipt app is functional but not thumb-friendly — forms are small, buttons need zooming.
- Larger touch targets, sticky action buttons at bottom, simplified confirmation screens
- Add PWA manifest + service worker so it installs to home screen with offline splash
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
- **Effort:** Unknown — ERP dependency

### MULTI-01 — Multi-Tenant Support
If other BUs or external clients want to use PackTrack, we'd need data isolation (schema-per-tenant or row-level with `tenant_id`). Not relevant now but worth keeping in mind before the schema grows further.
- **Effort:** ~2 days (schema migration + auth overhaul)

---

*Last updated: 2026-07-27*
