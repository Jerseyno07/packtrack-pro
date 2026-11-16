// Bangalore pilot facility scope for the PM Store reports engine.
// Mirrors cron/slackReports.js's CC_FACILITIES/FC_FACILITIES (not imported from
// there since those aren't exported and that module is out of scope to touch) —
// keep in sync if the pilot facility list changes.
// ponytail: duplicated list, not a shared import — resync by hand if the pilot scope changes.

const PM_STORE_CODE = 'CS-001';
const FC_FACILITY_CODES = ['9382'];
const CC_FACILITY_CODES = ['3202', '3404', '3949', '9924', '9948', '10013', '10023', '10070', '10147', '10152'];
const BLR_FACILITY_CODES = [...FC_FACILITY_CODES, ...CC_FACILITY_CODES];

// "Previous ops day" cutoff — single place to change if the definition ever differs
// from "yesterday, IST calendar date".
function previousOpsDay(asOfDate) {
  const base = asOfDate ? new Date(`${asOfDate}T00:00:00+05:30`) : new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

module.exports = { PM_STORE_CODE, FC_FACILITY_CODES, CC_FACILITY_CODES, BLR_FACILITY_CODES, previousOpsDay };
