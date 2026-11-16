// Shared email body template — matches the format of the hand-sent reports
// (see the 3 sample "63Ideas Infolabs..." PDFs in the repo root, forwarded by
// the user): a short intro paragraph, a Summary/Detail table or two, then a
// sign-off. Kept as plain HTML tables (no CSS frameworks) since that's what
// Gmail renders from a pasted Google Sheet.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// dateStr: 'YYYY-MM-DD' (already de-timezoned via ::text casts upstream).
function fmtDMonY(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}
function fmtDMon(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}`;
}

// ts: a Date (timestamptz instant — safe to offset, unlike a bare DATE column).
function fmtIstDateTime(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[ist.getUTCMonth()];
  const yyyy = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mi}`;
}

// Indian digit grouping (1586994 -> "15,86,994"), matching the sample emails.
function fmtNum(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtMoney(n) {
  return fmtNum(n, 2);
}

function table(headers, rows) {
  const th = headers.map((h) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f3f3f3;text-align:left;">${h}</th>`).join('');
  const trs = rows
    .map((cells) => `<tr>${cells.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px;">${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;">
    <tr>${th}</tr>
    ${trs}
  </table>`;
}

// guideUrl is intentionally left null for now — the sample emails link
// "this guide" to an internal doc we don't have a URL for yet.
function wrapEmail({ intro, bodyHtml, guideUrl }) {
  const guideLine = guideUrl
    ? ` Refer to <a href="${guideUrl}">this guide</a> for instructions on reading the report.`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:13px;color:#222;">
  <p>Hi all,</p>
  ${intro}
  ${bodyHtml}
  <p>Reach out if there are any queries.</p>
  <p>With regards,<br/>PackTrack Pro (automated)</p>
</div>`;
}

module.exports = { fmtDMonY, fmtDMon, fmtIstDateTime, fmtNum, fmtMoney, table, wrapEmail };
