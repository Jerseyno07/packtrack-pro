// Shared base-unit -> costing-UoM conversion, used by both the DOI and Audit
// Loss reports. materials.master_price is per *costing UoM* for every
// material (confirmed for roll/sticker materials from day one, and now
// confirmed for the one pieces_per_kg material too — Butter Paper's
// master_price was 0.57/piece when this module was first written, but a
// later bulk price upload (server/index.js's /materials/price-upload,
// which writes the uploaded "Cost per UOM mentioned" value verbatim) set it
// to 198.24/kg. unitCostPerUom() used to re-multiply that by pieces_per_kg,
// producing a 350x-inflated cost (₹69,384/kg) — found live via a DOI report
// showing an implausible ~2 crore inventory value. master_price is simply
// never multiplied by anything here now; the price-upload tool is the
// authority on what unit it's quoted in, and it always writes per-UoM.

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
  return Number(m.master_price);
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
