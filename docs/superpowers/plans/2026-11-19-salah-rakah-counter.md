# Salah Rakah Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, offline-capable browser app that counts sujood with the front camera of a phone lying flat on the prayer mat, and shows the current rakah as one large digit.

**Architecture:** All detection logic lives in pure ES modules that work on small luminance grids (no DOM), so it can be unit-tested with synthetic frames in Node. A thin engine pulls frames from a source (the real camera, or a keyboard-driven fake source for desktop testing) and feeds them through: calibrator → coverage → state machine. A single `app.js` owns the DOM. There's no backend and no build step.

**Tech Stack:** HTML, CSS, vanilla JavaScript (ES modules). Tests use Node's built-in runner (`node --test`), with zero dependencies. Hosted as static files on Vercel.

**Spec:** `docs/superpowers/specs/2026-11-19-salah-rakah-counter-srs.md`

## Global Constraints

- Static files only. No framework, no build step, no runtime third-party requests, no analytics.
- First-load total ≤ 150 KB.
- Front camera (`facingMode: "user"`), never above 640×480. No frame, image or derived data leaves the device.
- Android Chrome (current + previous 2) and iOS Safari 16.4+ (in-browser and standalone).
- During counting: no sound, vibration, animation, flashing or popups. Only the digit, the half dot and (when needed) the amber dot are visible.
- Display = current rakah = `floor(s/2) + 1`. Reset start value is s = 0 (shows 1).
- All detector thresholds live in one config object (`src/config.js`).
- Every `localStorage` access is wrapped in try/catch. The app runs on defaults if storage fails.
- Commits: the project folder is not a git repo yet. Task 1 runs `git init`. Ask the owner before the first commit if they haven't approved committing.

## Review Focus

1. **The sitting between two sujood doesn't drop coverage below the exit threshold.** The second sujood would be missed. Expected: the sitting releases the state so the second sujood counts. → Task 3 test `two sujood with sitting between count 2`, and the real-data gate in Task 5.
2. **The light is switched on or off while the mat is empty.** The whole frame changes at once and could look like a sujood. Expected: no count, and the baseline is rebuilt. → Task 2 test `global gain change keeps ncc high`, Task 3 test `sustained lighting change asks for rebaseline, never counts`.
3. **Very dark room, sensor noise only.** Expected: noise alone never reaches the enter threshold. → Task 2 test `dark noisy frame stays below enter`.
4. **The page reloads, or the screen locks mid-prayer.** Expected: the count is restored within 15 minutes and calibration runs again. → Task 1 tests on `loadCount`, Task 6 manual check.
5. **Storage is blocked (private mode).** Expected: settings fall back to defaults and nothing throws. → Task 1 test `throwing storage`, Task 7 test `loadSettings with throwing storage returns defaults`.

---

## File Structure

```
index.html              markup for all screens (main, settings, warnings)
styles.css              dark theme, layout, digit styling via CSS variables
manifest.webmanifest    PWA manifest (Task 8)
sw.js                   service worker, cache-first (Task 8)
vercel.json             no-cache header for sw.js (Task 8)
icons/icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png  (Task 8)
package.json            { "type": "module", "scripts": { "test": "node --test test/" } }
src/config.js           DETECTOR_CONFIG (all tunables)
src/counter.js          rakah math, half dot, reset visibility, count persistence
src/grid.js             RGBA → luminance grid, frame difference
src/baseline.js         build/adapt baseline
src/coverage.js         coverage + ncc against baseline
src/detector.js         sujood state machine
src/calibrator.js       stability wait + baseline capture
src/quality.js          ok / low / too-dark classification
src/csv.js              CSV export of signal log
src/camera.js           getUserMedia, constraint locking, frame source (browser only)
src/fake-source.js      synthetic frame source driven by keyboard (?fake=1)
src/engine.js           frame loop wiring source → calibrator → coverage → detector
src/settings.js         defaults, fonts, load/save/clamp
src/app.js              DOM, fullscreen, wake lock, reset hold, settings UI, test mode
test/*.test.js          node --test suites
```

---

