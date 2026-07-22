# Test Cases — PackTrack Pro

Tracks all test scenarios by module. "Tested" means manually verified on live Railway deployment.

**Legend:** ✅ Tested · ⚠️ Partially tested · ❌ Not yet tested

---

## 1. Authentication

| # | Scenario | Expected | Tested |
|---|---|---|---|
| A-01 | Login with valid credentials (any role) | 200, returns JWT + user object | ✅ |
| A-02 | Login with wrong password | 401 INVALID_CREDENTIALS | ✅ |
| A-03 | Login with unknown email | 401 INVALID_CREDENTIALS | ✅ |
| A-04 | Login with inactive user (`is_active = false`) | 401 ACCOUNT_DISABLED | ❌ |
| A-05 | Logout — token blacklisted in sessions table | 200, subsequent calls rejected | ❌ |
| A-06 | Call any authenticated endpoint without token | 401 | ✅ (incidental) |
| A-07 | Call any authenticated endpoint with expired token | 401 | ❌ |
| A-08 | Bootstrap admin endpoint (first-time setup) | Creates admin user, fails if one exists | ❌ |

---

## 2. Role-Based Access Control

| # | Scenario | Expected | Tested |
|---|---|---|---|
| R-01 | PM_STORE_EXEC calls `/api/v1/admin/*` | 403 FORBIDDEN | ❌ |
| R-02 | CC_EXEC calls `/api/v1/purchase-orders/upload` | 403 FORBIDDEN | ❌ |
| R-03 | FC_EXEC calls `/api/v1/stock-issues` (create) | 403 FORBIDDEN | ❌ |
| R-04 | ADMIN can call any endpoint | 200 on all | ✅ (used in practice) |
| R-05 | CC_EXEC / FC_EXEC can upload indents | 200 | ✅ |
| R-06 | CC_DP / FC_DP can upload indents and confirm receipts | 200 | ⚠️ (logins created, not exercised) |

---

## 3. PO Upload

| # | Scenario | Expected | Tested |
|---|---|---|---|
| P-01 | Upload valid PO CSV (non-roll materials) | All rows inserted, batch VALIDATED | ✅ |
| P-02 | Upload valid PO CSV with roll materials (`no_of_rolls × length_per_roll`) | qty stored in meters | ✅ |
| P-03 | Upload CSV with duplicate `(po_no, material_id)` within the same file | Second row rejected as error_row | ❌ |
| P-04 | Upload CSV where `(po_no, material_id)` already exists in DB | Row rejected, error_detail populated | ❌ |
| P-05 | Upload CSV with missing required columns | Batch FAILED, error_detail lists missing cols | ⚠️ (tested indirectly) |
| P-06 | Upload CSV with empty qty cells | Row rejected (Zod rejects, not coerced to 0) | ✅ (bug fixed July 21) |
| P-07 | Upload non-CSV file | 400 VALIDATION_ERROR | ❌ |
| P-08 | Upload CSV with unknown material code | Row rejected, MATERIAL_NOT_FOUND in error_detail | ❌ |
| P-09 | Sample CSV download | Valid CSV with correct columns including roll columns | ✅ |

---

## 4. Goods Receipts (GRN)

| # | Scenario | Expected | Tested |
|---|---|---|---|
| G-01 | Post GRN against OPEN PO (full qty) | GRN posted, PO moves to CLOSED, ledger INWARD written | ✅ |
| G-02 | Post GRN against OPEN PO (partial qty) | GRN posted, PO moves to PARTIALLY_RECEIVED | ✅ |
| G-03 | Post second GRN against PARTIALLY_RECEIVED PO (remaining qty) | PO closes | ✅ |
| G-04 | Post GRN where qty > remaining_qty | 400 OVER_RECEIPT | ❌ |
| G-05 | Post GRN against CANCELLED PO | 400 or 404 | ❌ |
| G-06 | Post GRN against FORCE_COMPLETED PO | 400 | ❌ |
| G-07 | Upload invoice image against a GRN | Image stored, path saved in DB | ❌ |
| G-08 | Admin edit a GRN (patch qty/date) | Updated, audit logged | ❌ |
| G-09 | Admin cancel a GRN | Status REVERSED, ledger reversal written | ❌ |
| G-10 | OPEN PO card shows green, PARTIALLY_RECEIVED shows amber | Visual colour coding correct | ✅ |

