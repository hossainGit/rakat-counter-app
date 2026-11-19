import { frameDiff } from './grid.js';
import { buildBaseline } from './baseline.js';

/**
 * Waits for the empty view to be stable for cfg.stableMs, then collects cfg.calibMs
 * of frames into a baseline (SRS FR-6). Any unstable frame restarts the wait.
 */
export function createCalibrator(cfg) {
  let startT = null, prev = null, status = 'waiting', stableSince = null, collectSince = 0, frames = [], baseline = null;

  function restart(t = null) {
    startT = t; prev = null; status = 'waiting'; stableSince = null; frames = []; baseline = null;
  }

  function feed(grid, t) {
    if (startT === null) startT = t;
    if (status === 'done') return { status, timedOut: false, baseline };
    const stable = prev === null || frameDiff(prev, grid) < cfg.stableDiff;
    prev = grid;
    if (!stable) { status = 'waiting'; stableSince = t; frames = []; }
    else if (status === 'waiting') {
      if (stableSince === null) stableSince = t;
      if (t - stableSince >= cfg.stableMs) { status = 'collecting'; collectSince = t; frames = [grid]; }
    } else {
      frames.push(grid);
      if (t - collectSince >= cfg.calibMs) { status = 'done'; baseline = buildBaseline(frames); frames = []; }
    }
    const timedOut = status !== 'done' && t - startT >= cfg.calibTimeoutMs;
    return status === 'done' ? { status, timedOut, baseline } : { status, timedOut };
  }

  return { feed, restart };
}