### Task 1: Scaffold, config and counter logic

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`, `.vercel/`), `src/config.js`, `src/counter.js`
- Test: `test/counter.test.js`

**Interfaces:**
- Produces:
  - `DETECTOR_CONFIG` (frozen object) in `src/config.js` with exactly these starting values:
    `gridW: 32, gridH: 24, fps: 15, stableDiff: 3, stableMs: 1500, calibMs: 1000, calibTimeoutMs: 20000, noiseK: 4, absMin: 12, enter: 0.60, hold: 0.50, exit: 0.25, minSujoodMs: 800, minClearMs: 400, adaptTauMs: 20000, lightingNcc: 0.9, relightMs: 1000, tooDarkMean: 15, lowMean: 40, lowNoise: 10, qualityEveryMs: 2000, restoreMaxMs: 900000`
  - `rakahFromSujood(s: number) → number`
  - `hasHalfDot(s: number) → boolean`
  - `resetVisible({ fullscreen: boolean, displayed: number }) → boolean`
  - `saveCount(storage, s: number, nowMs: number) → void` (key `"src.count"`, JSON `{s, t}`)
  - `loadCount(storage, nowMs: number, maxAgeMs: number) → number` (returns 0 when missing/stale/broken)

- [ ] **Step 1: `git init`, create `package.json` and `.gitignore`**

- [ ] **Step 2: Write the failing tests** in `test/counter.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rakahFromSujood, hasHalfDot, resetVisible, saveCount, loadCount } from '../src/counter.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('current rakah from sujood count', () => {
  assert.deepEqual([0,1,2,3,7,8,10].map(rakahFromSujood), [1,1,2,2,4,5,6]);
});
test('half dot after first sujood of a pair', () => {
  assert.equal(hasHalfDot(1), true); assert.equal(hasHalfDot(2), false); assert.equal(hasHalfDot(0), false);
});
test('reset visibility', () => {
  assert.equal(resetVisible({ fullscreen: false, displayed: 1 }), true);
  assert.equal(resetVisible({ fullscreen: true, displayed: 4 }), false);
  assert.equal(resetVisible({ fullscreen: true, displayed: 5 }), true);
});
test('count restores within max age only', () => {
  const st = mem(); saveCount(st, 3, 1000);
  assert.equal(loadCount(st, 1000 + 14 * 60e3, 900000), 3);
  assert.equal(loadCount(st, 1000 + 16 * 60e3, 900000), 0);
  assert.equal(loadCount(mem(), 0, 900000), 0);
});
test('throwing storage never throws', () => {
  assert.doesNotThrow(() => saveCount(broken, 2, 0));
  assert.equal(loadCount(broken, 0, 900000), 0);
});
```

- [ ] **Step 3: Run `npm test`** — expected FAIL (module not found)
- [ ] **Step 4: Implement `src/config.js` and `src/counter.js`**
- [ ] **Step 5: Run `npm test`** — expected PASS (5 tests)
- [ ] **Step 6: Commit** `feat: scaffold, detector config and counter logic`

---

### Task 2: Luminance grid, baseline and coverage

**Files:**
- Create: `src/grid.js`, `src/baseline.js`, `src/coverage.js`
- Test: `test/pixels.test.js`

**Interfaces:**
- Consumes: `DETECTOR_CONFIG`
- Produces:
  - `downscaleToLuma(rgba: Uint8ClampedArray, w, h, gw, gh) → Float32Array` (length gw·gh; Rec.601 luma `0.299R+0.587G+0.114B`, box average per cell)
  - `frameDiff(a: Float32Array, b: Float32Array) → number` (mean absolute difference)
  - `buildBaseline(frames: Float32Array[]) → Baseline` where `Baseline = { mean: Float32Array, noise: Float32Array /* per-cell std */, globalMean: number, spatialStd: number }`
  - `adaptBaseline(b: Baseline, grid: Float32Array, alpha: number) → void` (mutates `mean` and `globalMean`: `mean += alpha·(grid − mean)`)
  - `computeCoverage(grid, b: Baseline, cfg) → { coverage: number, ncc: number, meanLuma: number }`

Coverage algorithm: cell *i* counts as changed when `|grid[i] − mean[i]| > max(cfg.noiseK·noise[i], cfg.absMin)`, and coverage = changed / cells. This works both ways, for a darker head and for a brighter (screen-lit) head. `ncc` is the Pearson correlation between `grid` and `b.mean` across cells. A global lighting or exposure change keeps the spatial pattern (ncc ≥ `lightingNcc`), while a head covering the camera breaks it. When `b.spatialStd < 2` (a featureless ceiling) ncc is meaningless: return `ncc = 0` and let the detector rely on coverage alone. The Task 5 data decides whether a featureless ceiling needs more.

- [ ] **Step 1: Write the failing tests** in `test/pixels.test.js`. Use a helper `textured(v)` that builds a 32×24 grid with a smooth gradient plus a bright "lamp" block (spatialStd > 10), and `fill(n, v)`.

```js
test('downscale averages to Rec.601 luma', () => {
  const rgba = new Uint8ClampedArray(4 * 2 * 4); for (let i = 0; i < rgba.length; i += 4) rgba[i] = 255, rgba[i+3] = 255;
  const g = downscaleToLuma(rgba, 4, 2, 2, 1);
  assert.equal(g.length, 2); assert.ok(Math.abs(g[0] - 76.245) < 0.01);
});
test('identical frame → coverage 0', () => {
  const b = buildBaseline([textured(0), textured(0)]);
  assert.equal(computeCoverage(textured(0), b, CFG).coverage, 0);
});
test('70% of cells darkened by 60 → coverage ≈ 0.7, ncc < 0.9', () => {
  const b = buildBaseline([textured(0), textured(0)]);
  const r = computeCoverage(darkenFraction(textured(0), 0.7, 60), b, CFG);
  assert.ok(Math.abs(r.coverage - 0.7) < 0.02); assert.ok(r.ncc < 0.9);
});
test('brighter head (+40) also counts', () => {
  const b = buildBaseline([fill(768, 20), fill(768, 20)]);
  assert.ok(computeCoverage(brightenFraction(fill(768, 20), 0.7, 40), b, CFG).coverage > 0.65);
});
test('dark noisy frame stays below enter', () => {
  const b = buildBaseline([noisy(5, 2, 1), noisy(5, 2, 2), noisy(5, 2, 3)]);
  assert.ok(computeCoverage(noisy(5, 3, 9), b, CFG).coverage < 0.1);
});
test('global gain change keeps ncc high', () => {
  const b = buildBaseline([textured(0), textured(0)]);
  const lit = textured(0).map(v => Math.min(255, v * 1.5));
  assert.ok(computeCoverage(lit, b, CFG).ncc >= 0.9);
});
test('adaptBaseline moves mean toward frame', () => {
  const b = buildBaseline([fill(4, 100), fill(4, 100)]);
  adaptBaseline(b, fill(4, 110), 0.1); assert.ok(Math.abs(b.mean[0] - 101) < 1e-6);
});
```
(`noisy(mean, amp, seed)` uses a seeded LCG; `darkenFraction`/`brightenFraction` change the first `fraction·n` cells.)

- [ ] **Step 2: Run `npm test`** — expected FAIL
- [ ] **Step 3: Implement the three modules**
- [ ] **Step 4: Run `npm test`** — expected PASS
- [ ] **Step 5: Commit** `feat: luminance grid, baseline and coverage`

---

### Task 3: Sujood state machine

**Files:**
- Create: `src/detector.js`
- Test: `test/detector.test.js`

**Interfaces:**
- Consumes: `DETECTOR_CONFIG`
- Produces: `createDetector(cfg) → Detector`
  - `Detector.update({ coverage: number, lighting: boolean }, tMs: number) → { state: 'EMPTY'|'COVERING'|'SUJOOD'|'RELEASING', sujood: number, counted: boolean, needsRebaseline: boolean }`
  - `Detector.state` (getter), `Detector.sujood` (getter), `Detector.setSujood(n)`, `Detector.resetState()` (→ EMPTY, keeps count)
  - `lighting = (ncc >= cfg.lightingNcc)`, computed by the engine.

Transitions (SRS FR-11…FR-15):
- EMPTY → COVERING when `coverage ≥ enter` and `!lighting`.
- COVERING → SUJOOD (+1, `counted: true`) when coverage stays ≥ `hold` for `minSujoodMs`. Back to EMPTY if it drops below `hold` sooner.
- SUJOOD → RELEASING when `coverage < exit`. RELEASING → EMPTY after `minClearMs` below exit. Back to SUJOOD (no count) if coverage rises to ≥ `exit` sooner.
- In EMPTY, a frame with `lighting && coverage ≥ enter` starts a relight timer. Once it has been sustained ≥ `relightMs`, return `needsRebaseline: true` once. Never count a frame flagged `lighting` while in EMPTY.

- [ ] **Step 1: Write the failing tests.** Helper `run(det, segments)` steps through `[[coverage, ms, lighting?], …]` at 66 ms steps and returns `{ last, counts, rebaseline }`.

```js
test('quick cover under 0.8 s does not count', () => assert.equal(run(d(), [[0,500],[0.9,500],[0,1000]]).last.sujood, 0));
test('one sujood counts once', () => assert.equal(run(d(), [[0,500],[0.9,1200],[0,800]]).last.sujood, 1));
test('long sujood (30 s) counts once', () => assert.equal(run(d(), [[0.9,30000],[0,800]]).last.sujood, 1));
test('flicker above exit inside sujood counts once', () =>
  assert.equal(run(d(), [[0.9,1000],[0.35,300],[0.9,300],[0.3,300],[0.9,500],[0,800]]).last.sujood, 1));