---

## 5. PO Force Complete & Admin Actions

| # | Scenario | Expected | Tested |
|---|---|---|---|
| F-01 | Force complete an OPEN PO | Status → FORCE_COMPLETED, reason stored | ✅ |
| F-02 | Force complete a PARTIALLY_RECEIVED PO | Status → FORCE_COMPLETED | ✅ |
| F-03 | Reverse force complete → was OPEN (0 received) | Status reverts to OPEN | ✅ |
| F-04 | Reverse force complete → was PARTIALLY_RECEIVED | Status reverts to PARTIALLY_RECEIVED | ✅ |
| F-05 | Admin cancel an OPEN PO | Status → CANCELLED, previous state in admin_reversals | ❌ |
| F-06 | Cancel an already CANCELLED PO | 400 or idempotent | ❌ |

---

## 6. Indent Upload

| # | Scenario | Expected | Tested |
|---|---|---|---|
| I-01 | Upload valid indent CSV (non-roll materials) | All rows inserted, batch VALIDATED | ✅ |
| I-02 | Upload valid indent CSV (roll materials using `no_of_rolls`) | qty stored correctly | ✅ |
| I-03 | Upload CSV with empty qty cells | Row rejected (not coerced to 0) | ✅ (bug fixed July 21) |
| I-04 | Upload CSV with unknown material code | Row rejected | ❌ |
| I-05 | Upload from wrong warehouse (CC_EXEC uploading for another CC) | Server rejects or filters to own warehouse | ❌ |
| I-06 | Sample CSV download | Valid CSV with correct columns | ✅ |

---

## 7. Stock Issues (Dispatch from PM Store)

| # | Scenario | Expected | Tested |
|---|---|---|---|
| S-01 | Issue full qty against a PENDING indent line | Indent line → FULLY_ISSUED, ledger ISSUE_OUT written | ✅ |
| S-02 | Issue partial qty against a PENDING indent line | Indent line → PARTIALLY_ISSUED | ✅ |
| S-03 | Issue remaining qty against a PARTIALLY_ISSUED line | Indent line → FULLY_ISSUED | ✅ |
| S-04 | Issue qty > requested_qty | 400 OVER_ISSUE | ❌ |
| S-05 | Issue against a FULLY_ISSUED indent line | 400 | ❌ |
| S-06 | Issue against a CANCELLED indent line | 400 | ❌ |
| S-07 | Force complete an indent line | Status → FORCE_COMPLETED, reason stored | ✅ |
| S-08 | Force complete a stock issue (from CC/FC side) | Status → FORCE_COMPLETED | ✅ |
| S-09 | Admin cancel a stock issue | Status → CANCELLED, previous state stored | ❌ |
| S-10 | Admin edit a stock issue | Updated fields, audit logged | ❌ |
| S-11 | Issue defaults API returns correct qty and cost | Prefilled values match indent line | ⚠️ (used by UI, not independently verified) |

---

## 8. Stock Receipts (CC/FC Acknowledgement)

| # | Scenario | Expected | Tested |
|---|---|---|---|
| RC-01 | Confirm receipt with no shortage (received = dispatched) | Issue → RECEIVED, ledger RECEIPT_IN written | ✅ |
| RC-02 | Confirm receipt with shortage (received < dispatched) | Issue → PARTIALLY_RECEIVED, ledger RECEIPT_IN + RECEIPT_SHORTAGE_WRITE_OFF | ✅ |
| RC-03 | Confirm receipt with received > dispatched | 400 or capped | ❌ |
| RC-04 | Confirm receipt for an already RECEIVED issue | 400 idempotency guard | ❌ |
| RC-05 | Confirm receipt for a CANCELLED issue | 400 | ❌ |
| RC-06 | Admin cancel a stock receipt | Status reversed, ledger unwound | ❌ |
| RC-07 | Admin edit a stock receipt | Updated qty fields | ❌ |
| RC-08 | Pending shipments list (CC/FC) only shows own warehouse | Filtered correctly by warehouse_id | ✅ (incidental) |
| RC-09 | Pending banner count matches actual list | Count = rows with DISPATCHED/PARTIALLY_RECEIVED status | ⚠️ |

---

## 9. Stock Ledger Integrity

