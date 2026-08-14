require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BATCH_IDS = [16, 17];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delLines = await client.query(`DELETE FROM indent_lines WHERE batch_id = ANY($1)`, [BATCH_IDS]);
    const delBatches = await client.query(`DELETE FROM indent_batches WHERE id = ANY($1)`, [BATCH_IDS]);
    await client.query('COMMIT');
    console.log(`Done. Deleted ${delLines.rowCount} indent lines and ${delBatches.rowCount} batch record(s).`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
})();
