import { downscaleToLuma, frameDiff } from './grid.js';
import { adaptBaseline, rescaleBaseline } from './baseline.js';
import { computeCoverage } from './coverage.js';
import { createDetector } from './detector.js';
import { createCalibrator } from './calibrator.js';
import { classifyQuality } from './quality.js';

/**
 * Frame loop: source → luminance grid → calibrator / coverage → detector.
 * Events: calibrating {timedOut}, calibrated {quality}, locked {locked}, relit {gain, offset},
 *         tick {coverage, residual, ncc, state, sujood, meanLuma, t}, count {sujood},
 *         quality {quality}, stalled {}
 */
export function createEngine({ source, cfg, onEvent, now = () => performance.now() }) {
  const detector = createDetector(cfg);
  const calibrator = createCalibrator(cfg);
  let baseline = null, prev = null, lastT = null, timer = null;
  let quality = null, lastQualityT = 0, lockTried = false, lastCalibTimedOut = null;
  let lastFrameT = null, stalled = false;
  const emit = e => onEvent && onEvent(e);

  function recalibrate() {
    baseline = null; prev = null; lastT = null; lastCalibTimedOut = false;
    lastFrameT = now(); stalled = false;
    calibrator.restart();
    detector.resetState();
    emit({ type: 'calibrating', timedOut: false });
  }

  function tick() {
    const f = source.readFrame();
    const t = now();
    if (!f) {
      if (lastFrameT !== null && !stalled && t - lastFrameT >= cfg.stallMs) { stalled = true; emit({ type: 'stalled' }); }
      return;
    }
    lastFrameT = t; stalled = false;
    const grid = downscaleToLuma(f.rgba, f.w, f.h, cfg.gridW, cfg.gridH);

    if (!baseline) {
      const r = calibrator.feed(grid, t);
      if (r.status !== 'done') {
        if (r.timedOut !== lastCalibTimedOut) { lastCalibTimedOut = r.timedOut; emit({ type: 'calibrating', timedOut: r.timedOut }); }
        return;
      }
      baseline = r.baseline; quality = classifyQuality(baseline, cfg); lastQualityT = t;
      emit({ type: 'calibrated', quality });
      if (cfg.lockCamera && !lockTried) {
        lockTried = true;
        Promise.resolve(source.lock()).then(res => emit({ type: 'locked', locked: !!(res && res.locked) }), () => emit({ type: 'locked', locked: false }));
      }
      prev = grid; lastT = t;
      return;
    }

    const c = computeCoverage(grid, baseline, cfg);
    const lighting = c.coverage >= cfg.enter && c.residual < cfg.lightingResidual;
    const r = detector.update({ coverage: c.coverage, lighting }, t);
    if (r.counted) emit({ type: 'count', sujood: r.sujood });
    emit({ type: 'tick', coverage: c.coverage, residual: c.residual, ncc: c.ncc, state: r.state, sujood: r.sujood, meanLuma: c.meanLuma, t });
    if (r.needsRebaseline) {
      // Follow the light change instantly — no blind recalibration window (review #2).
      rescaleBaseline(baseline, c.gain, c.offset);
      emit({ type: 'relit', gain: c.gain, offset: c.offset });
      const q = classifyQuality(baseline, cfg);
      lastQualityT = t;
      if (q !== quality) { quality = q; emit({ type: 'quality', quality }); }
    } else if (r.state === 'EMPTY' && c.coverage < cfg.adaptMaxCoverage && prev && lastT !== null && frameDiff(prev, grid) < cfg.stableDiff) {
      adaptBaseline(baseline, grid, Math.min(1, (t - lastT) / cfg.adaptTauMs));
      if (t - lastQualityT >= cfg.qualityEveryMs) {
        lastQualityT = t;
        const q = classifyQuality(baseline, cfg);
        if (q !== quality) { quality = q; emit({ type: 'quality', quality }); }
      }
    }
    prev = grid; lastT = t;
  }

  return {
    tick,
    recalibrate,
    start() {
      if (timer) return;
      lockTried = false;
      recalibrate();
      timer = setInterval(tick, 1000 / cfg.fps);
    },
    stop() { clearInterval(timer); timer = null; lastFrameT = null; },
    setSujood: n => detector.setSujood(n),
    resetCount: () => detector.setSujood(0),
    get sujood() { return detector.sujood; },
    get quality() { return quality; },
  };
}
