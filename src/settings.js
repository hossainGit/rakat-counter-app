const KEY = 'src.settings';

/** System font stacks only — nothing downloaded. */
export const FONTS = Object.freeze({
  geometric: '"Avenir Next", Futura, "Century Gothic", system-ui, sans-serif',
  humanist: '"Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", Nunito, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
});

export const DEFAULT_SETTINGS = Object.freeze({ font: 'geometric', sizePct: 50, color: '#f2f2f2', opacity: 0.7, testMode: false });

const clamp = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    font: Object.hasOwn(FONTS, raw.font) ? raw.font : d.font,
    sizePct: clamp(raw.sizePct, 20, 90, d.sizePct),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : d.color,
    opacity: clamp(raw.opacity, 0.1, 1, d.opacity),
    testMode: Boolean(raw.testMode),
  };
}

export function loadSettings(storage) {
  try {
    const raw = storage.getItem(KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(storage, s) {
  try { storage.setItem(KEY, JSON.stringify(normalizeSettings(s))); } catch { /* storage blocked */ }
}

export function applySettings(rootStyle, s) {
  rootStyle.setProperty('--digit-font', FONTS[s.font]);
  rootStyle.setProperty('--digit-size', `${s.sizePct}vmin`);
  rootStyle.setProperty('--digit-color', s.color);
  rootStyle.setProperty('--digit-opacity', String(s.opacity));
}
