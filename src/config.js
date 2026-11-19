// Every detector tunable lives here (SRS FR-16). Values are starting points,
// to be re-tuned from real recordings (plan Task 5 gate).
export const DETECTOR_CONFIG = Object.freeze({
  gridW: 32, gridH: 24, fps: 15,
  stableDiff: 3, stableMs: 1500, calibMs: 1000, calibTimeoutMs: 20000,
  noiseK: 4, absMin: 12,
  enter: 0.60, hold: 0.50, exit: 0.25,
  minSujoodMs: 800, minClearMs: 400,
  adaptTauMs: 20000, adaptMaxCoverage: 0.1,
  // A change is "lighting" when a global gain/offset fit explains all but this fraction of cells.
  lightingResidual: 0.15, relightMs: 1000,
  tooDarkMean: 15, lowMean: 40, lowNoise: 3, qualityEveryMs: 2000,
  stallMs: 2000,
  lockCamera: false,
  restoreMaxMs: 900000,
});
