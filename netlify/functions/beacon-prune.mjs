// Deletes what the funnel beacon keeps once it is 2 years old (parakeet-app docs/BEACON.md §6; the privacy page says
// so): the rows in "app-events" and the hour and day summaries in "app-summaries", which hold install ids too, and
// the daily cap's counters in "app-caps" after 2 days. Netlify runs it every day at midnight UTC; a scheduled function
// gets 30 seconds, so a run stops at its budget and the next one goes on. The work is prune() in beacon.mjs, with its
// tests (tests/unit/beacon-prune.test.mjs).

import { prune } from './beacon.mjs';

export default async function run() {
  const out = await prune();
  console.log(`beacon-prune: ${JSON.stringify(out)}`);
}

export const config = { schedule: '@daily' };
