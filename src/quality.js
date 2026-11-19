/** Light quality from the empty-view baseline (SRS FR-21). */
export function classifyQuality(b, cfg) {
  if (b.globalMean < cfg.tooDarkMean) return 'too-dark';
  let noise = 0;
  for (let i = 0; i < b.noise.length; i++) noise += b.noise[i];
  noise /= b.noise.length;
  return b.globalMean < cfg.lowMean || noise > cfg.lowNoise ? 'low' : 'ok';
}
