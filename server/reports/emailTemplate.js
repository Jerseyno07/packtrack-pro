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

// Same palette as the xlsx Summary sheets (auditLoss.js / doi.js) — kept
// here too so the email body and the attachment read as one consistent
// design language rather than two different-looking reports.
const COLOR = {
  headerBg: '#2E75B6', headerText: '#FFFFFF',
  titleBg: '#1F4E78', titleText: '#FFFFFF',
  band: '#F2F2F2',
  totalBg: '#D9E1F2',
  bad: '#FFC7CE', badText: '#9C0006',
  warn: '#FFEB9C', warnText: '#9C6500',
  neutral: '#D9D9D9', neutralText: '#595959',
  good: '#C6EFCE', goodText: '#006100',
  border: '#BFBFBF',
};

// opts: { rowBg(rowIdx)->color|null, cellBg(rowIdx,colIdx)->color|null,
//         cellText(rowIdx,colIdx)->color|null, bold(rowIdx)->bool }
// — lets callers color a whole row (status/result) or just one cell
// (e.g. only the Loss Value column) without the table layout itself caring
// what the data means.
function table(headers, rows, opts = {}) {
  const th = headers
    .map((h) => `<th style="border:1px solid ${COLOR.border};padding:6px 10px;background:${COLOR.headerBg};color:${COLOR.headerText};text-align:left;font-weight:600;">${h}</th>`)
    .join('');
  const trs = rows
    .map((cells, rowIdx) => {
      const rowBg = opts.rowBg ? opts.rowBg(rowIdx) : (rowIdx % 2 === 1 ? COLOR.band : '#FFFFFF');
      const isBold = opts.bold ? opts.bold(rowIdx) : false;
      const tds = cells
        .map((c, colIdx) => {
          const cellBg = opts.cellBg ? opts.cellBg(rowIdx, colIdx) : null;
          const cellText = opts.cellText ? opts.cellText(rowIdx, colIdx) : null;
          const bg = cellBg || rowBg;
          const style = [
            `border:1px solid ${COLOR.border}`,
            'padding:5px 10px',
            `background:${bg}`,
            cellText ? `color:${cellText}` : '',
            isBold ? 'font-weight:600' : '',
          ].filter(Boolean).join(';');
          return `<td style="${style}">${c}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12.5px;margin:8px 0 16px 0;">
    <tr>${th}</tr>
    ${trs}
  </table>`;
}

function sectionTitle(text) {
  return `<p style="background:${COLOR.titleBg};color:${COLOR.titleText};padding:8px 12px;margin:20px 0 0 0;font-weight:700;font-size:13.5px;border-radius:4px 4px 0 0;">${text}</p>`;
}

function wrapEmail({ intro, bodyHtml, guideUrl }) {
  const guideLine = guideUrl
    ? ` Refer to <a href="${guideUrl}" style="color:#1155CC;">this guide</a> for instructions on reading the report.`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:13.5px;color:#222;line-height:1.5;">
  <p>Hi all,</p>
  ${intro}${guideLine ? `<p>${guideLine.trim()}</p>` : ''}
  ${bodyHtml}
  <p>Reach out if there are any queries.</p>
  <p>With regards,<br/>PackTrack Pro (automated)</p>
</div>`;
}

const GUIDE_URL = 'https://docs.google.com/document/d/1riW_vy0YiOjHdLmnpQWBq3iKJzy33S1ST1vkGcUaM-c/edit?tab=t.fexbgas9b0ce#heading=h.74w1uubfg19f';

// dateStr: 'YYYY-MM-DD' -> "Nov 20th" (ordinal suffix, month-first — for
// filenames, e.g. "Nov 20th - Audit Loss Report.xlsx").
function fmtMonDOrdinal(dateStr) {
  const [, m, dStr] = dateStr.split('-');
  const day = Number(dStr);
  const suffix = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd'
    : 'th';
  return `${MONTHS[Number(m) - 1]} ${day}${suffix}`;
}

module.exports = { fmtDMonY, fmtDMon, fmtIstDateTime, fmtNum, fmtMoney, fmtMonDOrdinal, table, sectionTitle, wrapEmail, COLOR, GUIDE_URL };
