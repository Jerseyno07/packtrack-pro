#!/usr/bin/env node
// One-off SQL runner against this project's DATABASE_URL — for migrations,
// grants, and ad-hoc data corrections that don't fit a checked-in migration
// file. Usage:
//   node .claude/scripts/run-sql.js path/to/file.sql
//   node .claude/scripts/run-sql.js -e "SELECT 1"
const path = require('path');
const fs = require('fs');
// dotenv/pg live in server/node_modules, not here — resolve explicitly.
const serverDir = path.join(__dirname, '..', '..', 'server');
require(path.join(serverDir, 'node_modules', 'dotenv')).config({ path: path.join(serverDir, '.env') });
const { Pool } = require(path.join(serverDir, 'node_modules', 'pg'));

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node run-sql.js <file.sql> | -e "<SQL>"');
  process.exit(1);
}
const sql = arg === '-e' ? process.argv[3] : fs.readFileSync(arg, 'utf8');
if (!sql) {
  console.error('No SQL given');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(sql)
  .then((r) => {
    const result = Array.isArray(r) ? r[r.length - 1] : r;
    console.log(`OK${result.rowCount != null ? ` (${result.rowCount} rows affected)` : ''}`);
    if (result.rows?.length) console.log(JSON.stringify(result.rows, null, 2));
    return pool.end();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
