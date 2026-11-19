import { DETECTOR_CONFIG as CFG } from './config.js';
import { rakahFromSujood, hasHalfDot, resetVisible, saveCount, loadCount } from './counter.js';
import { createEngine } from './engine.js';
import { createCameraSource } from './camera.js';
import { createFakeSource } from './fake-source.js';
import { FONTS, loadSettings, saveSettings, normalizeSettings, applySettings } from './settings.js';
import { toCsv } from './csv.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = (() => { try { return window.localStorage; } catch { return { getItem: () => null, setItem() {} }; } })();
const ls = {
  get: k => { try { return store.getItem(k); } catch { return null; } },
  set: (k, v) => { try { store.setItem(k, v); } catch { /* blocked */ } },
};

let settings = loadSettings(store);
if (params.has('test')) settings.testMode = true;
applySettings(document.documentElement.style, settings);

const source = params.has('fake') ? createFakeSource() : createCameraSource();
const engine = createEngine({ source, cfg: CFG, onEvent });
engine.setSujood(loadCount(store, Date.now(), CFG.restoreMaxMs));

let started = false, quality = null, darkDismissed = false, wakeLock = null;
// Only the calibration right after Start (or the Recalibrate button) may show the
// too-dark warning. Recalibrations during salah (light switch, settings, page resume)
// must never pop anything up (FR-24).
let warnArmed = false, warnTimer = null;
// The warning window closes 15 s after Start, so a slow calibration can never
// pop it up once salah has begun (review #3).
function armWarning() {
  warnArmed = true;
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => { warnArmed = false; }, 15000);
}

let restarting = false;
async function restartCamera() {
  if (restarting || !started || document.hidden) return;
  restarting = true;
  source.stop();
  try {
    await source.start();
    attachPreview();
    engine.recalibrate(); // keeps the count
  } catch { show('error'); }
  restarting = false;
}
let recording = false, rows = [];

/* ---------- screens ---------- */
function show(id) { for (const s of ['start', 'error', 'count']) $(s).hidden = s !== id; }

async function begin() {
  try {
    await source.start();
  } catch (e) {
    $('error-text').textContent = e && e.name === 'NotFoundError'
      ? 'No front camera was found on this device. The counter needs it to see sujood.'
      : "The counter sees your head come down in sujood through the front camera. Allow camera access for this site in your browser's site settings, then try again.";
    show('error');
    return;
  }
  started = true;
  armWarning();
  show('count');
  attachPreview();
  engine.start();
  requestWakeLock();
  render();
}

/* ---------- engine events ---------- */
function onEvent(e) {
  switch (e.type) {
    case 'calibrating':
      setStatus(e.timedOut ? 'Keep the area above the phone clear' : 'Calibrating…');
      break;
    case 'calibrated':
      setStatus('');
      setQuality(e.quality, warnArmed);
      warnArmed = false;
      break;
    case 'quality':
      setQuality(e.quality, false);
      break;
    case 'count':
      saveCount(store, e.sujood, Date.now());
      render();
      break;
    case 'locked':
      lockedState = e.locked;
      break;
    case 'stalled':
      restartCamera(); // camera froze (call, Control Center, another app) — review #6
      break;
    case 'tick':
      if (settings.testMode) readout(e);
      if (recording) rows.push({ t: Math.round(e.t), coverage: e.coverage.toFixed(3), residual: e.residual.toFixed(3), ncc: e.ncc.toFixed(3), state: e.state, sujood: e.sujood, meanLuma: e.meanLuma.toFixed(1) });
      break;
  }
}
let lockedState = false;

function setStatus(text) { $('status').textContent = text; $('status').hidden = !text; }

function setQuality(q, atCalibration) {
  quality = q;
  // Too dark at calibration → one clear warning before counting (FR-22).
  // Mid-prayer changes only touch the amber dot, never a popup (FR-24).
  $('dark').hidden = !(atCalibration && q === 'too-dark' && !darkDismissed);
  $('amber').hidden = q === 'ok';
}

/* ---------- display ---------- */
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

function render() {
  const s = engine.sujood, displayed = rakahFromSujood(s), fs = isFullscreen();
  $('digit').textContent = String(displayed);
  $('half').hidden = !hasHalfDot(s);
  $('reset-btn').hidden = !resetVisible({ fullscreen: fs, displayed });
  $('fs-btn').hidden = fs || isStandalone();
  $('fs-close').hidden = !fs;
  $('settings-btn').hidden = fs;
  $('testpanel').hidden = !settings.testMode;
}

