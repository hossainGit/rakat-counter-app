import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../src/detector.js';
import { rakahFromSujood } from '../src/counter.js';
import { DETECTOR_CONFIG as CFG } from '../src/config.js';

const d = () => createDetector(CFG);
function run(det, segments, step = 66) {
  let t = 0, last, counts = 0, rebaseline = 0;
  for (const [coverage, ms, lighting = false] of segments) {
    for (let e = 0; e < ms; e += step, t += step) {
      last = det.update({ coverage, lighting }, t);
      if (last.counted) counts++;
      if (last.needsRebaseline) rebaseline++;
    }
  }
  return { last, counts, rebaseline };
}

test('quick cover under 0.8 s does not count', () => assert.equal(run(d(), [[0,500],[0.9,500],[0,1000]]).last.sujood, 0));
test('one sujood counts once', () => {
  const r = run(d(), [[0,500],[0.9,1200],[0,800]]);
  assert.equal(r.last.sujood, 1); assert.equal(r.counts, 1); assert.equal(r.last.state, 'EMPTY');
});
test('long sujood (30 s) counts once', () => assert.equal(run(d(), [[0.9,30000],[0,800]]).last.sujood, 1));
test('flicker above exit inside sujood counts once', () =>
  assert.equal(run(d(), [[0.9,1000],[0.35,300],[0.9,300],[0.3,300],[0.9,500],[0,800]]).last.sujood, 1));
test('brief release under 0.4 s does not split a sujood', () =>
  assert.equal(run(d(), [[0.9,1000],[0.1,200],[0.9,1000],[0,800]]).last.sujood, 1));
test('two sujood with sitting between count 2', () =>
  assert.equal(run(d(), [[0.9,1500],[0.2,1500],[0.9,1500],[0,800]]).last.sujood, 2));
test('coverage dipping below hold during COVERING returns to EMPTY', () => {
  const r = run(d(), [[0.9,400],[0.4,200],[0.9,500],[0,800]]);
  assert.equal(r.last.sujood, 0);
});
test('sustained lighting change asks for rebaseline, never counts', () => {
  const r = run(d(), [[1.0, 2000, true]]);
  assert.equal(r.last.sujood, 0); assert.equal(r.rebaseline, 1);
});
test('8 sujood then display shows 5', () => {
  const segs = Array.from({ length: 8 }, () => [[0.9,1200],[0.1,700]]).flat();
  assert.equal(rakahFromSujood(run(d(), segs).last.sujood), 5);
});
test('setSujood and resetState', () => {
  const det = d(); det.setSujood(3); run(det, [[0.9, 1000]]); det.resetState();
  assert.equal(det.state, 'EMPTY'); assert.equal(det.sujood, 4);
});

// --- final-review fix #1: lighting is checked in every state ---
test('lighting-like frames during COVERING drop back to EMPTY without counting', () => {
  assert.equal(run(d(), [[0.9, 300], [1.0, 1500, true], [0, 500]]).last.sujood, 0);
});
test('stuck in SUJOOD by a light change recovers via rebaseline', () => {
  const r = run(d(), [[0.9, 1200], [1.0, 1500, true]]);
  assert.equal(r.last.sujood, 1); assert.equal(r.rebaseline, 1); assert.equal(r.last.state, 'EMPTY');
});
