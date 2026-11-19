const KEY = 'src.count';

/** Current rakah shown for a sujood count s (owner's choice: floor(s/2)+1). */
export const rakahFromSujood = s => Math.floor(s / 2) + 1;

/** True after the first sujood of a pair. */
export const hasHalfDot = s => s % 2 === 1;

/** Reset is always shown outside full screen; in full screen only past 4. */
export const resetVisible = ({ fullscreen, displayed }) => !fullscreen || displayed > 4;

export function saveCount(storage, s, nowMs) {
  try { storage.setItem(KEY, JSON.stringify({ s, t: nowMs })); } catch { /* storage blocked */ }
}

export function loadCount(storage, nowMs, maxAgeMs) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return 0;
    const { s, t } = JSON.parse(raw);
    if (!Number.isInteger(s) || s < 0 || typeof t !== 'number') return 0;
    return nowMs - t <= maxAgeMs ? s : 0;
  } catch { return 0; }
}