| # | Scenario | Expected | Tested |
|---|---|---|---|
| L-01 | After full GRN, current stock increases by GRN qty | `v_current_stock` sum correct | ⚠️ (observed in UI) |
| L-02 | After stock issue, PM Store stock decreases | Ledger ISSUE_OUT with negative qty_delta | ⚠️ |
| L-03 | After stock receipt, destination warehouse stock increases | Ledger RECEIPT_IN with positive qty_delta | ⚠️ |
| L-04 | Duplicate ledger entry prevented (unique ref_table + ref_id + movement_type) | Second insert rejected | ❌ |
| L-05 | After GRN cancel, reversal entry written and stock decremented | Ledger REVERSAL | ❌ |
| L-06 | Roll material: ledger stores meters, not unit count | `qty_delta` = units × meters_per_unit | ⚠️ (design verified, not queried) |

---

## 10. Audit (Physical Stock Count)

| # | Scenario | Expected | Tested |
|---|---|---|---|
| AU-01 | Submit audit with physical qty matching system qty | Delta = 0, no ledger entry written | ❌ |
| AU-02 | Submit audit with physical qty > system qty (surplus) | Positive AUDIT_ADJUSTMENT ledger entry | ❌ |
| AU-03 | Submit audit with physical qty < system qty (loss) | Negative AUDIT_ADJUSTMENT ledger entry | ❌ |
| AU-04 | Prefill API returns current system qty per material | Quantities match v_current_stock | ❌ |
| AU-05 | Audit list filters by warehouse | Only shows own warehouse audits | ❌ |

---

## 11. Consumption Scraper

| # | Scenario | Expected | Tested |
|---|---|---|---|
| C-01 | Run scraper via `POST /api/v1/admin/consumption/run-now` | Queries Redash, deducts stock, creates run + lines | ✅ |
| C-02 | Scraper deducts correct qty for non-roll materials (1:1) | qty_deducted = packaged_qty | ✅ |
| C-03 | Scraper deducts meters for roll materials | qty_deducted = packaged_qty × meters_per_unit | ✅ |
| C-04 | Unmapped FSN → line status UNMAPPED_SKU | Skipped, no ledger entry | ✅ (Redash legacy codes) |
| C-05 | Unmapped facility → line status UNMAPPED_FACILITY | Skipped | ❌ (not explicitly verified) |
| C-06 | Duplicate run on same date prevented (unique run_date) | 409 or IDEMPOTENT | ❌ |
| C-07 | Consumption run list shows history with counts | deducted/skipped/error counts accurate | ✅ (UI observed) |

---

## 12. Min Stock Levels

| # | Scenario | Expected | Tested |
|---|---|---|---|
| M-01 | Save min qty for a warehouse × material pair | Upserted in DB | ✅ |
| M-02 | Low-stock alert fires when on_hand < min_qty | `v_low_stock_alerts` returns that row | ⚠️ (view exists, alert UI not confirmed) |
| M-03 | Editing and saving multiple rows in one batch | All upserted atomically | ✅ (UI) |

---

## 13. SKU Packaging Master

| # | Scenario | Expected | Tested |
|---|---|---|---|
| SK-01 | Upload valid SKU master CSV | 414 FSNs inserted, 0 unmapped | ✅ |
| SK-02 | Upload CSV with unknown primary_pm_code | Row rejected | ❌ |
| SK-03 | Upload CSV for FSN already in DB | Upsert — existing row overwritten | ⚠️ (not verified explicitly) |
| SK-04 | List SKU master returns all active mappings | Paginated or full list correct | ✅ (admin UI) |

---

## 14. Admin Panel — Overview & Audit Log

| # | Scenario | Expected | Tested |
|---|---|---|---|
| AD-01 | Overview API returns correct aggregate counts | PO/GRN/indent counts match DB | ⚠️ (UI used, not cross-checked) |
| AD-02 | Audit log lists all actions newest-first | Correct ordering, entity links present | ✅ |
| AD-03 | Audit log pagination works | Page 2 onwards returns correct offset | ❌ |
| AD-04 | Refresh button triggers live data reload | All dashboard sections re-fetch | ✅ |

---

## 15. User Management

