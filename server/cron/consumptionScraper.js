// Consumption scraper — deducts stock based on packaging usage from Redash API.
// Schedule: 0 5 * * * (5am daily)
// Environment vars required:
//   CONSUMPTION_DASHBOARD_URL      — e.g. https://analytics-new-k8s.ninjacart.in
//   CONSUMPTION_DASHBOARD_API_KEY  — Redash API key
//   CONSUMPTION_QUERY_ID           — FC query ID (53716)
//   CONSUMPTION_CC_QUERY_ID        — CC query ID (53767)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const { parse: parseCsv } = require('csv-parse');
const { Readable } = require('stream');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Fetch Redash result as a streaming CSV to avoid loading large JSON payloads into memory.
async function fetchRedashCsvRows(url, hdrs) {
  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) throw new Error(`Redash CSV fetch failed: ${res.status} ${url}`);
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = parseCsv({ columns: true, skip_empty_lines: true, cast: false });
    parser.on('readable', () => { let r; while ((r = parser.read()) !== null) rows.push(r); });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    Readable.fromWeb(res.body).pipe(parser);
  });
}

// FC query (CONSUMPTION_QUERY_ID):
//   FacilityId → warehouses.code, FSN → sku_code, Billedlot → qty
//   Parameters: from, to
//
// CC query (CONSUMPTION_CC_QUERY_ID):
//   FromFacilityId → warehouses.code, fsncode → sku_code, AllocatedQuantity → qty
//   Parameters: "from date", "to date"

async function executeRedashQuery(qid, params) {
  const base = process.env.CONSUMPTION_DASHBOARD_URL;
  const apiKey = process.env.CONSUMPTION_DASHBOARD_API_KEY;
  const hdrs = { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' };

  const triggerRes = await fetch(`${base}/api/queries/${qid}/results`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({ parameters: params, max_age: 0 }),
  });
  if (!triggerRes.ok) throw new Error(`Redash trigger error ${triggerRes.status} for query ${qid}`);
  const triggerData = await triggerRes.json();

  // Immediate cached result — fetch as CSV to avoid large JSON in memory
  if (triggerData.query_result) {
    return fetchRedashCsvRows(`${base}/api/query_results/${triggerData.query_result.id}.csv`, hdrs);
  }

  const jobId = triggerData.job?.id;
  if (!jobId) throw new Error(`Redash returned neither job nor query_result for query ${qid}`);

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobRes = await fetch(`${base}/api/jobs/${jobId}`, { headers: hdrs });
    const job = (await jobRes.json()).job;
    if (job.status === 3) {
      return fetchRedashCsvRows(`${base}/api/query_results/${job.query_result_id}.csv`, hdrs);
    }
    if (job.status === 4) throw new Error(`Redash job failed for query ${qid}: ${job.error}`);
  }
  throw new Error(`Redash query ${qid} timed out after 5 minutes`);
}

