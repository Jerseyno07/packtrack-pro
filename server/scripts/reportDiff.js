#!/usr/bin/env node
// Usage: npm run report:diff -- <reportKey> <sample.xlsx> <date>
// Generates <reportKey> for <date> and diffs every cell against <sample.xlsx>,
// sheet by sheet, reporting mismatches by sheet/row/column.

require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const { generate } = require('../reports/reportService');

async function loadSheets(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = {};
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.value));
      rows.push(vals);
    });
    sheets[ws.name] = rows;
  }
  return sheets;
}

function cellEqual(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.01;
  if (a instanceof Date || b instanceof Date) return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a ?? '').trim() === String(b ?? '').trim();
}

async function main() {
  const [reportKey, samplePath, date] = process.argv.slice(2);
  if (!reportKey || !samplePath || !date) {
    console.error('Usage: npm run report:diff -- <reportKey> <sample.xlsx> <date>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const fs = require('fs');
  const sampleBuffer = fs.readFileSync(path.resolve(samplePath));

  const generated = await generate(pool, reportKey, { asOfDate: date });
  const genSheets = await loadSheets(generated.attachments[0].buffer);
  const sampleSheets = await loadSheets(sampleBuffer);

  let mismatches = 0;
  const sheetNames = new Set([...Object.keys(genSheets), ...Object.keys(sampleSheets)]);
  for (const sheetName of sheetNames) {
    const gen = genSheets[sheetName];
    const sample = sampleSheets[sheetName];
    if (!gen) { console.log(`[MISSING SHEET] ${sheetName} present in sample, not in generated output`); mismatches++; continue; }
    if (!sample) { console.log(`[EXTRA SHEET] ${sheetName} present in generated output, not in sample`); continue; }
    const maxRows = Math.max(gen.length, sample.length);
    for (let r = 0; r < maxRows; r++) {
      const genRow = gen[r] || [];
      const sampleRow = sample[r] || [];
      const maxCols = Math.max(genRow.length, sampleRow.length);
      for (let c = 0; c < maxCols; c++) {
        if (!cellEqual(genRow[c], sampleRow[c])) {
          console.log(`[${sheetName}] row ${r + 1}, col ${c + 1}: generated=${JSON.stringify(genRow[c])} sample=${JSON.stringify(sampleRow[c])}`);
          mismatches++;
        }
      }
    }
  }

  console.log(`\n${mismatches} mismatch(es) found.`);
  await pool.end();
  process.exit(mismatches ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
