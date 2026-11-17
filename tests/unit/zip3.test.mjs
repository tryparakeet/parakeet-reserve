// The ZIP3-to-state table (netlify/functions/zip3-states.json, from USPS's ZIP Code prefix ranges by state) and
// stateOfZip3(): the brief's four (752 TX, 100 NY, 606 IL, 900 CA), the odd ones, the prefixes no state has, and the
// table's own shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { stateOfZip3, FIFTY_STATES } from '../../netlify/functions/beacon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const table = JSON.parse(readFileSync(join(ROOT, 'netlify', 'functions', 'zip3-states.json'), 'utf8'));

test('the brief\'s four: 752 is Texas, 100 New York, 606 Illinois, 900 California', () => {
  assert.equal(stateOfZip3('752'), 'TX');
  assert.equal(stateOfZip3('100'), 'NY');
  assert.equal(stateOfZip3('606'), 'IL');
  assert.equal(stateOfZip3('900'), 'CA');
});

test('the prefixes out of their state\'s block, DC, the territories and military mail', () => {
  const cases = {
    '005': 'NY', '006': 'PR', '007': 'PR', '008': 'VI', '009': 'PR', '055': 'MA', '090': 'AE', '099': 'AE', '200': 'DC',
    '201': 'VA', '205': 'DC', '206': 'MD', '340': 'AA', '398': 'GA', '569': 'DC', '733': 'TX', '739': 'OK', '885': 'TX',
    '888': 'DC', '962': 'AP', '966': 'AP', '967': 'HI', '969': 'GU', '995': 'AK', '999': 'AK', '010': 'MA', '039': 'ME',
    '063': 'CT', '834': 'ID', '865': 'AZ', '889': 'NV'
  };
  for (const [zip3, state] of Object.entries(cases)) assert.equal(stateOfZip3(zip3), state, zip3);
});

test('a prefix no state has, or a value that is not three digits, has no state', () => {
  for (const zip3 of ['000', '001', '004', '269', '428', '429', '529', '568', '578', '579', '589', '659', '694', '699', '715', '732', '817', '819', '839', '848', '849', '866', '869', '886', '887', '899']) {
    assert.equal(stateOfZip3(zip3), null, zip3);
  }
  for (const v of ['75', '7520', '75201', 752, null, undefined, 'abc', ' 752', '75a']) assert.equal(stateOfZip3(v), null, String(v));
});

test('the table: sorted ranges of three digits that never overlap, every state and DC in it, USPS named as the source', () => {
  assert.match(table.about, /USPS/);
  let previous = -1;
  const codes = new Set();
  for (const range of table.ranges) {
    assert.equal(range.length, 3, JSON.stringify(range));
    const [first, last, state] = range;
    assert.match(first, /^\d{3}$/);
    assert.match(last, /^\d{3}$/);
    assert.match(state, /^[A-Z]{2}$/);
    assert.ok(Number(first) <= Number(last), `${first}-${last}`);
    assert.ok(Number(first) > previous, `${first} comes after ${previous} and does not overlap`);
    previous = Number(last);
    codes.add(state);
  }
  assert.equal(FIFTY_STATES.length, 50);
  for (const s of FIFTY_STATES) assert.ok(codes.has(s), `${s} has a range`);
  assert.deepEqual([...codes].filter((c) => !FIFTY_STATES.includes(c)).sort(), ['AA', 'AE', 'AP', 'DC', 'GU', 'PR', 'VI']);
});
