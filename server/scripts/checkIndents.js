require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT ib.id, ib.batch_ref, ib.source_filename, ib.indent_date, ib.status,
         ib.total_rows, ib.valid_rows,
         TO_CHAR(ib.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI:SS AM') AS created_ist,
         (SELECT COUNT(*) FROM indent_lines il WHERE il.batch_id = ib.id) AS line_count,
         (SELECT COUNT(*) FROM indent_lines il WHERE il.batch_id = ib.id AND il.status != 'PENDING') AS issued_lines
  FROM indent_batches ib
  ORDER BY ib.id DESC LIMIT 10
`).then(r => {
  r.rows.forEach(row =>
    console.log(`ID ${row.id} | ${row.created_ist} | ${row.status.padEnd(18)} | ${row.line_count} lines (${row.issued_lines} issued) | ${row.source_filename}`)
  );
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
