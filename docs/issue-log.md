# Issue Log — PackTrack Pro

Tracks bugs found during live testing, their root cause, and the fix applied.

---

## Open Issues

*None currently.*

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

### BUG-003 · Store Stock tab not refreshable
**Found:** 2026-07-24
**Reported by:** Manual testing
**Symptom:** Store Stock tab in PM Store Ops showed stale data with no way to refresh without switching tabs.
**Root cause:** `StoreStockView` had no manual refresh button. The fetch logic was inside a plain `async function load()` inside `useEffect`, making it impossible to call from a button click. The GRN and Indent tabs both had `RefreshCw` buttons wired to their load functions; Store Stock was missing this pattern.
**Fix:** Converted `load` to a `useCallback`, wired `useEffect` to call it, and added a `RefreshCw` button in the section header — consistent with GRN and Indent tab headers.
**Commit:** *(this session)*
