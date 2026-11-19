const SAT_HI = 250, SAT_LO = 5;
const unsaturated = v => v > SAT_LO && v < SAT_HI;

/**
 * coverage: fraction of cells that differ meaningfully from the baseline
 *           (either direction: darker head in a lit room, brighter screen-lit head in the dark).
 * residual: fraction of cells still changed after fitting grid ≈ gain·baseline + offset.
 *           A light switch or exposure change is explained by that fit (low residual);
 *           a head over the lens is not. Featureless baselines fit offset only.
 *           Cells clipped at the sensor's limits on both sides are not counted.
 * ncc:      spatial correlation with the baseline (diagnostic).
 */
export function computeCoverage(grid, b, cfg) {
  const n = grid.length;
  let changed = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    sum += grid[i];
    if (Math.abs(grid[i] - b.mean[i]) > Math.max(cfg.noiseK * b.noise[i], cfg.absMin)) changed++;
  }
  const meanLuma = sum / n;

  // Global fit on unsaturated cells.
  let k = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) if (unsaturated(grid[i])) { k++; sx += b.mean[i]; sy += grid[i]; }
  let gain = 1, offset = meanLuma - b.globalMean;
  if (k > n * 0.2) {
    const mx = sx / k, my = sy / k;
    offset = my - mx;
    if (b.spatialStd >= 2) {
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) if (unsaturated(grid[i])) { sxy += (b.mean[i] - mx) * (grid[i] - my); sxx += (b.mean[i] - mx) ** 2; }
      if (sxx > 0) { gain = sxy / sxx; offset = my - gain * mx; }
    }
  }
  let resid = 0;
  const g = Math.max(1, Math.abs(gain));
  for (let i = 0; i < n; i++) {
    const pred = gain * b.mean[i] + offset;
    if ((grid[i] >= SAT_HI && pred >= SAT_HI) || (grid[i] <= SAT_LO && pred <= SAT_LO)) continue;
    if (Math.abs(grid[i] - pred) > Math.max(cfg.noiseK * b.noise[i] * g, cfg.absMin)) resid++;
  }

  let ncc = 0;
  if (b.spatialStd >= 2) {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const x = grid[i] - meanLuma, y = b.mean[i] - b.globalMean;
      sxy += x * y; sxx += x * x; syy += y * y;
    }
    ncc = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  }
  return { coverage: changed / n, residual: resid / n, gain, offset, ncc, meanLuma };
}
