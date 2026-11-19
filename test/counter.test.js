import test from 'node:test';
import assert from 'node:assert/strict';
import { rakahFromSujood, hasHalfDot, resetVisible, saveCount, loadCount } from '../src/counter.js';
import { DETECTOR_CONFIG } from '../src/config.js';
import { mem, broken } from './helpers.js';

test('current rakah from sujood count', () => {
  assert.deepEqual([0,1,2,3,7,8,10].map(rakahFromSujood), [1,1,2,2,4,5,6]);
});
test('half dot after first sujood of a pair', () => {
  assert.equal(hasHalfDot(1), true); assert.equal(hasHalfDot(2), false); assert.equal(hasHalfDot(0), false);
});
test('reset visibility', () => {
  assert.equal(resetVisible({ fullscreen: false, displayed: 1 }), true);
  assert.equal(resetVisible({ fullscreen: true, displayed: 4 }), false);
  assert.equal(resetVisible({ fullscreen: true, displayed: 5 }), true);
});
test('count restores within max age only', () => {
  const st = mem(); saveCount(st, 3, 1000);
  assert.equal(loadCount(st, 1000 + 14 * 60e3, 900000), 3);
  assert.equal(loadCount(st, 1000 + 16 * 60e3, 900000), 0);
  assert.equal(loadCount(mem(), 0, 900000), 0);
});
test('throwing storage never throws', () => {
  assert.doesNotThrow(() => saveCount(broken, 2, 0));
  assert.equal(loadCount(broken, 0, 900000), 0);
});
test('config is frozen with spec values', () => {
  assert.ok(Object.isFrozen(DETECTOR_CONFIG));
  assert.equal(DETECTOR_CONFIG.enter, 0.6); assert.equal(DETECTOR_CONFIG.exit, 0.25); assert.equal(DETECTOR_CONFIG.minSujoodMs, 800);
});
