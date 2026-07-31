# Issue Log — PackTrack Pro

Tracks bugs found during live testing, their root cause, and the fix applied.

---

## Open Issues

### BUG-005 · Indent roll material unit mismatch
**Found:** 2026-07-24
**Status:** Code fix on branch `fix/indent-roll-meters` — pending merge to main
**Symptom:** Indent upload stored `no_of_rolls` directly as `requested_qty` for roll materials. PO upload correctly stored `no_of_rolls × length_per_roll` in meters. Units were incomparable across the full issue/receipt/ledger chain.
**Root cause:** `indentRowSchema` had `no_of_rolls` but no `length_per_roll`. The upload handler set `finalQty = no_of_rolls` instead of `no_of_rolls × length_per_roll`.
**Fix:**
- Server: added `length_per_roll` to `indentRowSchema`; `finalQty = no_of_rolls × length_per_roll` for Roll unit materials
- Frontend: sample CSV updated with `length_per_roll` column; hint text updated
- Data patch `data-patch-001` corrects the 4 affected Hoskote lines already in DB (verified 2026-07-24)
**Branch:** `fix/indent-roll-meters` (commits `15d8c56`, `3c67bb4`)
**Data corrected (Hoskote CC):**

| SKU | Wrong qty | Correct (m) | Records fixed |
|---|---|---|---|
| NTRLL-HRD | 5 | 5000 | indent 13, issue 10, receipt 9, ledger 38/43 |
| NTRLL-SFT | 5 | 5000 | indent 14, issue 7, receipt 7, ledger 32/35 |
| BCRL-SML | 150 | 150000 | indent 16, issue 8, receipt 6, ledger 33/34 |
| WXRB-BLK | 315 | 315000 | indent 17, issue 9, receipt 8, ledger 36/37 |

---

## Resolved Issues

---

### BUG-001 · PO upload error details not visible
**Found:** 2026-07-24
**Reported by:** Manual testing
**Symptom:** PO upload result card showed "Errors: 8" but no explanation of which rows failed or why.
**Root cause:** `POUploadSection` rendered only the count from `result.error_rows`. The API was already returning `result.errors[]` (array of `{ row, error }`) but the UI wasn't displaying it.
**Fix:** Added a scrollable "Row errors" section below the counts in the PO upload result card. Each failed row shows its row number and exact reason.
**Commit:** `3d7c6ba` — fix: show per-row error details in PO upload result
**Note:** Indent upload already had this — only PO upload was missing it.

---

### BUG-002 · PO upload failing with "Invalid po_date"
**Found:** 2026-07-24
**Reported by:** Manual testing (live production CSV)
**Symptom:** All PO rows rejected with "Invalid po_date" error after BUG-001 fix revealed the messages.
**Root cause:** `toIsoDateOrNull()` used `new Date(val)` which only natively parses ISO (YYYY-MM-DD) and US format (MM/DD/YYYY). Indian date formats (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY) return Invalid Date.
**Fix:** Updated `toIsoDateOrNull` to try DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY (2-digit year), and YYYY/MM/DD before falling back to native `new Date()`. Also strips time components (`24/07/2026 10:30`). Also handles `Date` objects from xlsx.
**Commits:** `5772cb6`, `02e8cbd`
**Affects:** Both PO upload and indent upload (same function used for both).

---

### BUG-004 · Store Stock (and Audit) always showing mock data
**Found:** 2026-07-24
**Reported by:** Manual testing
**Symptom:** Store Stock tab always showed hardcoded sample rows (LDPE-06, Net Roll, Wax Ribbon) regardless of actual DB state. Newly inwarded GRNs never appeared.
**Root cause:** `StoreStockView` falls back to mock data when `warehouseId` is `undefined`. It receives this via `user?.warehouse_ids?.[0]`, but the login response never included `warehouse_ids` — the user object only had `{ id, name, email, role }`. So `warehouse_ids` was always `undefined`, and the real fetch was never reached.
**Fix:** Added a `user_warehouses` lookup at login time; `warehouse_ids` (array of ints) is now included in the login response `user` object.
**Commit:** `706c3b3` — fix: include warehouse_ids in login response
**Also affects:** `AuditScreen`, which has the same `warehouseId={user?.warehouse_ids?.[0]}` pattern.
**Follow-up (BUG-004b):** Admin user also unaffected by the above fix because admin has no `user_warehouses` rows, so `warehouse_ids` was still `[]`. Fixed by falling back to all active PM_STORE warehouses when the user has no assignments. Commit: `8266b60`

---

### BUG-003 · Store Stock tab not refreshable
**Found:** 2026-07-24
**Reported by:** Manual testing
**Symptom:** Store Stock tab in PM Store Ops showed stale data with no way to refresh without switching tabs.
**Root cause:** `StoreStockView` had no manual refresh button. The fetch logic was inside a plain `async function load()` inside `useEffect`, making it impossible to call from a button click. The GRN and Indent tabs both had `RefreshCw` buttons wired to their load functions; Store Stock was missing this pattern.
**Fix:** Converted `load` to a `useCallback`, wired `useEffect` to call it, and added a `RefreshCw` button in the section header — consistent with GRN and Indent tab headers.
**Commit:** *(this session)*
