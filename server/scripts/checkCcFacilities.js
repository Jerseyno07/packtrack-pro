// Fetches query 53767 and prints the authoritative FacilityId → FacilityName + City mapping.
// Run: node server/scripts/checkCcFacilities.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { parse: parseCsv } = require('csv-parse');
const { Readable } = require('stream');

const base   = process.env.CONSUMPTION_DASHBOARD_URL;
const apiKey = process.env.CONSUMPTION_DASHBOARD_API_KEY;
const ccQid  = process.env.CONSUMPTION_CC_QUERY_ID;
const hdrs   = { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' };

const today = new Date();
const yest  = new Date(today); yest.setDate(yest.getDate() - 1);
const from  = yest.toISOString().slice(0, 10);

async function fetchCsv(url) {
  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Promise((resolve, reject) => {
    const rows = [];
    const parser = parseCsv({ columns: true, skip_empty_lines: true, cast: false });
    parser.on('readable', () => { let r; while ((r = parser.read()) !== null) rows.push(r); });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    Readable.fromWeb(res.body).pipe(parser);
  });
}

(async () => {
  console.log(`Fetching CC query ${ccQid} for ${from}…`);
  const triggerRes = await fetch(`${base}/api/queries/${ccQid}/results`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ parameters: { 'from date': from, 'to date': from }, max_age: 0 }),
  });
  const triggerData = await triggerRes.json();

  let rows;
  if (triggerData.query_result) {
    rows = await fetchCsv(`${base}/api/query_results/${triggerData.query_result.id}.csv`);
  } else {
    const jobId = triggerData.job?.id;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const job = (await (await fetch(`${base}/api/jobs/${jobId}`, { headers: hdrs })).json()).job;
      if (job.status === 3) { rows = await fetchCsv(`${base}/api/query_results/${job.query_result_id}.csv`); break; }
      if (job.status === 4) throw new Error(`Job failed: ${job.error}`);
      process.stdout.write('.');
    }
    console.log();
  }

  // Build unique FacilityId → {name, city} map
  const map = new Map();
  for (const r of rows) {
    const id   = String(r['FromFacilityId'] ?? '').trim();
    const name = String(r['FacilityName']   ?? '').trim();
    const city = String(r['City']           ?? '').trim();
    if (id && !map.has(id)) map.set(id, { name, city });
  }

  console.log('\nFacilityId   | City                 | FacilityName');
  console.log('-------------|----------------------|----------------------------');
  for (const [id, { name, city }] of [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`${id.padEnd(13)}| ${city.padEnd(21)}| ${name}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
