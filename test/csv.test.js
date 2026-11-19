import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/csv.js';
test('toCsv', () => {
  assert.equal(toCsv([{ t: 1, c: 0.5 }, { t: 2, c: 0.7 }]), 't,c\n1,0.5\n2,0.7');
  assert.equal(toCsv([]), '');
});
