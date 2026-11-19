export const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) }; };
export const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
export const W = 32, H = 24, N = W * H;
export const fill = (n, v) => new Float32Array(n).fill(v);
export function textured(off = 0) {
  const g = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 60 + x * 3 + y * 2 + off;
    if (x >= 12 && x < 20 && y >= 8 && y < 14) v = 230;
    g[y * W + x] = v;
  }
  return g;
}
export function noisy(mean, amp, seed, n = N) {
  let s = seed >>> 0 || 1; const g = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = mean + ((s / 4294967296) * 2 - 1) * amp; }
  return g;
}
export const darkenFraction = (g, f, d) => { const o = Float32Array.from(g); const k = Math.round(f * o.length); for (let i = 0; i < k; i++) o[i] = Math.max(0, o[i] - d); return o; };
export const brightenFraction = (g, f, d) => { const o = Float32Array.from(g); const k = Math.round(f * o.length); for (let i = 0; i < k; i++) o[i] = Math.min(255, o[i] + d); return o; };
