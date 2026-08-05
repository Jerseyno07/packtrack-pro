require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT u.email, u.role, w.code, w.name
  FROM users u
  JOIN user_warehouses uw ON uw.user_id = u.id
  JOIN warehouses w ON w.id = uw.warehouse_id
  WHERE u.role IN ('CC_EXEC','FC_EXEC')
  ORDER BY u.role, w.code
`).then(r => {
  console.log('Email'.padEnd(42) + 'Code'.padEnd(8) + 'Name');
  console.log('-'.repeat(80));
  r.rows.forEach(row => console.log((row.email||'').padEnd(42) + (row.code||'').padEnd(8) + (row.name||'')));
  console.log(`\nTotal: ${r.rows.length} users`);
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
