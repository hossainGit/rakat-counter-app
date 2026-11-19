/**
 * Synthetic frames for desktop testing (?fake=1).
 * Keys: C = head over the lens, L = light ×1.6, D = dark room.
 */
export function createFakeSource() {
  const w = 320, h = 240, rgba = new Uint8ClampedArray(w * h * 4);
  const flags = { head: false, light: false, dark: false };
  let seed = 7, running = false;
  const onKey = e => {
    const k = e.key.toLowerCase();
    if (k === 'c') flags.head = !flags.head;
    if (k === 'l') flags.light = !flags.light;
    if (k === 'd') flags.dark = !flags.dark;
  };
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

  return {
    flags,
    async start() { if (!running) { running = true; addEventListener('keydown', onKey); } },
    stop() { running = false; removeEventListener('keydown', onKey); },
    readFrame() {
      if (!running) return null;
      const gain = (flags.light ? 1.6 : 1) * (flags.dark ? 0.08 : 1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 60 + x * 0.3 + y * 0.2;
        if (x >= 120 && x < 200 && y >= 80 && y < 140) v = 230;
        v = v * gain + rnd() * 1.5;
        if (flags.head && y < h * 0.75) v = flags.dark ? 40 : 18;
        const i = (y * w + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
      }
      return { rgba, w, h };
    },
    async lock() { return { locked: false }; },
  };
}
