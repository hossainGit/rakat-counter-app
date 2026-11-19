import test from 'node:test';
import assert from 'node:assert/strict';
import { FONTS, DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings, applySettings } from '../src/settings.js';
import { mem, broken } from './helpers.js';

test('five system font stacks', () => assert.deepEqual(Object.keys(FONTS), ['geometric', 'humanist', 'rounded', 'serif', 'mono']));
test('loadSettings with throwing storage returns defaults', () => assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS));
test('saveSettings with throwing storage does not throw', () => assert.doesNotThrow(() => saveSettings(broken, DEFAULT_SETTINGS)));
test('round trip', () => {
  const st = mem(); saveSettings(st, { ...DEFAULT_SETTINGS, font: 'serif', sizePct: 70 });
  const s = loadSettings(st); assert.equal(s.font, 'serif'); assert.equal(s.sizePct, 70);
});
test('corrupt json returns defaults', () => {
  const st = mem(); st.setItem('src.settings', '{nope'); assert.deepEqual(loadSettings(st), DEFAULT_SETTINGS);
});
test('clamps and validates', () => {
  const s = normalizeSettings({ font: 'comic', sizePct: 200, opacity: 0, color: 'red', testMode: 'yes' });
  assert.deepEqual([s.font, s.sizePct, s.opacity, s.color, s.testMode], ['geometric', 90, 0.1, '#f2f2f2', true]);
  assert.equal(normalizeSettings({ sizePct: 5 }).sizePct, 20);
});
test('applySettings sets css variables', () => {
  const props = {}; applySettings({ setProperty: (k, v) => (props[k] = v) }, DEFAULT_SETTINGS);
  assert.equal(props['--digit-size'], '50vmin'); assert.equal(props['--digit-opacity'], '0.7');
  assert.equal(props['--digit-color'], '#f2f2f2'); assert.equal(props['--digit-font'], FONTS.geometric);
});
