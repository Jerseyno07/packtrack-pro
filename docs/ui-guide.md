# UI Guide — Buttons, Sections & What They Do

A reference for every tab, section, and button across the three PackTrack Pro apps. Also used as the source for the in-app guided tour steps.

---

## Admin Portal

The admin portal is used by the ADMIN role. It is the central control plane for POs, stock movements, consumption, and user management.

| # | Area | Title | Description |
|---|---|---|---|
| 1 | Tab bar | Welcome to PackTrack Admin | Main navigation. Tabs: Purchase Orders, Stock Issues, Current Stock, Audit Log, SKU Master, Consumption Runs, Min Stock Levels, Users. |
| 2 | Purchase Orders tab | Purchase Orders | Lists all vendor POs. Green = OPEN (not yet inwarded), amber = PARTIALLY_RECEIVED (partial inward done, remaining qty still open). |
| 3 | Active / All toggle | Active / All Toggle | Default view hides terminal POs (CLOSED, CANCELLED, FORCE_COMPLETED). Switch to All to see them. |
| 4 | Refresh button | Refresh | Re-fetches latest data from the server without a full page reload. |
| 5 | Download Sample CSV (PO section) | Download Sample CSV | Downloads a template CSV for PO upload. Roll materials (net rolls, ribbons) use `no_of_rolls` and `length_per_roll`; other materials use `po_qty`. Blank cells for unused columns are valid. |
| 6 | Upload POs button | Upload POs | Accepts the filled PO CSV and bulk-creates purchase order lines. A single `po_no` can span multiple rows (one row per material). |
| 7 | Cancel (per PO row) | Cancel a PO | Cancels an OPEN or PARTIALLY_RECEIVED PO. Requires a written reason. Irreversible — use only when the vendor has genuinely withdrawn the order. |
| 8 | Reverse Force Complete (per PO row) | Reverse Force Complete | Visible only on FORCE_COMPLETED POs. Undoes an accidental force-complete, restoring the PO to the correct status (OPEN or PARTIALLY_RECEIVED) based on received qty. Requires a reason. Logged in audit trail. |
| 9 | Stock Issues tab | Stock Issues | Lists all dispatches from the PM Store to FC and CC facilities. Active issues shown by default; use All toggle to see cancelled and force-completed ones. |
| 10 | Cancel (per Stock Issue row) | Cancel a Stock Issue | Cancels a pending dispatch before it is acknowledged at the destination. Requires a written reason. |
| 11 | Current Stock tab | Current Stock | Live on-hand quantities across all facilities (PM Store, FCs, CCs). Updated after every GRN, issue, and daily consumption scraper run. |
| 12 | Audit Log tab | Audit Log | Append-only log of every action in the system — GRNs, force completes, cancellations, password resets, consumption runs. Paged 50 records at a time. |
| 13 | Prev / Next (Audit Log) | Audit Log Pagination | Navigate through audit records 50 at a time. Prev is disabled on the first page; Next is disabled when no more records exist. |
| 14 | SKU Master tab | SKU Packaging Master | Maps each FSN (Ninjacart product code) to its primary, secondary, and tertiary packaging materials. The consumption scraper uses this mapping to deduct PM stock when units are packed at FC/CC. Upload a fresh CSV whenever the mapping changes. |
| 15 | Consumption Runs tab | Consumption Runs | Log of every daily scraper execution — timestamp, FSNs matched, FSNs unmapped (legacy codes like NCOF*, 250000* are expected to be unmapped). |
| 16 | Run Now button | Run Now | Triggers the consumption scraper immediately without waiting for the 5am scheduled run. Use after uploading a new SKU master or if yesterday's run failed. |
| 17 | Min Stock Levels tab | Min Stock Levels | Per-facility low-stock thresholds per material. Rows with unsaved edits are highlighted in amber. |
| 18 | Type filter (All / PM Store / FC / CC) | Facility Type Filter | Narrows the grid to a single facility type so you can focus edits on PM Store, FC, or CC thresholds separately. |
| 19 | Save button (Min Stock Levels) | Save Thresholds | Commits all inline edits at once. Disabled until at least one cell has been changed. Shows a brief "Saved" confirmation on success. |
| 20 | Users tab | User Accounts | Lists every login account (email, name, role, active status). No password hashes are exposed. |
| 21 | Reset Password (per user row) | Reset Password | Opens a modal to set a new password for the selected user. Minimum 8 characters, confirmation field required. The system does not notify the user — communicate the new password directly. Logged in audit trail as `ADMIN_PASSWORD_RESET`. |
| 22 | ? button (bottom-right) | Guided Tour | Replays the in-app guided tour from step 1. Available at any time regardless of which tab is active. |

