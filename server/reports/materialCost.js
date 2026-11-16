// Shared base-unit -> costing-UoM conversion, used by both the DOI and Audit
// Loss reports. See doi.js's header comment for the master-data caveat this
// encodes (master_price is per-UoM for roll/sticker materials, per-base-unit
// for the one pieces_per_kg material).

function unitsPerUom(m) {
  return Number(m.meters_per_unit || m.stickers_per_roll || m.pieces_per_kg || 1);
}
function costingUom(m) {
  if (m.meters_per_unit || m.stickers_per_roll) return 'Roll';
  if (m.pieces_per_kg) return 'kg';
  return m.unit;
}
function conversionBasis(m) {
  if (m.meters_per_unit) return 'meters per roll';
  if (m.stickers_per_roll) return 'stickers per roll';
  if (m.pieces_per_kg) return 'pieces per kg';
  return 'n.a.';
}
function unitCostPerUom(m) {
  const price = Number(m.master_price);
  return m.pieces_per_kg ? price * Number(m.pieces_per_kg) : price;
}

// Per CLAUDE.md: pg returns `date` columns as JS Date objects at midnight of
// the *local system time* — correct on Railway (UTC) but one day short when
// read locally on an IST machine. Rather than a JS offset (which would then
// be wrong on Railway), every query here casts date columns to ::text in SQL
// so pg hands back a plain 'YYYY-MM-DD' string, sidestepping the Date object
// entirely. This helper just guards callers that still receive a Date.
function fmtDbDate(d) {
  if (d == null) return null;
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

module.exports = { unitsPerUom, costingUom, conversionBasis, unitCostPerUom, fmtDbDate };
