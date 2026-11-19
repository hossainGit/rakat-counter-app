import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.js';
import { DETECTOR_CONFIG as CFG } from '../src/config.js';
import { textured, darkenFraction, W, H } from './helpers.js';

function frameOf(grid) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < grid.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = grid[i]; rgba[i * 4 + 3] = 255; }
  return { rgba, w: W, h: H };
}
function rig() {
  let t = 0, grid = textured(); const events = [];
  const source = { start: async () => {}, stop() {}, readFrame: () => frameOf(grid), lock: async () => ({ locked: false }) };
  const engine = createEngine({ source, cfg: CFG, onEvent: e => events.push(e), now: () => t });
  const runMs = (ms, g) => { if (g) grid = g; for (let e = 0; e < ms; e += 66) { t += 66; engine.tick(); } };
  return { engine, events, runMs, of: type => events.filter(e => e.type === type) };
}

test('calibrates then counts one sujood', () => {
  const r = rig();
  r.runMs(3000, textured());
  assert.equal(r.of('calibrated').length, 1);
  assert.equal(r.of('calibrated')[0].quality, 'ok');
  r.runMs(1200, darkenFraction(textured(), 0.75, 60));
  r.runMs(800, textured());
  assert.deepEqual(r.of('count').map(e => e.sujood), [1]);
});
test('lighting switch while empty rescales the baseline, no count', () => {
  const r = rig();
  r.runMs(3000, textured());
  r.runMs(2000, textured().map(v => Math.min(255, v * 1.6)));
  assert.equal(r.of('count').length, 0);
  assert.equal(r.of('relit').length, 1);
  assert.ok(r.of('tick').at(-1).coverage < 0.05);
});
test('recalibrate keeps the count', () => {
  const r = rig();
  r.runMs(3000, textured());
  r.engine.setSujood(3); r.engine.recalibrate();
  r.runMs(3000, textured());
  assert.equal(r.of('tick').at(-1).sujood, 3);
});
test('resetCount sets sujood to 0', () => {
  const r = rig();
  r.runMs(3000, textured()); r.engine.setSujood(5); r.engine.resetCount(); r.runMs(100);
  assert.equal(r.of('tick').at(-1).sujood, 0);
});

// --- final-review fixes ---
import { fill, N } from './helpers.js';
function rigWith(first) {
  let t = 0, grid = first, nullFrames = false; const events = [];
  const source = { start: async () => {}, stop() {}, readFrame: () => (nullFrames ? null : frameOf(grid)), lock: async () => ({ locked: false }) };
  const engine = createEngine({ source, cfg: CFG, onEvent: e => events.push(e), now: () => t });
  const runMs = (ms, g) => { if (g) grid = g; for (let e = 0; e < ms; e += 66) { t += 66; engine.tick(); } };
  return { engine, events, runMs, of: type => events.filter(e => e.type === type), freeze: v => (nullFrames = v) };
}
const lit = g => g.map(v => Math.min(255, v * 1.6));
test('#1 dark featureless room, light switched on → no count', () => {
  const r = rigWith(fill(N, 8));
  r.runMs(3000, fill(N, 8)); r.runMs(5000, fill(N, 80));
  assert.equal(r.of('count').length, 0);
  assert.ok(r.of('tick').at(-1).coverage < 0.05);
});
test('#1 light switched on during the sitting still counts both sujood', () => {
  const r = rigWith(textured());
  r.runMs(3000, textured());
  r.runMs(1200, darkenFraction(textured(), 0.75, 60));
  r.runMs(2000, lit(textured()));
  r.runMs(1200, darkenFraction(lit(textured()), 0.75, 60));
  r.runMs(1000, lit(textured()));
  assert.deepEqual(r.of('count').map(e => e.sujood), [1, 2]);
});
test('#2 light switch rescales instantly: a sujood right after it counts', () => {
  const r = rigWith(textured());
  r.runMs(3000, textured());
  r.runMs(1500, lit(textured()));
  r.runMs(1200, darkenFraction(lit(textured()), 0.75, 60));
  r.runMs(800, lit(textured()));
  assert.deepEqual(r.of('count').map(e => e.sujood), [1]);
  assert.equal(r.of('calibrating').length, 1); // only the initial one — no blind recalibration
});
test('#4 partial cover below enter is not absorbed into the baseline', () => {
  const r = rigWith(textured());
  r.runMs(3000, textured());
  r.runMs(60000, darkenFraction(textured(), 0.5, 60));
  assert.ok(r.of('tick').at(-1).coverage > 0.45);
});
test('#6 frames stopping for 2 s emit one stalled event', () => {
  const r = rigWith(textured());
  r.runMs(3000, textured()); r.freeze(true); r.runMs(5000);
  assert.equal(r.of('stalled').length, 1);
});
test('#8 quality is re-classified right after a relight rescale', () => {
  const r = rigWith(textured());
  r.runMs(3000, textured().map(v => v * 0.1));       // calibrate in a dark room
  assert.equal(r.of('calibrated')[0].quality, 'too-dark');
  r.runMs(1500, textured());                          // light on
  assert.equal(r.of('quality').at(-1)?.quality, 'ok');
});
