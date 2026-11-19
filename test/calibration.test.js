import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalibrator } from '../src/calibrator.js';
import { classifyQuality } from '../src/quality.js';
import { buildBaseline } from '../src/baseline.js';
import { DETECTOR_CONFIG as CFG } from '../src/config.js';
import { fill, noisy, N } from './helpers.js';

test('stable 1.5 s + 1 s collect → done with baseline', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0; t <= 2700; t += 66) r = c.feed(fill(N, 80), t);
  assert.equal(r.status, 'done'); assert.ok(Math.abs(r.baseline.globalMean - 80) < 0.5);
});
test('instability during collecting restarts wait', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0; t <= 2000; t += 66) r = c.feed(fill(N, 80), t);
  assert.equal(r.status, 'collecting');
  r = c.feed(fill(N, 160), 2066); assert.equal(r.status, 'waiting');
});
test('unstable 21 s → still waiting, timedOut', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0, i = 0; t <= 21000; t += 66, i++) r = c.feed(fill(N, i % 2 ? 50 : 150), t);
  assert.equal(r.status, 'waiting'); assert.equal(r.timedOut, true);
});
test('restart begins a fresh calibration', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0; t <= 2700; t += 66) r = c.feed(fill(N, 80), t);
  c.restart(3000); r = c.feed(fill(N, 80), 3066);
  assert.equal(r.status, 'waiting');
});
test('quality classes', () => {
  const q = m => classifyQuality(buildBaseline([fill(N, m), fill(N, m)]), CFG);
  assert.equal(q(100), 'ok'); assert.equal(q(30), 'low'); assert.equal(q(8), 'too-dark');
  assert.equal(classifyQuality(buildBaseline([noisy(80, 30, 1), noisy(80, 30, 2), noisy(80, 30, 3)]), CFG), 'low');
});

test('box-averaged noise of 4 is low light (#8)', () => {
  const b = buildBaseline([fill(N, 100), fill(N, 100)]); b.noise.fill(4);
  assert.equal(classifyQuality(b, CFG), 'low');
});
