const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRow } = require('../reports/doi');

const PCS_MATERIAL = { code: 'LDPE-0912', name: 'LDPE 9x12', category: 'LDPE', unit: 'Pcs', master_price: '1.45' };
const ROLL_MATERIAL = { code: 'CLNG-01', name: 'CLING_WRAPPING', category: 'Cling Wrap', unit: 'Roll', master_price: '410.64', meters_per_unit: '1000' };
const KG_MATERIAL = { code: 'BTPR-01', name: 'Butter Paper', category: 'Paper', unit: 'Pcs', master_price: '198.24', pieces_per_kg: '350' };

test('zero avg issue -> "No movement", no divide-by-zero', () => {
  const row = computeRow(PCS_MATERIAL, 100, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(row.avgDailyIssue, 0);
  assert.equal(row.doi, null);
  assert.equal(row.status, 'No movement');
});

test('stock-out: zero inventory but some issues -> "Stock-out"', () => {
  const row = computeRow(PCS_MATERIAL, 0, [10, 10, 0, 0, 0, 0, 0]);
  assert.equal(row.inventoryQty, 0);
  assert.equal(row.status, 'Stock-out');
});

test('critical / low / ok bucket thresholds', () => {
  // avgDailyIssue = 10/7 ≈ 1.4286/day
  const critical = computeRow(PCS_MATERIAL, 4, [10, 0, 0, 0, 0, 0, 0]); // doi ≈ 2.8 -> Critical
  assert.equal(critical.status, 'Critical (≤3d)');

  const low = computeRow(PCS_MATERIAL, 7, [10, 0, 0, 0, 0, 0, 0]); // doi = 4.9 -> Low
  assert.equal(low.status, 'Low (≤7d)');

  const ok = computeRow(PCS_MATERIAL, 100, [10, 0, 0, 0, 0, 0, 0]); // doi = 70 -> OK
  assert.equal(ok.status, 'OK');
});

test('roll material: master_price is already per-UoM (no multiply)', () => {
  const row = computeRow(ROLL_MATERIAL, 2000, [0, 0, 0, 0, 0, 0, 0]); // 2000 meters = 2 rolls
  assert.equal(row.inventoryQty, 2);
  assert.equal(row.unitCost, 410.64);
  assert.equal(row.inventoryValue, 821.28);
});

test('pieces_per_kg material: master_price is already per-UoM (no multiply)', () => {
  const row = computeRow(KG_MATERIAL, 700, [0, 0, 0, 0, 0, 0, 0]); // 700 pieces = 2 kg
  assert.equal(row.inventoryQty, 2);
  assert.equal(row.unitCost, 198.24);
  assert.equal(row.inventoryValue, 396.48);
});
