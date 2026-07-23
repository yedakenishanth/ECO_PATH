#!/usr/bin/env node
/**
 * Minimal, dependency-free smoke tests for EcoPath's pure logic
 * (level thresholds, points math, CO2 math in app.js).
 *
 * Deliberately avoids a test framework / npm install to match the
 * project's "no build step" philosophy. Run with:
 *
 *   node test.js
 *
 * app.js is written for the browser (it touches `document`,
 * `localStorage`, `navigator`), so this harness runs it inside a
 * Node `vm` context with minimal stubs for those globals, then reads
 * out the exported functions to exercise directly.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---- Minimal browser-shaped stubs so app.js's top-level code (which
// touches the DOM/localStorage on load) doesn't throw when evaluated
// outside a browser. ----
function makeFakeElement() {
  const el = {
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    style: {},
    dataset: {},
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {},
    querySelector() { return makeFakeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    getElementById() { return makeFakeElement(); },
  };
  return el;
}

const memoryStorage = {};
const fakeLocalStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(memoryStorage, k) ? memoryStorage[k] : null),
  setItem: (k, v) => { memoryStorage[k] = String(v); },
  removeItem: (k) => { delete memoryStorage[k]; },
};

const sandbox = {
  console,
  document: {
    getElementById: () => makeFakeElement(),
    querySelectorAll: () => [],
    createElement: () => makeFakeElement(),
  },
  localStorage: fakeLocalStorage,
  navigator: { geolocation: undefined },
  window: {},
  fetch: () => Promise.reject(new Error('network disabled in test harness')),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  L: undefined, // Leaflet — unused by the functions under test
};
sandbox.window = sandbox; // so `window.X` inside app.js resolves sanely
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'app.js' });

const { getLevel, levelPct, logTrip } = sandbox;
assert(typeof getLevel === 'function', 'getLevel should be exported from app.js scope');
assert(typeof levelPct === 'function', 'levelPct should be exported from app.js scope');
assert(typeof logTrip === 'function', 'logTrip should be exported from app.js scope');

// ---- Test runner ----
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

console.log('getLevel()');
test('0 points is level 1 (Green Newcomer)', () => {
  const lv = getLevel(0);
  assert.strictEqual(lv.n, 1);
  assert.strictEqual(lv.title, 'Green Newcomer');
});
test('exactly at a threshold rounds up to that level', () => {
  assert.strictEqual(getLevel(500).n, 2);
  assert.strictEqual(getLevel(1000).n, 3);
});
test('one point below a threshold stays at the lower level', () => {
  assert.strictEqual(getLevel(499).n, 1);
});
test('points beyond the top threshold cap at the max level', () => {
  assert.strictEqual(getLevel(50000).n, 6);
  assert.strictEqual(getLevel(50000).title, 'Eco Legend');
});
test('level number and progress-bar band agree (regression: was off-by-one)', () => {
  // Before the fix, 750pts showed a 100%-full bar while still labeled Level 1.
  const lv = getLevel(750);
  assert.strictEqual(lv.n, 2, 'should already be Level 2 at 750pts');
  assert.ok(levelPct(750) < 100, 'progress bar should not read 100% mid-level');
});

console.log('levelPct()');
test('0% at the start of a level', () => {
  assert.strictEqual(levelPct(0), 0);
});
test('progress is near 100% just before crossing into the next level', () => {
  assert.ok(levelPct(999) >= 99, `expected ~100%, got ${levelPct(999)}`);
});
test('progress resets to 0% right as the next level starts', () => {
  assert.strictEqual(levelPct(1000), 0);
});
test('50% halfway through a level band', () => {
  // Level 1 band is 0-500
  assert.strictEqual(levelPct(250), 50);
});
test('never exceeds 100 even at the max level', () => {
  assert.ok(levelPct(999999) <= 100);
});

console.log('logTrip() — points & CO2 math');
test('walking 10km emits 0 CO2 and awards positive credits', () => {
  const res = logTrip('Home', 'Work', 10, 'walk');
  assert.strictEqual(res.saved > 0, true);
  assert.strictEqual(res.pts >= 10, true);
});
test('driving a car saves ~0 CO2 vs itself (same mode as baseline)', () => {
  const res = logTrip('Home', 'Work', 10, 'car');
  assert.ok(res.saved < 0.01, `expected ~0 kg saved, got ${res.saved}`);
});
test('cycling saves more CO2 than the bus over the same distance', () => {
  const bike = logTrip('A', 'B', 10, 'bike');
  const bus = logTrip('A', 'B', 10, 'bus');
  assert.ok(bike.saved > bus.saved, `bike should save more than bus (${bike.saved} vs ${bus.saved})`);
});
test('every logged trip earns at least the 10-point floor', () => {
  const res = logTrip('A', 'B', 0.001, 'car'); // negligible distance
  assert.strictEqual(res.pts >= 10, true);
});
test('route bonuses (shortest/low_congestion/shared) add +10 each', () => {
  const base = logTrip('A', 'B', 10, 'bus', []);
  const withBonuses = logTrip('A', 'B', 10, 'bus', ['shortest', 'low_congestion', 'shared']);
  assert.strictEqual(withBonuses.pts, base.pts + 30);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
