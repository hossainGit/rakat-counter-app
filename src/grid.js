/** Box-average an RGBA frame into a gw×gh Rec.601 luminance grid. */
export function downscaleToLuma(rgba, w, h, gw, gh) {
  const sum = new Float64Array(gw * gh), cnt = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = Math.min(gh - 1, Math.floor((y * gh) / h)) * gw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, c = row + Math.min(gw - 1, Math.floor((x * gw) / w));
      sum[c] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      cnt[c]++;
    }
  }
  const out = new Float32Array(gw * gh);
  for (let c = 0; c < out.length; c++) out[c] = cnt[c] ? sum[c] / cnt[c] : 0;
  return out;
}

/** Mean absolute difference between two grids of equal length. */
export function frameDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}
