require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT id, run_date, scraped_from, scraped_to, status, deducted_lines, facility_filter FROM consumption_runs ORDER BY id DESC LIMIT 10')
  .then(r => { r.rows.forEach(row => console.log(JSON.stringify(row))); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
