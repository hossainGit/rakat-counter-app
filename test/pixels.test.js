import test from 'node:test';
import assert from 'node:assert/strict';
import { downscaleToLuma, frameDiff } from '../src/grid.js';
import { buildBaseline, adaptBaseline } from '../src/baseline.js';
import { computeCoverage } from '../src/coverage.js';
import { DETECTOR_CONFIG as CFG } from '../src/config.js';
import { textured, fill, noisy, darkenFraction, brightenFraction, N } from './helpers.js';

test('downscale averages to Rec.601 luma', () => {
  const rgba = new Uint8ClampedArray(4 * 2 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 255; rgba[i + 3] = 255; }
  const g = downscaleToLuma(rgba, 4, 2, 2, 1);
  assert.equal(g.length, 2); assert.ok(Math.abs(g[0] - 76.245) < 0.01);
});
test('downscale handles non-divisible sizes', () => {
  const rgba = new Uint8ClampedArray(5 * 3 * 4).fill(100);
  const g = downscaleToLuma(rgba, 5, 3, 2, 2);
  assert.equal(g.length, 4); for (const v of g) assert.ok(Math.abs(v - 100) < 0.01);
});
test('frameDiff is mean absolute difference', () => {
  assert.equal(frameDiff(fill(4, 10), fill(4, 13)), 3);
});
test('identical frame → coverage 0', () => {
  const b = buildBaseline([textured(), textured()]);
  assert.equal(computeCoverage(textured(), b, CFG).coverage, 0);
});
test('70% of cells darkened by 60 → coverage ≈ 0.7, ncc < 0.9', () => {
  const b = buildBaseline([textured(), textured()]);
  const r = computeCoverage(darkenFraction(textured(), 0.7, 60), b, CFG);
  assert.ok(Math.abs(r.coverage - 0.7) < 0.02, `coverage ${r.coverage}`); assert.ok(r.ncc < 0.9, `ncc ${r.ncc}`);
});
test('brighter head (+40) also counts', () => {
  const b = buildBaseline([fill(N, 20), fill(N, 20)]);
  assert.ok(computeCoverage(brightenFraction(fill(N, 20), 0.7, 40), b, CFG).coverage > 0.65);
});
test('dark noisy frame stays below enter', () => {
  const b = buildBaseline([noisy(5, 2, 1), noisy(5, 2, 2), noisy(5, 2, 3)]);
  assert.ok(computeCoverage(noisy(5, 3, 9), b, CFG).coverage < 0.1);
});
test('global gain change keeps ncc high', () => {
  const b = buildBaseline([textured(), textured()]);
  const lit = textured().map(v => Math.min(255, v * 1.5));
  assert.ok(computeCoverage(lit, b, CFG).ncc >= 0.9);
});
test('featureless baseline reports ncc 0', () => {
  const b = buildBaseline([fill(N, 90), fill(N, 90)]);
  assert.equal(computeCoverage(fill(N, 140), b, CFG).ncc, 0);
});
test('adaptBaseline moves mean toward frame', () => {
  const b = buildBaseline([fill(4, 100), fill(4, 100)]);
  adaptBaseline(b, fill(4, 110), 0.1);
  assert.ok(Math.abs(b.mean[0] - 101) < 1e-6); assert.ok(Math.abs(b.globalMean - 101) < 1e-6);
});

// --- final-review fixes (#1, #8) ---
import { rescaleBaseline } from '../src/baseline.js';
test('featureless dark baseline + light on is explained by a global change', () => {
  const b = buildBaseline([fill(N, 8), fill(N, 8)]);
  const r = computeCoverage(fill(N, 80), b, CFG);
  assert.equal(r.coverage, 1); assert.ok(r.residual < 0.15, `residual ${r.residual}`);
});
test('textured gain change is explained (low residual)', () => {
  const b = buildBaseline([textured(), textured()]);
  assert.ok(computeCoverage(textured().map(v => Math.min(255, v * 1.5)), b, CFG).residual < 0.15);
});
test('head over textured view is not explained (high residual)', () => {
  const b = buildBaseline([textured(), textured()]);
  assert.ok(computeCoverage(darkenFraction(textured(), 0.7, 60), b, CFG).residual > 0.3);
});
test('partial uniform head over featureless view is not explained', () => {
  const b = buildBaseline([fill(N, 90), fill(N, 90)]);
  assert.ok(computeCoverage(darkenFraction(fill(N, 90), 0.7, 60), b, CFG).residual > 0.3);
});
test('rescaleBaseline applies the fitted gain/offset', () => {
  const b = buildBaseline([textured(), textured()]);
  const lit = textured().map(v => Math.min(255, v * 1.3 + 5));
  const r = computeCoverage(lit, b, CFG);
  rescaleBaseline(b, r.gain, r.offset);
  assert.ok(computeCoverage(lit, b, CFG).coverage < 0.05);
});
test('adaptBaseline re-estimates per-cell noise', () => {
  const b = buildBaseline([fill(4, 100), fill(4, 100)]);
  adaptBaseline(b, fill(4, 102), 0.5);
  assert.ok(Math.abs(b.noise[0] - Math.sqrt(2)) < 1e-6, `noise ${b.noise[0]}`);
});
