const test = require('node:test');
const assert = require('node:assert/strict');
const { getData } = require('../reports/doi');

test('no audit posted yet -> empty rows, audit null, no throw', async () => {
  const fakePool = { query: async () => ({ rows: [] }) };
  const data = await getData(fakePool, { asOfDate: '2026-11-01' });
  assert.equal(data.audit, null);
  assert.deepEqual(data.rows, []);
  assert.deepEqual(data.summary, []);
});
