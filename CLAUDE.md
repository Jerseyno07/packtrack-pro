# PackTrack Pro — Claude Instructions

## Server timezone is always UTC

Railway (and Node.js) run in UTC. `new Date()` always returns UTC time.
IST is UTC+5:30, so midnight IST = 18:30 UTC the *previous* calendar day.

**Rule:** Any code that computes a calendar date for IST must apply the offset:
```js
const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
const dateStr = nowIst.toISOString().slice(0, 10); // correct IST date
```

**Also:** PostgreSQL `date` columns are returned by the pg driver as JS Date objects
at midnight of the local system time. On Railway (UTC), "2026-08-06" comes back as
`2026-08-06T00:00:00.000Z`. But when running locally on an IST machine, it comes back
as `2026-08-05T18:30:00.000Z`. Always apply the IST offset (or cast to `::text` in SQL)
before slicing `.toISOString()`.

This bug has hit us three times:
- `runConsumption()` in consumptionScraper.js — scraping wrong date
- `runAndAcceptConsumption()` in slackReports.js — run_date wrong
- `acceptRun()` in slackReports.js — movement_date in stock_ledger wrong

## Always log changes to git and Obsidian

After every session that makes changes, ensure:
1. All changes are committed and pushed to `main`
2. Obsidian changelog (`~/Documents/ninjacart/PackTrack Pro/05 - Change Log.md`) is updated

If the user ends the session without explicitly asking to log, do it anyway.
Each changelog entry should include: what changed, why, commit hash(es).