| # | Scenario | Expected | Tested |
|---|---|---|---|
| U-01 | Admin resets a user's password (≥ 8 chars) | Password hash updated, audit logged | ✅ |
| U-02 | Reset with password < 8 chars | 400 VALIDATION_ERROR | ✅ (client-side; server also validates) |
| U-03 | Confirm mismatch in modal | Modal blocks submission | ✅ |
| U-04 | Reset password for non-existent user ID | 404 NOT_FOUND | ❌ |
| U-05 | Create new user via `POST /api/v1/users` | User created, can log in | ⚠️ (used to create logins, not via UI) |
| U-06 | Users list shows all accounts (no password hashes) | 200, password_hash absent from response | ✅ |

---

## 16. Guided Tour

| # | Scenario | Expected | Tested |
|---|---|---|---|
| T-01 | First login triggers tour auto-start (Admin Portal) | Tour overlay appears after login | ✅ |
| T-02 | First login triggers tour auto-start (PM Store Ops) | Tour overlay appears | ✅ |
| T-03 | First login triggers tour auto-start (Receipt App) | Tour overlay appears | ✅ |
| T-04 | `?` button replays the tour | Overlay restarts from step 1 | ✅ |
| T-05 | Tour does NOT auto-start on subsequent logins | localStorage key prevents re-trigger | ✅ |
| T-06 | Skip button closes tour immediately | Overlay unmounts | ✅ |
| T-07 | Prev/Next navigate steps correctly | Step count and spotlight move | ✅ |
| T-08 | Finish on last step | `onDone` fires, overlay closes | ✅ |
| T-09 | Tab-switching steps highlight correct element | `onEnter` + DOM timing correct | ✅ |
| T-10 | Steps with no target render centred popover | No spotlight, popover centred | ✅ |

---

## 17. General UI / Cross-Cutting

| # | Scenario | Expected | Tested |
|---|---|---|---|
| UI-01 | Login page rejects empty fields | Client validation | ✅ |
| UI-02 | Session expiry redirects to login | Token invalidated → 401 → logout | ❌ |
| UI-03 | All 3 apps load on Railway URL | No blank screen, no 404 on refresh | ✅ |
| UI-04 | Mobile layout — no horizontal overflow | Responsive on 375px viewport | ❌ |
| UI-05 | Large Redash file (>10 MB) doesn't OOM server | Streaming to file, then parse | ✅ (by design) |

---

## Summary

| Module | Total | ✅ Tested | ⚠️ Partial | ❌ Not tested |
|---|---|---|---|---|
| Authentication | 8 | 3 | 0 | 5 |
| Role-Based Access Control | 6 | 1 | 1 | 4 |
| PO Upload | 9 | 4 | 1 | 4 |
| Goods Receipts | 10 | 4 | 0 | 6 |
| PO Force Complete & Admin | 6 | 4 | 0 | 2 |
| Indent Upload | 6 | 3 | 0 | 3 |
| Stock Issues | 11 | 5 | 1 | 5 |
| Stock Receipts | 9 | 3 | 1 | 5 |
| Stock Ledger Integrity | 6 | 0 | 3 | 3 |
| Audit (Physical Count) | 5 | 0 | 0 | 5 |
| Consumption Scraper | 7 | 5 | 0 | 2 |
| Min Stock Levels | 3 | 2 | 1 | 0 |
| SKU Packaging Master | 4 | 2 | 1 | 1 |
| Admin Overview & Audit Log | 4 | 2 | 1 | 1 |
| User Management | 6 | 3 | 1 | 2 |
| Guided Tour | 10 | 10 | 0 | 0 |
| General UI | 5 | 3 | 0 | 2 |
| **Total** | **115** | **58** | **11** | **46** |

**50% fully tested · 10% partial · 40% untested**

---

## Priority Testing Gaps

These are the highest-risk untested scenarios:

1. **Over-receipt / over-issue guards** (G-04, S-04) — data corruption if not enforced at DB level
2. **GRN cancel reverses ledger** (G-09, L-05) — stock integrity after admin correction
3. **Duplicate ledger entry prevention** (L-04) — unique constraint exists but never triggered in tests
4. **Role enforcement on wrong-role API calls** (R-01 to R-03) — auth middleware untested in isolation
5. **Session expiry handling** (A-07, UI-02) — users may get stuck in logged-in state
6. **Audit feature** (AU-01 to AU-05) — fully built but never exercised end-to-end
7. **Receipt cancel / edit** (RC-06, RC-07) — admin correction paths untested
8. **Duplicate consumption run on same date** (C-06) — risk of double-deduction if scraper retried