async function scrapePackagedQty(fromDate, toDate) {
  const fcQid = process.env.CONSUMPTION_QUERY_ID;
  const ccQid = process.env.CONSUMPTION_CC_QUERY_ID;

  const [fcRows, ccRows] = await Promise.all([
    executeRedashQuery(fcQid, { from: fromDate, to: toDate }),
    executeRedashQuery(ccQid, { 'from date': fromDate, 'to date': toDate }),
  ]);
  console.log(`[consumption] FC rows: ${fcRows.length}, CC rows: ${ccRows.length}`);

  const out = [];

  for (const row of fcRows) {
    const fsn = row['FSN'];
    const facilityId = String(row['FacilityId'] ?? '').trim();
    const qty = Number(row['Billedlot'] ?? 0);
    if (!fsn || !facilityId || qty <= 0) continue;
    out.push({ facility_id: facilityId, sku_code: fsn, packaged_qty: qty });
  }

  for (const row of ccRows) {
    const fsn = row['fsncode'];
    const facilityId = String(row['FromFacilityId'] ?? '').trim();
    const qty = Number(row['AllocatedQuantity'] ?? 0);
    if (!fsn || !facilityId || qty <= 0) continue;
    out.push({ facility_id: facilityId, sku_code: fsn, packaged_qty: qty });
  }

  // Deduplicate: if the exact same (facility_id, sku_code, packaged_qty) appears more than once
  // (Redash sometimes reports the same allocation under both a new FSN and an old internal code),
  // keep only the first occurrence.
  const seen = new Set();
  const deduped = [];
  for (const row of out) {
    const key = `${row.facility_id}|${row.sku_code}|${row.packaged_qty}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(row); }
  }
  console.log(`[consumption] Raw rows: ${out.length}, after dedup: ${deduped.length}`);
  return deduped;
}

// options.facilityCodes — array of warehouse codes; if set, only process rows for those facilities
// options.runId: if the caller (HTTP endpoint) already pre-created the RUNNING row, pass it here
//   to skip the DELETE+INSERT and jump straight into the scraper body.
async function runConsumption(options = {}) {
  const { facilityCodes = null, runId: preRunId = null } = options;
  const facilityFilter = facilityCodes ? [...facilityCodes].sort().join(',') : null;
  const today = new Date();
  const runDate = today.toISOString().slice(0, 10);

  // Always scrape only the previous day — one run per day covers yesterday's data
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const scraped_from = yest.toISOString().slice(0, 10);
  const scraped_to   = yest.toISOString().slice(0, 10);

  let runId;
  if (preRunId) {
    runId = preRunId;
  } else {
    // Clear any prior FAILED or CANCELLED run (lines first to satisfy FK, then the run row)
    await pool.query(
      `DELETE FROM consumption_run_lines WHERE run_id IN (
         SELECT id FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
         AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)
       )`,
      [runDate, facilityFilter]
    );
    await pool.query(
      `DELETE FROM consumption_runs WHERE run_date = $1 AND status IN ('FAILED','CANCELLED')
       AND (($2::text IS NULL AND facility_filter IS NULL) OR facility_filter = $2)`,
      [runDate, facilityFilter]
    );

    const runRes = await pool.query(
      `INSERT INTO consumption_runs (run_date, scraped_from, scraped_to, status, facility_filter, progress_pct, progress_msg) VALUES ($1,$2,$3,'RUNNING',$4,0,'Starting up…') RETURNING id`,
      [runDate, scraped_from, scraped_to, facilityFilter]
    );
    runId = runRes.rows[0].id;
  }

  const setProgress = (pct, msg) =>
    pool.query(`UPDATE consumption_runs SET progress_pct=$1, progress_msg=$2 WHERE id=$3`, [pct, msg, runId]).catch(() => {});

  try {
    await setProgress(10, 'Fetching packaging data from Redash…');
    let rows = await scrapePackagedQty(scraped_from, scraped_to);
    if (facilityCodes?.length) {
      const codeSet = new Set(facilityCodes);
      rows = rows.filter((r) => codeSet.has(r.facility_id));
      console.log(`[consumption] Filtered to [${facilityCodes.join(', ')}]: ${rows.length} rows`);
    }
    console.log(`[consumption] Scraped ${rows.length} rows for ${scraped_from}..${scraped_to}`);
    await setProgress(40, `Data fetched — ${rows.length} rows. Loading lookup tables…`);

    const skuMap = new Map(
      (await pool.query('SELECT sku_code, primary_pm_code, secondary_pm_code, tertiary_pm_code FROM sku_packaging_master')).rows.map((r) => [r.sku_code, r])
    );
    const whMap = new Map(
      (await pool.query('SELECT id, code FROM warehouses WHERE is_active')).rows.map((r) => [r.code, r.id])
    );
    const matMap = new Map(
      (await pool.query('SELECT id, code, meters_per_unit, stickers_per_roll FROM materials WHERE is_active')).rows.map((r) => [r.code, r])
    );

    await setProgress(50, `Processing ${rows.length} SKU rows…`);
    let deducted = 0, skipped = 0, errored = 0;
    const progressStep = Math.max(1, Math.floor(rows.length / 4));

    for (const row of rows) {
      const sku = skuMap.get(row.sku_code);
      if (!sku) {
        await pool.query(
          `INSERT INTO consumption_run_lines (run_id, facility_id, sku_code, packaging_tier, packaged_qty, status, error_detail)
           VALUES ($1,$2,$3,'PRIMARY',$4,'UNMAPPED_SKU','SKU not in sku_packaging_master')`,
          [runId, row.facility_id, row.sku_code, row.packaged_qty]
        );
        skipped++; continue;
      }

      const warehouseId = whMap.get(row.facility_id);
      if (!warehouseId) {
        await pool.query(
          `INSERT INTO consumption_run_lines (run_id, facility_id, sku_code, packaging_tier, packaged_qty, status, error_detail)
           VALUES ($1,$2,$3,'PRIMARY',$4,'UNMAPPED_FACILITY','facility_id does not match any warehouse code')`,
          [runId, row.facility_id, row.sku_code, row.packaged_qty]
        );
        skipped++; continue;
      }

      const tiers = [
        { tier: 'PRIMARY',   code: sku.primary_pm_code },
        { tier: 'SECONDARY', code: sku.secondary_pm_code },
        { tier: 'TERTIARY',  code: sku.tertiary_pm_code },
      ].filter((t) => t.code);

      for (const { tier, code } of tiers) {
        const mat = matMap.get(code);
        if (!mat) {
          await pool.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, status, error_detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'UNMAPPED_SKU','PM code not found in materials')`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty]
          );
          errored++; continue;
        }

        // For roll materials, deduct meters_per_unit × packaged_qty instead of units
        const deductQty = mat.meters_per_unit
          ? row.packaged_qty * Number(mat.meters_per_unit)
          : row.packaged_qty;

        // Store as PENDING — no ledger entry yet. User must Accept the run to commit to stock.
        try {
          await pool.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty, deductQty]
          );
          deducted++;
        } catch (e) {
          await pool.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, status, error_detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'SKIPPED',$8)`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty, e.message]
          );
          errored++;
        }
      }
      // Update progress every ~25% of rows
      const idx = rows.indexOf(row);
      if (idx > 0 && idx % progressStep === 0) {
        const pct = 50 + Math.floor((idx / rows.length) * 35);
        await setProgress(pct, `Processing rows… (${idx} of ${rows.length})`);
      }
    }

    await setProgress(85, `SKU rows done. Computing MRP sticker deductions…`);

    // MRP sticker pass: every unit packed consumes 1 barcode label + 1 wax ribbon print.
    // Group total packaged_qty per (facility, warehouse), then add PENDING lines for
    // the appropriate barcode roll and for WXRB-BLK.
    const waxMat   = matMap.get('WXRB-BLK');
    const bcrSmall = matMap.get('BCRL-SML');
    const bcrBig   = matMap.get('BCRL-BIG');

    const facilityTotals = new Map();
    for (const row of rows) {
      if (!skuMap.get(row.sku_code)) continue; // only count mapped SKUs — same as regular deduction pass
      const warehouseId = whMap.get(row.facility_id);
      if (!warehouseId) continue;
      const key = `${row.facility_id}::${warehouseId}`;
      if (!facilityTotals.has(key)) facilityTotals.set(key, { facility_id: row.facility_id, warehouseId, total: 0 });
      facilityTotals.get(key).total += row.packaged_qty;
    }

    for (const { facility_id, warehouseId, total } of facilityTotals.values()) {
      if (total <= 0) continue;

      // Split barcode deduction across BCRL-SML and BCRL-BIG based on current stock.
      // Deduct from BCRL-SML first up to its balance, remainder from BCRL-BIG.
      // If neither has stock, fall back to a BCRL-SML line (shows STOCK_BELOW_ZERO in review).
      const stockRes = await pool.query(
        `SELECT m.code, COALESCE(SUM(sl.qty_delta), 0) AS balance
         FROM materials m
         LEFT JOIN stock_ledger sl ON sl.material_id = m.id AND sl.warehouse_id = $1
         WHERE m.code IN ('BCRL-SML', 'BCRL-BIG')
         GROUP BY m.code`,
        [warehouseId]
      );
      const stockMap = new Map(stockRes.rows.map((r) => [r.code, Number(r.balance)]));
      const smlBalance = Math.max(0, stockMap.get('BCRL-SML') || 0);
      const smlDeduct  = Math.min(total, smlBalance);
      const bigDeduct  = total - smlDeduct;

      if (smlDeduct > 0 && bcrSmall) {
        await pool.query(
          `INSERT INTO consumption_run_lines
           (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status)
           VALUES ($1,$2,$3,'__MRP__','MRP_BARCODE',$4,$5,$6,'PENDING')`,
          [runId, facility_id, warehouseId, bcrSmall.code, total, smlDeduct]
        );
        deducted++;
      }
      if (bigDeduct > 0 && bcrBig) {
        await pool.query(
          `INSERT INTO consumption_run_lines
           (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status)
           VALUES ($1,$2,$3,'__MRP__','MRP_BARCODE',$4,$5,$6,'PENDING')`,
          [runId, facility_id, warehouseId, bcrBig.code, total, bigDeduct]
        );
        deducted++;
      }
      // Neither in stock — create a BCRL-SML line so it surfaces in the review modal
      if (smlDeduct === 0 && bigDeduct === 0 && bcrSmall) {
        await pool.query(
          `INSERT INTO consumption_run_lines
           (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status)
           VALUES ($1,$2,$3,'__MRP__','MRP_BARCODE',$4,$5,$5,'PENDING')`,
          [runId, facility_id, warehouseId, bcrSmall.code, total]
        );
        deducted++;
      }

      if (waxMat) {
        await pool.query(
          `INSERT INTO consumption_run_lines
           (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status)
           VALUES ($1,$2,$3,'__MRP__','MRP_WAX_RIBBON',$4,$5,$5,'PENDING')`,
          [runId, facility_id, warehouseId, waxMat.code, total]
        );
        deducted++;
      }
    }

    await setProgress(95, 'Finalising run…');
    await pool.query(
      `UPDATE consumption_runs SET status='PENDING_REVIEW', progress_pct=100, progress_msg='Complete — awaiting review', total_sku_facility_rows=$1, deducted_lines=$2, skipped_lines=$3, error_lines=$4, completed_at=now() WHERE id=$5`,
      [rows.length, deducted, skipped, errored, runId]
    );
    console.log(`[consumption] Run ${runId} PENDING_REVIEW — pending:${deducted} skipped:${skipped} errors:${errored}`);
  } catch (e) {
    await pool.query(`UPDATE consumption_runs SET status='FAILED', completed_at=now(), last_error=$2 WHERE id=$1`, [runId, e.message]);
    console.error('[consumption] Run FAILED:', e.message);
    throw e;
  }
}

// Cron scheduling removed — manual runs only via admin portal.
// To re-enable: schedule `runConsumption()` here with node-cron.

module.exports = { runConsumption };
