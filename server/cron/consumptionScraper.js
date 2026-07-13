// Consumption scraper — deducts stock based on packaging usage from Redash API.
// Schedule: 0 5 * * * (5am daily)
// Environment vars required:
//   CONSUMPTION_DASHBOARD_URL      — e.g. https://analytics-new-k8s.ninjacart.in
//   CONSUMPTION_DASHBOARD_API_KEY  — Redash API key
//   CONSUMPTION_QUERY_ID           — FC query ID (53716)
//   CONSUMPTION_CC_QUERY_ID        — CC query ID (53761)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getCurrentStock(client, warehouseId, materialCode) {
  const r = await client.query(
    `SELECT COALESCE(SUM(qty_delta), 0) AS qty
     FROM stock_ledger sl
     JOIN materials m ON m.id = sl.material_id
     WHERE sl.warehouse_id = $1 AND m.code = $2`,
    [warehouseId, materialCode]
  );
  return Number(r.rows[0].qty);
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

  if (triggerData.query_result) return triggerData.query_result.data?.rows ?? [];

  const jobId = triggerData.job?.id;
  if (!jobId) throw new Error(`Redash returned neither job nor query_result for query ${qid}`);

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const jobRes = await fetch(`${base}/api/jobs/${jobId}`, { headers: hdrs });
    const job = (await jobRes.json()).job;
    if (job.status === 3) {
      const resultRes = await fetch(`${base}/api/query_results/${job.query_result_id}`, { headers: hdrs });
      const rd = await resultRes.json();
      return rd?.query_result?.data?.rows ?? [];
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

  return out;
}

async function runConsumption() {
  const today = new Date();
  const runDate = today.toISOString().slice(0, 10);

  const lastRun = await pool.query('SELECT run_date FROM consumption_runs WHERE status=\'COMPLETED\' ORDER BY run_date DESC LIMIT 1');
  let scraped_from, scraped_to;
  if (lastRun.rows.length) {
    const last = new Date(lastRun.rows[0].run_date);
    last.setDate(last.getDate() + 1);
    scraped_from = last.toISOString().slice(0, 10);
  } else {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    scraped_from = yesterday.toISOString().slice(0, 10);
  }
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  scraped_to = yest.toISOString().slice(0, 10);

  if (scraped_from > scraped_to) {
    console.log('[consumption] Already up to date — nothing to scrape');
    return;
  }

  const runRes = await pool.query(
    `INSERT INTO consumption_runs (run_date, scraped_from, scraped_to, status) VALUES ($1,$2,$3,'RUNNING') RETURNING id`,
    [runDate, scraped_from, scraped_to]
  );
  const runId = runRes.rows[0].id;

  try {
    const rows = await scrapePackagedQty(scraped_from, scraped_to);
    console.log(`[consumption] Scraped ${rows.length} rows for ${scraped_from}..${scraped_to}`);

    const skuMap = new Map(
      (await pool.query('SELECT sku_code, primary_pm_code, secondary_pm_code, tertiary_pm_code FROM sku_packaging_master')).rows.map((r) => [r.sku_code, r])
    );
    const whMap = new Map(
      (await pool.query('SELECT id, code FROM warehouses WHERE is_active')).rows.map((r) => [r.code, r.id])
    );
    const matMap = new Map(
      (await pool.query('SELECT id, code FROM materials WHERE is_active')).rows.map((r) => [r.code, r.id])
    );

    let deducted = 0, skipped = 0, errored = 0;

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
        const materialId = matMap.get(code);
        if (!materialId) {
          await pool.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, status, error_detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'UNMAPPED_SKU','PM code not found in materials')`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty]
          );
          errored++; continue;
        }

        const onHand = await getCurrentStock(pool, warehouseId, code);
        const lineStatus = onHand - row.packaged_qty < 0 ? 'STOCK_BELOW_ZERO' : 'DEDUCTED';

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const ledgerRes = await client.query(
            `INSERT INTO stock_ledger (warehouse_id, material_id, movement_type, qty_delta, unit_cost, ref_table, ref_id, movement_date)
             VALUES ($1,$2,'CONSUMPTION',$3,0,'consumption_run_lines',0,$4) RETURNING id`,
            [warehouseId, materialId, -row.packaged_qty, scraped_to]
          );
          const ledgerId = ledgerRes.rows[0].id;
          await client.query(`UPDATE stock_ledger SET ref_id=$1 WHERE id=$1`, [ledgerId]);

          await client.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, qty_deducted, status, ledger_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty, lineStatus, ledgerId]
          );
          await client.query('COMMIT');
          deducted++;
        } catch (e) {
          await client.query('ROLLBACK');
          await pool.query(
            `INSERT INTO consumption_run_lines (run_id, facility_id, warehouse_id, sku_code, packaging_tier, material_code, packaged_qty, status, error_detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'SKIPPED',$8)`,
            [runId, row.facility_id, warehouseId, row.sku_code, tier, code, row.packaged_qty, e.message]
          );
          errored++;
        } finally { client.release(); }
      }
    }

    await pool.query(
      `UPDATE consumption_runs SET status='COMPLETED', total_sku_facility_rows=$1, deducted_lines=$2, skipped_lines=$3, error_lines=$4, completed_at=now() WHERE id=$5`,
      [rows.length, deducted, skipped, errored, runId]
    );
    console.log(`[consumption] Run ${runId} COMPLETED — deducted:${deducted} skipped:${skipped} errors:${errored}`);
  } catch (e) {
    await pool.query(`UPDATE consumption_runs SET status='FAILED', completed_at=now() WHERE id=$1`, [runId]);
    console.error('[consumption] Run FAILED:', e.message);
    throw e;
  }
}

// Schedule 5am daily
if (require.main === module || !module.parent) {
  try {
    const cron = require('node-cron');
    cron.schedule('0 5 * * *', () => {
      console.log('[consumption] cron triggered');
      runConsumption().catch((e) => console.error('[consumption] cron error:', e.message));
    });
    console.log('[consumption] cron scheduled — 0 5 * * *');
  } catch (e) {
    console.warn('[consumption] node-cron not available, skipping schedule:', e.message);
  }
}

module.exports = { runConsumption };
