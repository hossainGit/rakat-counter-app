/**
 * Baseline = what the empty view looks like.
 * { mean, noise (per-cell std), globalMean, spatialStd }
 */
export function buildBaseline(frames) {
  const n = frames[0].length, k = frames.length;
  const mean = new Float32Array(n), noise = new Float32Array(n);
  for (const f of frames) for (let i = 0; i < n; i++) mean[i] += f[i] / k;
  for (const f of frames) for (let i = 0; i < n; i++) noise[i] += (f[i] - mean[i]) ** 2 / k;
  for (let i = 0; i < n; i++) noise[i] = Math.sqrt(noise[i]);
  const b = { mean, noise, globalMean: 0, spatialStd: 0 };
  refreshStats(b);
  return b;
}

/** Exponential moving average toward the current (empty) frame; also re-estimates noise. */
export function adaptBaseline(b, grid, alpha) {
  for (let i = 0; i < b.mean.length; i++) {
    const d = grid[i] - b.mean[i];
    b.noise[i] = Math.sqrt((1 - alpha) * b.noise[i] ** 2 + alpha * d * d);
    b.mean[i] += alpha * d;
  }
  refreshStats(b);
}

/** Instantly follow a global light / exposure change: mean ← gain·mean + offset. */
export function rescaleBaseline(b, gain, offset) {
  // Sensor noise grows roughly with the square root of the light, not linearly.
  const g = Math.sqrt(Math.max(1, Math.abs(gain)));
  for (let i = 0; i < b.mean.length; i++) {
    b.mean[i] = Math.min(255, Math.max(0, gain * b.mean[i] + offset));
    b.noise[i] *= g;
  }
  refreshStats(b);
}

function refreshStats(b) {
  const n = b.mean.length;
  let s = 0; for (let i = 0; i < n; i++) s += b.mean[i];
  const m = s / n;
  let v = 0; for (let i = 0; i < n; i++) v += (b.mean[i] - m) ** 2;
  b.globalMean = m; b.spatialStd = Math.sqrt(v / n);
}
