# Salah Rakah Counter — Software Requirements Specification

Status: **Draft — awaiting owner approval**
Date: 2026-11-19

Items marked *(builder's call)* were filled in during spec writing, not decided by the owner. They can be changed.

---

## 1. Purpose and intent

People with poor memory often lose track of which rakah they're on during salah. This is a browser app. The phone lies flat on the prayer mat, screen up, just past where the forehead touches. It counts sujood with the front camera and shows the current rakah as one large digit.

**Accuracy matters more than anything else.** A wrong count is worse than no app, because the user trusts it instead of their own memory. The second priority is **not distracting**: the app must never ask for attention during salah.

### 1.1 Goals
- Count sujood from the camera and show the rakah number.
- Keep working in a bright room, a dim room and a very dark room, with automatic calibration.
- Warn clearly when the light is too low to count reliably.
- Minimal, dark, quiet UI. Full screen on phones. The digit's font, size and colour can be customised.
- Zero-hassle hosting: static files on Vercel, no backend.

### 1.2 Non-goals
- Detecting sajdah sahw or sajdah tilawah. They count like any other sujood, so after sahw at the end of a 4-rakah prayer the display goes up past 5 (it shows 6). Users will understand this.
- Knowing which prayer is being prayed, or how many rakahs it has.
- Prayer times, qibla, accounts, history, analytics.
- Native app-store apps.
- Machine learning or face detection. In this camera position the camera sees the top of the head, not the face.

### 1.3 Anti-goals (failure even if it "works")
- Any sound, vibration, flashing, animation or popup while counting.
- Counting one sujood twice, or missing one.
- Needing any touch during salah.
- Sending camera frames off the device.

---

## 2. Usage context

```
        ceiling (what the camera sees when the mat is empty)
             ↑
   [phone, screen up, front camera up]  ← placed just past forehead spot
   ═══════════════ prayer mat ═══════════════
```

1. The user opens the app (ideally from the home screen), taps **Start**, and places the phone on the mat.
2. They stand up. The app calibrates on the empty view.
3. They pray. Each time their head comes down in sujood it covers most of the camera view. Two sujood make one rakah.
4. Between prayers, they hold to reset.

When the user looks down at the sujood spot during salah, which is the recommended gaze, they see the digit.

---

## 3. Platform and deployment

| Item | Requirement |
|---|---|
| Form | Static web app (HTML/CSS/vanilla JS). No framework, no build step *(builder's call)*. |
| Hosting | Vercel static hosting, Hobby plan. Must also run unchanged on any static host (e.g. Cloudflare Pages). |
| Backend | None. |
| HTTPS | Required (camera access). Vercel provides it. |
| PWA | Web app manifest + service worker. All assets cached on first visit; works fully offline afterwards. `display: standalone` (this is the iPhone "full screen" path). |
| Page weight | Total first-load ≤ 150 KB including any self-hosted fonts *(builder's call)*. No third-party requests at runtime. |
| Browsers | Android Chrome (current and previous 2 major versions). iOS Safari 16.4+ both in-browser and installed to home screen. |

---

## 4. Functional requirements

### 4.1 Camera
- **FR-1** Use the front camera (`facingMode: "user"`) at low resolution (≈320×240 is enough; never above 640×480).
- **FR-2** The camera preview is never shown during counting. The camera runs invisibly.
- **FR-3** If permission is denied, or there's no camera, show a plain message explaining why the app needs it and how to allow it.
- **FR-4** Stop the camera stream when the page is hidden. When the page comes back, restart it and recalibrate, without changing the count.

### 4.2 Sujood detection (Option A — "covered view" detector, no ML)

The detector watches how much of the camera's view differs from a calibrated "empty" baseline.

**Pre-processing**
- **FR-5** Each processed frame is downscaled to a luminance grid (start at 32×24 cells; tunable). Target rate ≈ 15 processed frames/s.

**Calibration**
- **FR-6** On Start (and after FR-4 resume), wait until the view is *stable* (low frame-to-frame change) for ≥ 1.5 s. Then capture the baseline: per-cell mean luminance and per-cell noise (variance), over ~1 s.
- **FR-7** While calibrating, the screen shows a quiet status ("Calibrating…"). If the view is not stable within 20 s, show "Keep the area above the phone clear".
- **FR-8** After calibration, try to lock camera exposure, white balance and focus where the browser supports it (`applyConstraints` with `exposureMode`/`whiteBalanceMode`/`focusMode: "manual"` or the current values). Where locking isn't supported (expected on iOS), the detector must still work under auto-exposure (see FR-10).
- **FR-9** While the state is EMPTY and the view is stable, adapt the baseline slowly (an exponential moving average, time constant ~10–30 s). This follows lights being switched on or off and daylight changing, without absorbing a sujood into the baseline.

**Coverage signal**
- **FR-10** For each frame, compute **coverage** = the fraction of cells that differ meaningfully from the baseline. A cell counts as changed when its difference exceeds both a noise-scaled threshold (k × cell noise) and an absolute minimum. Coverage must respond to both a head darker than the background (bright room) and a head brighter than the background (dark room lit by the screen). It must be robust to a global brightness shift caused by auto-exposure, for example by also comparing after removing the global mean or by using local contrast/structure. The exact formula is up to the builder; the acceptance tests in §7 decide.

**State machine**
```
CALIBRATING → EMPTY ⇄ COVERING → SUJOOD → RELEASING → EMPTY
```
- **FR-11** EMPTY → COVERING when coverage ≥ **enter threshold** (start 0.60).
- **FR-12** COVERING → SUJOOD (count +1) once coverage has stayed above the **hold threshold** (start 0.50) for ≥ **min sujood duration** (start 0.8 s). If it drops sooner, go back to EMPTY with no count. This filters hands, a passing arm, a child's quick lean.
- **FR-13** SUJOOD → RELEASING when coverage < **exit threshold** (start 0.25). RELEASING → EMPTY after it stays below exit for ≥ **min clear duration** (start 0.4 s). A new sujood can only be counted from EMPTY. This hysteresis is what prevents double counting.
- **FR-14** A sujood can last any length (long sujood in tahajjud). There is no maximum, and a long sujood never counts twice.
- **FR-15** The baseline never adapts outside EMPTY.
- **FR-16** All thresholds and durations live in one config object so they can be tuned from real recordings.

**Known risk (must be tested first, see §8):** in the sitting between the two sujood, the upper body, seen from below at ~60–80 cm, may still cover a noticeable part of the view. The exit threshold must sit clearly between "sitting" coverage and "sujood" coverage. If real data shows these overlap, the detector needs an extra feature (e.g. "near" objects look uniform and blurry, "far" ones keep ceiling texture) before the rest is built.

### 4.3 Counting and display
- **FR-17** Count sujood `s`. The display shows the **current rakah**: `floor(s/2) + 1` (owner's decision). It shows 1 before praying and rises the moment the 2nd sujood of a pair is counted. In the final sitting of a 4-rakah prayer it shows 5, and after sajdah sahw it shows 6. The reset start value is 1 (s = 0).
  *Rejected alternative:* completed rakahs, `floor(s/2)`.
- **FR-18** Half-rakah marker *(builder's call)*: after the first sujood of a pair, show a small dim dot under the digit until the second sujood is counted. This answers "did I do one sujood or two?" without adding noise.
- **FR-19** Changes to the number are instant, with no animation (anti-goal).
- **FR-20** Persist the count and the last-update time locally. On reload within 15 minutes, restore it; otherwise start fresh *(builder's call)*.

### 4.4 Low-light warning
- **FR-21** During calibration, estimate signal quality from the baseline: mean luminance, noise level, and the contrast available. Classify it as **OK**, **Low** or **Too dark**.
- **FR-22** **Too dark**: before counting starts, show a clear warning ("Too dark to count reliably — turn on a light"). The user can still choose "Count anyway".
- **FR-23** **Low**: while counting, show a tiny, dim amber dot in a corner. Nothing that moves or flashes.
- **FR-24** Re-evaluate whenever the baseline adapts. If the room gets too dark mid-prayer, change the indicator quietly; never pop up anything during counting.
- **FR-25** The dark-room case relies on the screen's own glow to light the head. The digit colour and brightness the user picks change that glow, so quality estimation must run after the display settings are applied.

### 4.5 Screen, full screen, buttons
- **FR-26** Keep the screen awake while counting (Screen Wake Lock API). Re-acquire it on `visibilitychange`. If it's unsupported, tell the user to raise their auto-lock time.
- **FR-27** Full-screen button on the main screen. Use the Fullscreen API where supported (Android). Where it isn't (iPhone Safari tab), show a one-time hint to "Add to Home Screen" instead. When installed in standalone mode, the app is already full screen.
- **FR-28** In full screen, a **close full screen** control: small, low-opacity, in a corner, minimum 44×44 px touch area, no label.
- **FR-29** **Reset** visibility:
  - Not full screen: always visible.
  - Full screen: visible only when the displayed number > 4.
- **FR-30** Reset needs a ~0.8 s press-and-hold, with a subtle fill as feedback, to avoid accidental resets *(builder's call)*. Reset sets the count to the start value and recalibrates.
- **FR-31** No other controls are visible during counting.

### 4.6 Customisation
- **FR-32** Settings (opened from a small icon, outside full screen only):
  - Digit font: 4–6 choices, from system font stacks plus at most 2 small self-hosted fonts (digits-only subsets) *(builder's call)*.
  - Digit size: slider, ~20–90% of the shorter screen side.
  - Digit colour: preset swatches plus a custom picker.
  - Digit brightness (opacity): slider, to make it dimmer and less distracting.
- **FR-33** A live preview inside settings.
- **FR-34** Stored in `localStorage`. If storage fails, the app works with defaults.
- **FR-35** Defaults: background pure black, digit soft white at ~70% opacity, a geometric sans, ~50% size.

### 4.7 Diagnostics (for tuning)
- **FR-36** Hidden "Test mode" toggle in settings. It shows live coverage %, state, quality class, and an optional small camera preview.
- **FR-37** In test mode, the user can record the signal log (timestamp, coverage, state, mean luminance) and export it as CSV. No images are recorded.

---

## 5. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 Accuracy | See §7. Zero miscounts is the target. |
| NFR-2 Privacy | No frame, image or derived data leaves the device. No analytics, no third-party scripts. Say this in the UI in one line. |
| NFR-3 Performance | Processing ≤ ~5 ms per frame on a mid-range 2021 Android phone. No visible jank. |
| NFR-4 Battery | A 30-minute session uses a small share of the battery. Low-res frames, ~15 fps processing, nothing drawn per frame in normal mode. |
| NFR-5 Distraction | Pure black background (OLED-friendly). Only the digit and optional dot are visible while counting. |
| NFR-6 Offline | Fully works offline after the first visit. |
| NFR-7 Accessibility | Settings controls are labelled and big enough to tap. Digit colours have reasonable contrast. |

---

## 6. Screens (text sketch)

```
Main (not full screen)          Full screen, count ≤ 4      Full screen, count > 4
┌─────────────────────┐         ┌───────────────────┐       ┌───────────────────┐
│ ⚙               ⛶   │         │                 · │       │                 · │
│                     │         │                   │       │                   │
│         2           │         │        3          │       │        5          │
│         •           │         │                   │       │                   │
│                     │         │                   │       │                   │
│      [ hold ↺ ]     │         │                   │       │    [ hold ↺ ]     │
└─────────────────────┘         └───────────────────┘       └───────────────────┘
 ⚙ settings  ⛶ full screen       · = tiny close-full-screen control
 • = half-rakah dot (FR-18)       amber corner dot only when light is Low
```

---

## 7. Acceptance tests

The test is done by real people praying real salah, with test mode logging on.

| Condition | Sessions |
|---|---|
| Bright room (daylight / strong ceiling light) | 10 |
| Normal room lamp | 10 |
| Dim (single small lamp) | 10 |
| Dark (only the phone screen) — expect "Low"/"Too dark" classification | 5 |
| Varied head covering: bare head, cap, hijab | spread across the above |
| 2-, 3- and 4-rakah prayers; one with sajdah sahw; one with a long sujood (> 20 s) | spread across the above |
| Disturbance: someone walking past; a hand reaching over the phone | 5 |

Pass criteria:
- 0 miscounts in OK-quality sessions.
- In "Low" sessions, miscounts are rare and the warning was shown.
- "Too dark" is shown whenever counting was unreliable.
- No false counts from disturbances shorter than the minimum sujood duration.

---

## 8. Build order

1. **Signal test (throwaway).** Camera + coverage + state machine + test-mode readout and CSV only. Pray with it in bright and dim rooms. Confirm that sitting and sujood coverage are clearly separated (§4.2 risk). Tune the thresholds.
2. Full detector with calibration, adaptation, exposure lock, quality classification.
3. Counting display, full screen, reset, wake lock, persistence.
4. Settings / customisation.
5. PWA (manifest, service worker, icons), deploy to Vercel.
6. Acceptance tests (§7).

## 9. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. "Covered view" pixel detector** (no ML) | Tiny, instant, offline, lighting-agnostic via baseline change. Weak against non-head objects covering the camera; duration filters most of that. | **Chosen** |
| B. Small ML classifier (head-close vs. ceiling) | May handle odd cases better; needs training data that doesn't exist yet. | Only if A fails in testing |
| Face detection model | The camera sees the top of the head in sujood, not the face. | Rejected |
| Proximity / ambient light sensors | Ideal signal, but browsers don't give web pages access. | Not possible |
