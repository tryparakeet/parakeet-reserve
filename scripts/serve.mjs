// Manual checks against the harness: the page, the function and the rewrites on http://localhost:PORT
// with an in-memory store (nothing is written anywhere; rows are printed on Ctrl-C).
//
//   npm run serve                      -> port 8788, ADMIN_KEY from the environment or "dev"
//   PORT=9000 ADMIN_KEY=abc npm run serve
//   node scripts/serve.mjs --port 9000 --key abc
//
// The clock is the real one (the function's prestart / closed-hour logic uses the current time), so a
// visit today lands in excluded.prestart until GATE_START, exactly as it would on the live site.

import { startHarness } from '../tests/helpers/harness.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const port = Number(flag('--port', process.env.PORT || 8788));
const adminKey = flag('--key', process.env.ADMIN_KEY || 'dev');

const harness = await startHarness({ port, adminKey, now: Date.now, quiet: false });
console.log(`Parakeet reserve page (harness)  ${harness.url}`);
console.log(`admin summary                    ${harness.url}/admin?key=${adminKey}`);
console.log(`typed link                       ${harness.url}/go`);
console.log(`paid link                        ${harness.url}/?utm_source=tiktok&utm_medium=paid&utm_campaign=gate0&utm_content=fri23`);
console.log(`smoke link                       ${harness.url}/?utm_source=own&utm_campaign=smoke`);
console.log('Ctrl-C prints the rows received and stops.');

const stop = async () => {
  const rows = harness.blobs.rows('events');
  console.log(`\n${rows.length} row(s) received`);
  for (const r of rows) console.log(JSON.stringify(r));
  await harness.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