/* ---------- full screen ---------- */
$('fs-btn').addEventListener('click', () => {
  if (fsSupported()) {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else if (!ls.get('src.hint.a2hs')) {
    $('hint').hidden = false;
  }
});
$('hint-ok').addEventListener('click', () => { $('hint').hidden = true; ls.set('src.hint.a2hs', '1'); });
$('fs-close').addEventListener('click', () => (document.exitFullscreen || document.webkitExitFullscreen).call(document));
document.addEventListener('fullscreenchange', render);
document.addEventListener('webkitfullscreenchange', render);

/* ---------- hold to reset ---------- */
{
  const btn = $('reset-btn');
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('holding');
    timer = setTimeout(() => {
      cancel();
      engine.resetCount();
      saveCount(store, 0, Date.now());
      if (started) engine.recalibrate();
      render();
    }, 800);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, cancel);
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- too dark ---------- */
$('dark-anyway').addEventListener('click', () => { darkDismissed = true; $('dark').hidden = true; });
$('dark-recal').addEventListener('click', () => { $('dark').hidden = true; armWarning(); engine.recalibrate(); });

/* ---------- wake lock + page visibility (FR-4, FR-26) ---------- */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { if (started && !document.hidden) requestWakeLock(); });
  } catch { wakeLock = null; }
}
// iOS home-screen apps before 18.4 expose wakeLock but don't honour it (review #7).
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!('wakeLock' in navigator) || (isIOS && isStandalone())) $('wakelock-note').hidden = false;

document.addEventListener('visibilitychange', async () => {
  if (!started) return;
  if (document.hidden) {
    engine.stop();
    source.stop();
  } else {
    try { await source.start(); } catch { show('error'); return; }
    attachPreview();
    engine.start(); // recalibrates, keeps the count
    requestWakeLock();
    render();
  }
});

/* ---------- test mode ---------- */
function attachPreview() {
  const panel = $('testpanel');
  if (!source.video || panel.querySelector('video')) return;
  source.video.setAttribute('aria-hidden', 'true');
  panel.prepend(source.video);
}
function readout(e) {
  $('readout').textContent =
    `coverage ${(e.coverage * 100).toFixed(0).padStart(3)}%   resid ${(e.residual * 100).toFixed(0)}%\n` +
    `state    ${e.state.padEnd(9)} sujood ${e.sujood}\n` +
    `light    ${(quality || '-').padEnd(9)} luma ${e.meanLuma.toFixed(0)}  lock ${lockedState ? 'yes' : 'no'}` +
    (recording ? `\nrecording ${rows.length} rows` : '');
}
$('rec-btn').addEventListener('click', () => {
  recording = !recording;
  if (recording) rows = [];
  $('rec-btn').textContent = recording ? 'Stop' : 'Record';
  $('csv-btn').disabled = recording || !rows.length;
});
$('csv-btn').addEventListener('click', () => {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salah-signal-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- settings ---------- */
const SWATCHES = ['#f2f2f2', '#9fb4c7', '#c9b88a', '#8fbf9f', '#d49a9a', '#7a7a7a'];
const FONT_LABELS = { geometric: 'Geometric', humanist: 'Humanist', rounded: 'Rounded', serif: 'Serif', mono: 'Mono' };
let recalTimer = null;

function buildSettings() {
  const fl = $('font-list');
  for (const key of Object.keys(FONTS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'choice'; b.dataset.font = key;
    b.style.fontFamily = FONTS[key];
    b.textContent = '1 2 3'; b.setAttribute('aria-label', FONT_LABELS[key]); b.title = FONT_LABELS[key];
    b.addEventListener('click', () => update({ font: key }));
    fl.append(b);
  }
  const sw = $('swatches');
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'choice swatch'; b.dataset.color = c;
    b.style.background = c; b.setAttribute('aria-label', `Colour ${c}`);
    b.addEventListener('click', () => update({ color: c }, true));
    sw.append(b);
  }
  $('size').addEventListener('input', e => update({ sizePct: +e.target.value }));
  $('opacity').addEventListener('input', e => update({ opacity: +e.target.value / 100 }, true));
  $('color').addEventListener('input', e => update({ color: e.target.value }, true));
  $('testmode').addEventListener('change', e => update({ testMode: e.target.checked }));
  $('settings-btn').addEventListener('click', () => { syncSettingsUI(); $('settings').showModal(); });
}

function update(patch, affectsGlow = false) {
  settings = normalizeSettings({ ...settings, ...patch });
  saveSettings(store, settings);
  applySettings(document.documentElement.style, settings);
  syncSettingsUI();
  render();
  // The screen's glow lights the head in a dark room (FR-25): rebuild the baseline.
  if (affectsGlow && started) { clearTimeout(recalTimer); recalTimer = setTimeout(() => engine.recalibrate(), 600); }
}

function syncSettingsUI() {
  for (const b of $('font-list').children) b.setAttribute('aria-pressed', String(b.dataset.font === settings.font));
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.color === settings.color));
  $('size').value = settings.sizePct; $('size-out').textContent = `${settings.sizePct}%`;
  $('opacity').value = Math.round(settings.opacity * 100); $('opacity-out').textContent = `${Math.round(settings.opacity * 100)}%`;
  $('color').value = settings.color;
  $('testmode').checked = settings.testMode;
}

/* ---------- boot ---------- */
buildSettings();
syncSettingsUI();
$('start-btn').addEventListener('click', begin);
$('retry-btn').addEventListener('click', begin);
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
