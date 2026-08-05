// One-off test — directly uploads a test CSV to Slack to verify bot token + channel ID.
// Run from project root: node server/scripts/testSlack.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const token = process.env.SLACK_BOT_TOKEN;
const channelId = process.env.SLACK_CHANNEL_ID;

console.log('SLACK_BOT_TOKEN set:', !!token);
console.log('SLACK_CHANNEL_ID:', channelId || '(not set)');

if (!token || !channelId) { console.error('Missing env vars — check server/.env'); process.exit(1); }

const csv = 'Facility,Material,Unit,Qty\n"Test Facility (BLR)","TAPE-25MM","rolls",250\n"Test Facility (BLR)","BOX-L","units",100\n';

(async () => {
  const byteLength = Buffer.byteLength(csv, 'utf8');

  console.log('\nStep 1: requesting upload URL...');
  const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ filename: 'test-report.csv', length: byteLength }).toString(),
  });
  const urlData = await urlRes.json();
  console.log('Response:', JSON.stringify(urlData));
  if (!urlData.ok) { console.error('Failed:', urlData.error); process.exit(1); }

  console.log('\nStep 2: uploading file content...');
  const upRes = await fetch(urlData.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
  console.log('Upload HTTP status:', upRes.status);

  console.log('\nStep 3: completing upload and sharing to channel...');
  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ id: urlData.file_id, title: 'Test CSV Upload' }], channel_id: channelId }),
  });
  const completeData = await completeRes.json();
  console.log('Response:', JSON.stringify(completeData));

  if (completeData.ok) {
    console.log('\nSuccess — check #packtrack-reports in Slack.');
  } else {
    console.error('\nFailed:', completeData.error);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
