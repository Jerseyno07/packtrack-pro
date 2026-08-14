// Rolls back all stock_ledger entries and consumption run data for completed runs.
// Run: node server/scripts/rollbackNightlyRun.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const runsRes = await pool.query(
    `SELECT id, run_date, status, facility_filter, deducted_lines
     FROM consumption_runs
     WHERE status IN ('COMPLETED','RUNNING','PENDING_REVIEW')
     ORDER BY id`
  );

  if (runsRes.rows.length === 0) {
    console.log('No consumption runs found. Nothing to rollback.');
    return pool.end();
  }

  const runIds = runsRes.rows.map(r => r.id);
  console.log(`Found ${runsRes.rows.length} run(s) to remove:`);
  runsRes.rows.forEach(r => {
    const d = new Date(r.run_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
    console.log(`  Run ${r.id} | ${d} IST | status: ${r.status} | lines: ${r.deducted_lines} | filter: ${r.facility_filter ?? 'all'}`);
  });

  const ledgerRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM stock_ledger WHERE ref_table = 'consumption_runs' AND ref_id = ANY($1)`,
    [runIds]
  );
  console.log(`\nLedger entries to delete: ${ledgerRes.rows[0].cnt}`);

  const linesRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM consumption_run_lines WHERE run_id = ANY($1)`,
    [runIds]
  );
  console.log(`Run lines to delete:      ${linesRes.rows[0].cnt}`);

  console.log('\nExecuting rollback in transaction…');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delLines  = await client.query(`DELETE FROM consumption_run_lines WHERE run_id = ANY($1)`, [runIds]);
    const delLedger = await client.query(`DELETE FROM stock_ledger WHERE ref_table = 'consumption_runs' AND ref_id = ANY($1)`, [runIds]);
    const delRuns   = await client.query(`DELETE FROM consumption_runs WHERE id = ANY($1)`, [runIds]);
    await client.query('COMMIT');

    console.log('\nDone ✓');
    console.log(`  ${delLines.rowCount} run lines deleted`);
    console.log(`  ${delLedger.rowCount} ledger entries deleted`);
    console.log(`  ${delRuns.rowCount} consumption run(s) deleted`);
    console.log('\nStock ledger is clean.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Rollback FAILED — transaction aborted:', e.message);
  } finally {
    client.release();
    pool.end();
  }
})().catch(e => { console.error(e.message); pool.end(); });