---

## PM Store Ops

Used by the PM_STORE_EXEC role. Four tabs: Post GRN, Issue Against Indent, Store Stock, Audit.

| # | Area | Title | Description |
|---|---|---|---|
| 1 | App header / tab bar | Welcome to PM Store Ops | Four sections: Post GRN (inward from vendors), Issue Against Indent (dispatch to FC/CC), Store Stock (current on-hand), Audit (movement history). |
| 2 | Post GRN tab | Post GRN | Records stock received from vendors. Select an open PO, enter the quantity delivered, and submit. |
| 3 | PO card list | Open POs | Lists all POs with remaining qty. Green = OPEN, amber = PARTIALLY_RECEIVED with remaining qty shown on the right. |
| 4 | Qty input | Entering Quantity | The quantity received in this specific shipment. Does not have to be the full PO qty — partial quantities are allowed; the PO stays open for future deliveries. |
| 5 | Invoice No field | Invoice Number | Vendor invoice number for this delivery. Used for reconciliation and audit trail. |
| 6 | Attach Invoice Image button | Attach Invoice | Attach the vendor's physical invoice as JPG, PNG, or PDF. Optional but strongly recommended for audit purposes. |
| 7 | Post GRN button | Post GRN | Submits the inward entry. Updates the stock ledger, transitions PO status (OPEN → PARTIALLY_RECEIVED or CLOSED), and records the invoice details. |
| 8 | Force Complete reason textarea | Force Complete Reason | Mandatory free-text reason before Force Complete can be submitted. Documents why the PO is being closed short (e.g. "Vendor confirmed no balance stock"). |
| 9 | Force Complete button | Force Complete | Closes the PO with whatever qty has been received so far. No further GRNs are allowed after this. An admin can reverse it if done by mistake via the admin portal. |
| 10 | Issue Against Indent tab | Issue Against Indent | Dispatch packaging materials to an FC or CC facility against an approved indent request. |
| 11 | Pending indent card list | Pending Indents | Each card represents an approved material request from an FC or CC waiting to be fulfilled. Shows facility, material, and requested qty. |
| 12 | Qty and Vehicle No fields | Dispatch Details | Qty defaults to what the indent requested — adjust only for partial dispatches. Vehicle No is the transport vehicle carrying the goods. |
| 13 | Confirm Issue button | Confirm Issue | Records the dispatch, deducts from PM Store stock, and notifies the receiving FC/CC exec to acknowledge receipt. |
| 14 | Store Stock tab | Store Stock | Current on-hand quantities at this PM Store. Check this before issuing against an indent to confirm sufficient stock. |
| 15 | Audit tab | Audit | Full movement history for this PM Store — GRNs, issues, force completes, and consumption adjustments. |
| 16 | ? button (bottom-right) | Guided Tour | Replays the in-app guided tour from step 1. |

---

## Receipt App (FC / CC)

Used by FC_EXEC and CC_EXEC roles. Tabs: Pending, Stock, Audit.

| # | Area | Title | Description |
|---|---|---|---|
| 1 | App header | Welcome to the Receipt App | Acknowledge packaging materials dispatched from the PM Store to your facility. |
| 2 | Pending shipments list | Pending Shipments | Each card is a PM Store dispatch awaiting your acknowledgement. Shows material, dispatched qty, and vehicle number. |
| 3 | Shipment card | Selecting a Shipment | Tap a card to open the receipt form. You will see what was dispatched and can enter what you actually received. |
| 4 | Back button | Going Back | Returns to the pending list without making any changes. Use if you tapped the wrong shipment. |
| 5 | Received Qty input | Received Quantity | Enter the actual quantity received at your facility. If it matches the dispatched qty exactly, Confirm Receipt becomes available. If it is less, Force Complete becomes available. |
| 6 | Confirm Receipt button | Confirm Receipt | Active only when received qty matches dispatched qty exactly. Closes the shipment and credits your facility's stock. |
| 7 | Force Complete reason textarea | Short-Received? | If you received less than dispatched (damaged goods, short delivery), enter the reason here before Force Complete activates. |
| 8 | Force Complete button | Force Complete | Closes the shipment with the qty actually received. The shortfall is recorded in the audit log. Contact the PM Store to raise a discrepancy claim if needed. |
| 9 | Stock tab | Current Stock | On-hand quantities at your facility, updated after each confirmed receipt. |
| 10 | Audit tab | Audit | Full movement history for your facility — receipts, force completes, and consumption adjustments. |
| 11 | ? button (bottom-right) | Guided Tour | Replays the in-app guided tour from step 1. |
