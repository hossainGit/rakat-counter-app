/**
 * Sujood state machine (SRS FR-11…FR-15).
 *   EMPTY → COVERING → SUJOOD (+1) → RELEASING → EMPTY
 * Hysteresis (enter/hold > exit) plus minimum durations keep one sujood = one count.
 * `lighting` (a change explained by a global light/exposure shift) is checked in every
 * state: it never starts or continues a sujood, and once it lasts cfg.relightMs the
 * engine is asked to rescale the baseline and the state returns to EMPTY.
 */
export function createDetector(cfg) {
  let state = 'EMPTY', sujood = 0, since = 0;
  let relightSince = null, relightFired = false;

  function update({ coverage, lighting }, t) {
    let counted = false, needsRebaseline = false;
    if (lighting) {
      if (relightSince === null) relightSince = t;
      if (!relightFired && t - relightSince >= cfg.relightMs) {
        relightFired = true; state = 'EMPTY';
        return { state, sujood, counted, needsRebaseline: true };
      }
    } else { relightSince = null; relightFired = false; }

    switch (state) {
      case 'EMPTY':
        if (coverage >= cfg.enter && !lighting) { state = 'COVERING'; since = t; }
        break;
      case 'COVERING':
        if (lighting || coverage < cfg.hold) state = 'EMPTY';
        else if (t - since >= cfg.minSujoodMs) { state = 'SUJOOD'; sujood++; counted = true; }
        break;
      case 'SUJOOD':
        if (coverage < cfg.exit) { state = 'RELEASING'; since = t; }
        break;
      case 'RELEASING':
        if (coverage >= cfg.exit) state = 'SUJOOD';
        else if (t - since >= cfg.minClearMs) state = 'EMPTY';
        break;
    }
    return { state, sujood, counted, needsRebaseline };
  }

  return {
    update,
    get state() { return state; },
    get sujood() { return sujood; },
    setSujood(n) { sujood = Math.max(0, n | 0); },
    resetState() { state = 'EMPTY'; relightSince = null; relightFired = false; },
  };
}