test('brief release under 0.4 s does not split a sujood', () =>
  assert.equal(run(d(), [[0.9,1000],[0.1,200],[0.9,1000],[0,800]]).last.sujood, 1));
test('two sujood with sitting between count 2', () =>
  assert.equal(run(d(), [[0.9,1500],[0.2,1500],[0.9,1500],[0,800]]).last.sujood, 2));
test('sustained lighting change asks for rebaseline, never counts', () => {
  const r = run(d(), [[1.0, 2000, true]]);
  assert.equal(r.last.sujood, 0); assert.equal(r.rebaseline, 1);
});
test('8 sujood then display shows 5', () => {
  const segs = Array.from({ length: 8 }, () => [[0.9,1200],[0.1,700]]).flat();
  assert.equal(rakahFromSujood(run(d(), segs).last.sujood), 5);
});
```

- [ ] **Step 2: Run `npm test`** — expected FAIL
- [ ] **Step 3: Implement `src/detector.js`**
- [ ] **Step 4: Run `npm test`** — expected PASS
- [ ] **Step 5: Commit** `feat: sujood state machine with hysteresis and lighting guard`

---

### Task 4: Calibrator and light quality

**Files:**
- Create: `src/calibrator.js`, `src/quality.js`
- Test: `test/calibration.test.js`

**Interfaces:**
- Consumes: `frameDiff`, `buildBaseline` (Task 2), `DETECTOR_CONFIG`
- Produces:
  - `createCalibrator(cfg) → { feed(grid, tMs) → { status: 'waiting'|'collecting'|'done', timedOut: boolean, baseline?: Baseline }, restart(tMs) }`
    "Stable" means `frameDiff(prev, grid) < stableDiff`. The calibrator waits for `stableMs` of continuous stability, then collects `calibMs` of frames and returns `done` with `buildBaseline(collected)`. Any unstable frame during waiting or collecting restarts the wait. `timedOut` turns true once `calibTimeoutMs` has passed since start without `done`, and the calibrator keeps trying.
  - `classifyQuality(b: Baseline, cfg) → 'ok'|'low'|'too-dark'`: `too-dark` if `globalMean < tooDarkMean`; `low` if `globalMean < lowMean` or the mean of `noise` is > `lowNoise`; otherwise `ok`.

- [ ] **Step 1: Write the failing tests**

```js
test('stable 1.5 s + 1 s collect → done with baseline', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0; t <= 2700; t += 66) r = c.feed(fill(768, 80), t);
  assert.equal(r.status, 'done'); assert.ok(Math.abs(r.baseline.globalMean - 80) < 0.5);
});
test('instability during collecting restarts wait', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0; t <= 2000; t += 66) r = c.feed(fill(768, 80), t);
  r = c.feed(fill(768, 160), 2066); assert.equal(r.status, 'waiting');
});
test('unstable 21 s → still waiting, timedOut', () => {
  const c = createCalibrator(CFG); let r;
  for (let t = 0, i = 0; t <= 21000; t += 66, i++) r = c.feed(fill(768, i % 2 ? 50 : 150), t);
  assert.equal(r.status, 'waiting'); assert.equal(r.timedOut, true);
});
test('quality classes', () => {
  const q = m => classifyQuality(buildBaseline([fill(768, m), fill(768, m)]), CFG);
  assert.equal(q(100), 'ok'); assert.equal(q(30), 'low'); assert.equal(q(8), 'too-dark');
  assert.equal(classifyQuality(buildBaseline([noisy(80, 30, 1), noisy(80, 30, 2), noisy(80, 30, 3)]), CFG), 'low');
});
```
(Move the `fill`/`noisy` helpers into `test/helpers.js` and import them in Tasks 2–4.)

- [ ] **Step 2: Run `npm test`** — expected FAIL
- [ ] **Step 3: Implement both modules**
- [ ] **Step 4: Run `npm test`** — expected PASS
- [ ] **Step 5: Commit** `feat: calibrator and light quality classification`

---

### Task 5: Engine, camera, test mode and the real-data gate

This is the SRS's "signal test". It's built from the real modules, so nothing is thrown away. Its readout becomes test mode (FR-36/37).

**Files:**
- Create: `src/engine.js`, `src/camera.js`, `src/fake-source.js`, `src/csv.js`, minimal `index.html`, `styles.css`, `src/app.js` (test-mode readout only for now)
- Test: `test/engine.test.js`, `test/csv.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–4
- Produces:
  - Frame source contract: `{ start() → Promise<void>, stop() → void, readFrame() → { rgba: Uint8ClampedArray, w: number, h: number } | null, lock() → Promise<{ locked: boolean }> }`
  - `createCameraSource()` in `camera.js`: `getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false })`, draws the hidden `<video>` into an offscreen canvas of `320×240` max. `lock()` calls `track.applyConstraints({ advanced: [{ exposureMode: 'manual' }, { whiteBalanceMode: 'manual' }, { focusMode: 'manual' }] })` only for modes listed in `track.getCapabilities?.()`, and returns `{ locked }`. On iOS it resolves `{ locked: false }`. Errors from `start()` are `NotAllowedError` / `NotFoundError` and pass through unchanged.
  - `createFakeSource()` in `fake-source.js`: generates a textured 320×240 frame with light noise. Key `C` toggles "head" (darkens 75% of the frame), `L` toggles a ×1.6 light gain, `D` toggles a dark room (mean ≈ 8).
  - `createEngine({ source, cfg, onEvent, now = () => performance.now() }) → { start(), stop(), recalibrate(), tick(), setSujood(n), resetCount() }`
    `tick()` does one frame step (it's public so the tests can drive it). `start()` runs `tick` every `1000/cfg.fps` ms with `setInterval`.
    Events: `{ type: 'calibrating', timedOut }`, `{ type: 'calibrated', quality, locked }`, `{ type: 'tick', coverage, ncc, state, sujood, meanLuma, t }`, `{ type: 'count', sujood }`, `{ type: 'quality', quality }` (only when it changes, checked every `qualityEveryMs` after adapting).
    Rules: after `calibrated`, call `source.lock()` once. While the detector is EMPTY and `frameDiff(prev, grid) < stableDiff`, adapt with `alpha = dt / adaptTauMs`. On `needsRebaseline`, call `recalibrate()`, which keeps the count.
  - `toCsv(rows: object[]) → string` (header from the first row's keys, `\n` line endings, numbers kept as they are)

- [ ] **Step 1: Write failing tests.** `test/engine.test.js` drives the engine with a scripted in-memory source (frames returned from an array, clock from a counter):
  - `calibrates then counts one sujood`: 3 s of a stable textured frame → `calibrated` event; then 1.2 s at 75% darkened → one `count` event with `sujood: 1`.
  - `lighting switch while empty triggers recalibration, no count`: after calibration, 2 s of ×1.6 gain → no `count`, a second `calibrating` event.
  - `recalibrate keeps the count`: `setSujood(3)`, `recalibrate()`, calibrate again → next `tick` event has `sujood: 3`.
  `test/csv.test.js`: `toCsv([{t:1,c:0.5},{t:2,c:0.7}]) === 't,c\n1,0.5\n2,0.7'`.
- [ ] **Step 2: Run `npm test`** — expected FAIL
- [ ] **Step 3: Implement `engine.js`, `csv.js`, `camera.js`, `fake-source.js`**
- [ ] **Step 4: Run `npm test`** — expected PASS
- [ ] **Step 5: Minimal page.** `index.html` has a Start button. With `?test=1` (or the settings toggle later) it shows a monospace readout of coverage %, ncc, state, sujood, quality and locked; a small `<video>` preview; and Record / Export CSV buttons. Records the rows `{t, coverage, ncc, state, sujood, meanLuma}`. Export uses a `Blob` download named `salah-signal-<ISO time>.csv`. `?fake=1` swaps in the fake source.
- [ ] **Step 6: Desktop check.** Serve with `npx --yes serve -l 5173 .` (or `python -m http.server 5173`), open `http://localhost:5173/?fake=1&test=1` in the browser pane, tap Start. Expected: "calibrated / ok". Hold `C` for 1.5 s and release: sujood 1. Tap `C` for 0.3 s: still 1. Toggle `L`: no count, recalibrates. `D`: quality `too-dark`.
- [ ] **Step 7: Deploy a preview** for phone testing (camera needs HTTPS): `npx --yes vercel deploy` from the project root (static, no framework). **Ask the owner before deploying.** It publishes a URL.
- [ ] **Step 8: Commit** `feat: engine, camera source, test mode readout`
- [ ] **Step 9: GATE — real-data check with the owner. Stop and wait.** The owner opens `<preview>/?test=1` on the phone, places it flat past the forehead spot, records and exports a CSV for: 2 prayers in a bright room, 2 under a normal lamp, 2 in a dim room. From the CSVs, report per room: the minimum coverage during sujood, the maximum coverage during the sitting between sujood, and the maximum coverage while standing/ruku. **Pass:** sujood min − sitting max ≥ 0.2 in all rooms, and the counts match. Then set `enter`, `hold` and `exit` in `src/config.js` inside those gaps and re-run `npm test` (update any test values that encode the old thresholds). **Fail:** don't continue. Bring the data back to the owner with a proposal for an extra feature (e.g. cell uniformity: a close head is flat and blurry, while a far body keeps ceiling texture).

---

### Task 6: Counting screen, full screen, reset, wake lock, warnings

**Files:**
- Modify: `index.html`, `styles.css`, `src/app.js`

**Interfaces:**
- Consumes: `createEngine`, `createCameraSource`/`createFakeSource`, `rakahFromSujood`, `hasHalfDot`, `resetVisible`, `saveCount`, `loadCount`

Build:
- **Screens:** start screen (Start button + the one-line privacy note "Camera stays on your phone. Nothing is uploaded."), calibrating status ("Calibrating…" → after `timedOut`: "Keep the area above the phone clear"), too-dark warning ("Too dark to count reliably — turn on a light" + "Count anyway"), permission error (explains why the camera is needed and how to allow it in the browser's site settings), counting screen.
- **Counting screen:** background `#000`. The digit is centred and set from CSS variables `--digit-font`, `--digit-size`, `--digit-color`, `--digit-opacity`. The half dot is a 0.6vmin dot under the digit at the same colour and 50% of digit opacity, shown when `hasHalfDot(s)`. The amber dot (`#b8860b`, 8 px, opacity 0.6) sits top-left when quality is `low`. No CSS transitions or animations anywhere on this screen.
- **Count:** on each `count` event, update the digit and `saveCount(localStorage, s, Date.now())`. At startup, `setSujood(loadCount(localStorage, Date.now(), cfg.restoreMaxMs))`.
- **Full screen:** a ⛶ button (top-right) calls `document.documentElement.requestFullscreen()` when `document.fullscreenEnabled`. Otherwise (an iPhone Safari tab) it shows a one-time hint "Tap Share → Add to Home Screen for full screen", remembered in localStorage. When standalone (`matchMedia('(display-mode: standalone)')`), hide the button. In full screen, show the close control: top-right, 44×44 px hit area, a 10 px "×" glyph at opacity 0.25, no label, calls `document.exitFullscreen()`. The settings icon is hidden in full screen.
- **Reset:** a bottom-centre button, shown per `resetVisible({ fullscreen: !!document.fullscreenElement, displayed })`. Re-evaluated on `fullscreenchange` and on every count. It needs an 800 ms press-and-hold (pointerdown starts, pointerup/leave cancels). The only motion allowed is a fill bar that grows during the hold; it shows only while the finger is down. On completion: `engine.resetCount()`, `saveCount(…, 0, …)`, `engine.recalibrate()`.
- **Wake lock:** `navigator.wakeLock?.request('screen')` once counting starts. Re-request on `visibilitychange` → visible. If unsupported, show a one-time note on the start screen: "Set your screen auto-lock to at least 30 minutes."
- **Hidden page (FR-4):** on `visibilitychange` → hidden, call `engine.stop()` + `source.stop()`. On visible, `source.start()` + `engine.recalibrate()` + `engine.start()`, keeping the count.

- [ ] **Step 1: Implement the screens and wiring above**
- [ ] **Step 2: Run `npm test`** — expected PASS (no regressions)
- [ ] **Step 3: Browser check** at `/?fake=1`: Start → calibrating → counting shows `1`. Two `C` holds → `2`, with the dot after the first. Reload within a minute → still `2`. Enter full screen → reset hidden at ≤4. Push the count to 8 sujood → shows `5` and reset appears. Hold reset 0.8 s → `1`. A short tap on reset does nothing. `D` before calibration → too-dark warning; "Count anyway" proceeds; `low` shows the amber dot. Check at 375×812 (mobile preset) with no horizontal scroll.
- [ ] **Step 4: Commit** `feat: counting screen, fullscreen, hold-to-reset, wake lock, warnings`

---

### Task 7: Settings and customisation

**Files:**
- Create: `src/settings.js`
- Modify: `index.html`, `styles.css`, `src/app.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Produces:
  - `FONTS` — exactly these system stacks (no font downloads):
    `geometric: '"Avenir Next", Futura, "Century Gothic", system-ui, sans-serif'`, `humanist: '"Segoe UI", Roboto, "Helvetica Neue", sans-serif'`, `rounded: 'ui-rounded, "SF Pro Rounded", Nunito, system-ui, sans-serif'`, `serif: 'Georgia, "Times New Roman", serif'`, `mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'`
  - `DEFAULT_SETTINGS = { font: 'geometric', sizePct: 50, color: '#f2f2f2', opacity: 0.7, testMode: false }`
  - `normalizeSettings(raw) → Settings` (unknown font → default; `sizePct` clamped 20–90; `opacity` clamped 0.1–1; colour must match `/^#[0-9a-f]{6}$/i` or default; `testMode` coerced to boolean)
  - `loadSettings(storage) → Settings`, `saveSettings(storage, s) → void` (key `"src.settings"`, never throws)
  - `applySettings(rootStyle: CSSStyleDeclaration, s) → void` (sets the 4 CSS variables; size = `${sizePct}vmin`)

- [ ] **Step 1: Write the failing tests**

```js
test('loadSettings with throwing storage returns defaults', () => assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS));
test('round trip', () => { const st = mem(); saveSettings(st, { ...DEFAULT_SETTINGS, font: 'serif', sizePct: 70 }); assert.equal(loadSettings(st).font, 'serif'); });
test('clamps and validates', () => {
  const s = normalizeSettings({ font: 'comic', sizePct: 200, opacity: 0, color: 'red' });
  assert.deepEqual([s.font, s.sizePct, s.opacity, s.color], ['geometric', 90, 0.1, '#f2f2f2']);
});
test('applySettings sets css variables', () => {
  const props = {}; applySettings({ setProperty: (k, v) => (props[k] = v) }, DEFAULT_SETTINGS);
  assert.equal(props['--digit-size'], '50vmin'); assert.equal(props['--digit-opacity'], '0.7');
});
```

- [ ] **Step 2: Run `npm test`** — expected FAIL
- [ ] **Step 3: Implement `src/settings.js`**
- [ ] **Step 4: Settings panel.** A ⚙ icon top-left (outside full screen only) opens a panel with: font choices (each label written in its own font), a size slider (20–90), 6 colour swatches (`#f2f2f2`, `#9fb4c7`, `#c9b88a`, `#8fbf9f`, `#d49a9a`, `#7a7a7a`) plus `<input type="color">`, an opacity slider (10–100%), a "Test mode" checkbox, and a live preview digit. Changes apply and save immediately. Test mode shows the Task 5 readout on the counting screen. When opacity or colour change while calibrated, call `engine.recalibrate()`, because the screen glow lights the head (FR-25).
- [ ] **Step 5: Run `npm test`** — expected PASS. Browser check: change each setting → preview and counting digit update, and survive a reload.
- [ ] **Step 6: Commit** `feat: digit customisation settings`

---

### Task 8: PWA, offline and production deploy

**Files:**
- Create: `manifest.webmanifest`, `sw.js`, `vercel.json`, `icons/icon.svg`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` (180×180)
- Modify: `index.html` (manifest link, `theme-color #000000`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black`, apple-touch-icon, SW registration in `app.js`)

**Interfaces:**
- `manifest.webmanifest`: `name: "Rakah Counter"`, `short_name: "Rakah"`, `display: "standalone"`, `orientation: "portrait"`, `background_color` and `theme_color` `#000000`, `start_url: "/"`, icons 192/512 (+ `purpose: "any maskable"` on 512).
- `sw.js`: `CACHE = 'rakah-v1'`. On install, pre-cache every file under the root except tests and docs. Fetch is cache-first with a network fallback for same-origin GET. On activate, delete old caches. Bump `CACHE` on every release.
- `vercel.json`: `{ "headers": [{ "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }] }`. Exclude `test/`, `docs/` and `package.json` from the deploy with `.vercelignore`.
- Icons: a simple geometric mark (a crescent or a dot over a line) on black. Render the PNGs from the SVG with any local tool. Keep each under 10 KB.

- [ ] **Step 1: Implement the files**
- [ ] **Step 2: Check weight:** total of the deployed files ≤ 150 KB (`du -ch` over non-ignored files). Expected: well under.
- [ ] **Step 3: Browser check:** DevTools → Application shows the manifest valid and the SW activated. Go offline, reload → the app works.
- [ ] **Step 4: Production deploy** with `npx --yes vercel deploy --prod`. **Ask the owner first.**
- [ ] **Step 5: Phone check (owner):** Android: install, full screen and exit work. iPhone: Add to Home Screen → opens with no browser bars, camera works, screen stays awake.
- [ ] **Step 6: Commit** `feat: PWA manifest, offline service worker, deploy config`

---

### Task 9: Acceptance run (owner, with test mode on)

**Files:**
- Create: `docs/acceptance-log.md`: a table with columns date, room condition, quality class shown, prayer (rakahs), sahw?, long sujood?, head covering, expected final digit, shown final digit, pass, CSV filename.

- [ ] **Step 1: Create the log template**
- [ ] **Step 2: Owner runs the SRS §7 matrix** (10 bright, 10 lamp, 10 dim, 5 dark, 5 disturbance)
- [ ] **Step 3: Review the results against SRS §7 pass criteria.** Any miscount in an `ok` session → load its CSV, find the transition that failed, add a regression test to `test/detector.test.js` that reproduces the coverage sequence, fix, and re-run. Re-tune `config.js` only from data.
- [ ] **Step 4: Commit** `test: acceptance log and regressions`
