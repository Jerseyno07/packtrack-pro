const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRow, varianceStatus, dayBucket } = require('../reports/variance');

const PCS_MATERIAL = { code: 'LDPE-0912', name: 'LDPE 9x12', category: 'LDPE', unit: 'Pcs', master_price: '1.45' };
const ROLL_MATERIAL = { code: 'CLNG-01', name: 'CLING_WRAPPING', category: 'Cling Wrap', unit: 'Roll', master_price: '410.64', meters_per_unit: '1000' };

test('varianceStatus: no consumption vs no issuance vs over/under', () => {
  assert.equal(varianceStatus(100, 0), 'Issued – no consumption captured');
  assert.equal(varianceStatus(0, 100), 'Consumed – not issued in period');
  assert.equal(varianceStatus(100, 40), 'Over-issued');
  assert.equal(varianceStatus(40, 100), 'Under-issued');
});

test('dayBucket: zero avg consumption always buckets as No Consumption', () => {
  assert.equal(dayBucket(1000, 0), 'No Consumption');
});

test('dayBucket: thresholds at 3 and 7 days', () => {
  assert.equal(dayBucket(30, 10), '<=3 days'); // 3 days exactly
  assert.equal(dayBucket(70, 10), '<=7 days'); // 7 days exactly
  assert.equal(dayBucket(71, 10), '>7 days');
});

test('computeRow: over-issued pieces material, value and bucket', () => {
  // Issued 100, consumed 40 over the day; rolling week averages 10/day.
  const row = computeRow(PCS_MATERIAL, 100, 40, [10, 10, 10, 10, 10, 10, 10]);
  assert.equal(row.issuedQty, 100);
  assert.equal(row.consumedQty, 40);
  assert.equal(row.varianceQty, 60);
  assert.equal(row.value, 87); // 60 * 1.45
  assert.equal(row.status, 'Over-issued');
  assert.equal(row.avgDailyConsumption, 10);
  assert.equal(row.absVarianceDays, 6);
  assert.equal(row.bucket, '<=7 days');
});

test('computeRow: roll material converts base units (meters) to Roll UoM', () => {
  const row = computeRow(ROLL_MATERIAL, 3000, 1000, [0, 0, 0, 0, 0, 0, 0]); // 3000m issued, 1000m consumed
  assert.equal(row.issuedQty, 3); // 3 rolls
  assert.equal(row.consumedQty, 1); // 1 roll
  assert.equal(row.varianceQty, 2);
  assert.equal(row.unitCost, 410.64);
  assert.equal(row.value, 821.28);
  assert.equal(row.bucket, 'No Consumption'); // rolling window had zero consumption
});

test('computeRow: issued zero, consumed something -> no % of issued', () => {
  const row = computeRow(PCS_MATERIAL, 0, 50, [5, 5, 5, 5, 5, 5, 5]);
  assert.equal(row.absVariancePct, null);
  assert.equal(row.status, 'Consumed – not issued in period');
});
