// App shell: input selection, mode switching, keyboard shortcuts, meters,
// settings, debug view and the simulated-guitar "bot".
import { AudioEngine } from './audio/engine.js';
import { ChordJudge, NoteTracker } from './audio/detectors.js';
import { SENSITIVITY } from './audio/chroma.js';
import { store } from './storage.js';
import { $, escapeHtml } from './ui/common.js';
import { noteName, SHARP_NAMES } from './music/theory.js';
import { ChordsMode } from './modes/chords.js';
import { FretboardMode } from './modes/fretboard.js';
import { NpmMode } from './modes/npm.js';
import { SightMode } from './modes/sight.js';
import { TunerMode } from './modes/tuner.js';

const MODES = { chords: ChordsMode, fretboard: FretboardMode, npm: NpmMode, sight: SightMode, tuner: TunerMode };
const SETTINGS_DEFAULTS = { sensitivity: 'normal', onsetSensitivity: 1, inputGain: 1, simVolume: 0.6, debug: false };

const engine = new AudioEngine();
const app = {
  engine,
  store,
  judge: null,
  notes: null,
  mode: null,
  modeId: null,
  configEl: $('#config'),
  configExtraEl: $('#configExtra'),
  stageEl: $('#stage'),
};
window.monkeycord = app; // handy for debugging in the console

const settings = () => ({ ...SETTINGS_DEFAULTS, ...store.settings });

// ---------------------------------------------------------------------------
// Start / input selection
// ---------------------------------------------------------------------------
async function startAudio(source) {
  const err = $('#micError');
  err.textContent = '';
  try {
    await engine.useSource(source);
  } catch (e) {
    console.error(e);
    err.textContent =
      e?.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow it in the address bar, or try the simulated guitar.'
        : `Could not start audio: ${e?.message || e}`;
    return false;
  }
  if (!app.judge) {
    const s = settings();
    app.judge = new ChordJudge(engine.analyzer, { sensitivity: s.sensitivity });
    app.notes = new NoteTracker(engine.analyzer);
    engine.analyzer.onset.sensitivity = s.onsetSensitivity;
    engine.setInputGain(s.inputGain);
    engine.setSimVolume(s.simVolume);
    engine.analyzer.onFrame((f) => {
      if (f.onset) {
        const m = $('.meter');
        m.classList.remove('onset');
        void m.offsetWidth;
        m.classList.add('onset');
      }
    });
  }
  store.saveSettings({ source });
  $('#startOverlay').hidden = true;
  renderSource();
  switchMode(modeFromHash());
  return true;
}

function renderSource() {
  const btn = $('#sourceBtn');
  const sim = engine.source === 'sim';
  btn.innerHTML = `<span class="dot ${sim ? 'sim' : 'mic'}"></span>${sim ? 'simulated guitar' : 'microphone'}`;
  btn.title = sim ? 'Switch to microphone' : 'Switch to simulated guitar';
  document.body.classList.toggle('sim', sim);
  $('#simHints').hidden = !sim;
  renderBot();
}

$('#useMic').addEventListener('click', () => startAudio('mic'));
$('#useSim').addEventListener('click', () => startAudio('sim'));
$('#sourceBtn').addEventListener('click', async (e) => {
  e.currentTarget.blur();
  if (!engine.source) {
    $('#startOverlay').hidden = false;
    return;
  }
  await startAudio(engine.source === 'sim' ? 'mic' : 'sim');
});

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function modeFromHash() {
  const id = location.hash.replace('#', '');
  return MODES[id] ? id : store.settings.mode && MODES[store.settings.mode] ? store.settings.mode : 'chords';
}

function switchMode(id) {
  if (!app.judge) return;
  if (app.mode) app.mode.unmount();
  app.modeId = id;
  app.mode = new MODES[id](app);
  document.querySelectorAll('.modes button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === id);
    b.setAttribute('aria-selected', b.dataset.mode === id);
  });
  store.saveSettings({ mode: id });
  bot.lastKey = null;
  app.mode.mount();
}

document.querySelectorAll('.modes button').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (location.hash !== `#${b.dataset.mode}`) location.hash = b.dataset.mode;
    else switchMode(b.dataset.mode);
  }),
);
window.addEventListener('hashchange', () => switchMode(modeFromHash()));

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (e.key === 'Escape' && !$('#settings').hidden) {
    toggleSettings(false);
    return;
  }
  if (!app.mode || typing) return;
  if (e.key === 'Tab' || e.key === 'Escape') {
    e.preventDefault();
    app.mode.restart();
    bot.lastKey = null;
  } else if (e.key === ' ') {
    e.preventDefault();
    app.mode.skip();
  } else if (e.key === '`') {
    toggleDebug();
  } else if (engine.source === 'sim') {
    if (e.key === 'Enter') {
      e.preventDefault();
      app.mode.simulate(true);
    } else if (e.key === 'x') app.mode.simulate(false);
    else if (e.key === 'b') toggleBot();
  }
});

// ---------------------------------------------------------------------------
// Simulated-guitar bot: plays the targets with human-ish timing and mistakes.
// ---------------------------------------------------------------------------
const bot = { on: false, lastKey: null, pending: false, nextAt: 0, lastPlay: 0 };

function toggleBot() {
  bot.on = !bot.on;
  bot.lastKey = null;
  renderBot();
}
function renderBot() {
  const el = $('#botBtn');
  if (!el) return;
  el.classList.toggle('active', bot.on);
  el.textContent = bot.on ? 'bot: on' : 'bot: off';
}
$('#botBtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  toggleBot();
});

function botDelay() {
  const base = { chords: [550, 1300], fretboard: [500, 1400], npm: [180, 420], sight: [350, 900], tuner: [900, 1600] }[app.modeId] || [400, 900];
  return base[0] + Math.random() * (base[1] - base[0]);
}

function botTick(now) {
  if (!bot.on || engine.source !== 'sim' || !app.mode) return;
  const key = app.mode.botKey();
  if (!key) return;
  if (key !== bot.lastKey) {
    bot.lastKey = key;
    bot.pending = true;
    bot.nextAt = now + botDelay();
  } else if (!bot.pending && now - bot.lastPlay > 1600) {
    bot.pending = true;
    bot.nextAt = now + 150;
  }
  if (bot.pending && now >= bot.nextAt) {
    bot.pending = false;
    bot.lastPlay = now;
    app.mode.simulate(Math.random() > 0.08);
  }
}

// ---------------------------------------------------------------------------
// Settings popover
// ---------------------------------------------------------------------------
function toggleSettings(show) {
  const el = $('#settings');
  el.hidden = show === undefined ? !el.hidden : !show;
  if (!el.hidden) renderSettings();
}
$('#settingsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  e.currentTarget.blur();
  toggleSettings();
});
document.addEventListener('click', (e) => {
  const el = $('#settings');
  if (!el.hidden && !el.contains(e.target)) toggleSettings(false);
});

function renderSettings() {
  const s = settings();
  const el = $('#settings');
  el.innerHTML = `
    <h2>settings</h2>
    <label class="set-row"><span>chord strictness</span>
      <span class="seg">${Object.keys(SENSITIVITY).map((k) => `<button type="button" class="pill${s.sensitivity === k ? ' active' : ''}" data-sens="${k}">${k}</button>`).join('')}</span></label>
    <p class="set-help">Lenient accepts sloppier chords but may let near-identical chords (C vs Cmaj7) through.</p>
    <label class="set-row"><span>strum sensitivity</span><input type="range" min="0.5" max="2" step="0.1" value="${s.onsetSensitivity}" data-k="onsetSensitivity"><output>${s.onsetSensitivity}×</output></label>
    <label class="set-row"><span>input gain</span><input type="range" min="1" max="8" step="0.5" value="${s.inputGain}" data-k="inputGain"><output>${s.inputGain}×</output></label>
    <label class="set-row"><span>simulated guitar volume</span><input type="range" min="0" max="1" step="0.05" value="${s.simVolume}" data-k="simVolume"><output>${Math.round(s.simVolume * 100)}%</output></label>
    <label class="set-row"><span>show detector view</span><input type="checkbox" ${s.debug ? 'checked' : ''} data-k="debug"></label>
    <p class="set-help">Audio is analysed locally in your browser. Nothing is recorded or uploaded.</p>`;
  el.querySelectorAll('[data-sens]').forEach((b) =>
    b.addEventListener('click', () => {
      store.saveSettings({ sensitivity: b.dataset.sens });
      if (app.judge) app.judge.sensitivity = b.dataset.sens;
      renderSettings();
    }),
  );
  el.querySelectorAll('input[type=range]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      const k = inp.dataset.k;
      store.saveSettings({ [k]: v });
      inp.nextElementSibling.textContent = k === 'simVolume' ? `${Math.round(v * 100)}%` : `${v}×`;
      if (k === 'onsetSensitivity' && engine.analyzer) engine.analyzer.onset.sensitivity = v;
      if (k === 'inputGain') engine.setInputGain(v);
      if (k === 'simVolume') engine.setSimVolume(v);
    }),
  );
  el.querySelector('input[data-k=debug]').addEventListener('change', (e) => {
    store.saveSettings({ debug: e.target.checked });
    $('#debug').hidden = !e.target.checked;
  });
}

function toggleDebug() {
  const on = $('#debug').hidden;
  $('#debug').hidden = !on;
  store.saveSettings({ debug: on });
}
$('#debug').hidden = !settings().debug;

// ---------------------------------------------------------------------------
// Render loop: level meter, mode timers, bot, detector view.
// ---------------------------------------------------------------------------
function renderDebug() {
  const el = $('#debug');
  if (el.hidden || !app.judge) return;
  const a = engine.analyzer;
  const last = app.judge.last;
  const target = last?.target || app.judge.target;
  const chroma = last?.chroma || new Float64Array(12);
  const bars = SHARP_NAMES.map((n, pc) => {
    const inT = target?.pcs.includes(pc);
    return `<div class="db-bar${inT ? ' in-target' : ''}"><div style="height:${Math.round(chroma[pc] * 100)}%"></div><span>${n}</span></div>`;
  }).join('');
  const cur = app.notes.current;
  const th = SENSITIVITY[app.judge.sensitivity].threshold;
  const db = (x) => `${(20 * Math.log10(Math.max(x, 1e-6))).toFixed(0)} dB`;
  el.innerHTML = `
    <div class="db-chroma">${bars}</div>
    <div class="db-text">
      <div>waiting for <b>${escapeHtml(app.judge.target?.name ?? '–')}</b> · last strum checked against <b>${escapeHtml(last?.target?.name ?? '–')}</b>: score <b>${last ? last.score.toFixed(2) : '–'}</b> (needs ≥ ${th}) ${last ? (last.match ? '<span class="good">match</span>' : `<span class="bad">no match</span>${last.bestOtherChord ? ` · closer: ${escapeHtml(last.bestOtherChord.name)} ${last.bestOther.toFixed(2)}` : ''}`) : ''}</div>
      <div>pitch <b>${cur ? `${noteName(cur.midi, { octave: true })} ${cur.cents >= 0 ? '+' : ''}${cur.cents}¢` : '–'}</b>${cur ? ` · ${cur.freq.toFixed(1)} Hz · clarity ${cur.clarity.toFixed(2)}` : ''}</div>
      <div>level ${db(engine.level)} · noise floor ${db(a.noiseFloor)} · sample rate ${a.sampleRate} Hz</div>
    </div>`;
}

let lastDebug = 0;
function loop(now) {
  if (engine.analyzer) {
    const dbv = 20 * Math.log10(Math.max(engine.level, 1e-6));
    const pct = Math.max(0, Math.min(100, ((dbv + 60) / 60) * 100));
    $('.meter-fill').style.width = `${pct}%`;
  }
  if (app.mode) app.mode.tick();
  botTick(now);
  if (now - lastDebug > 80) {
    lastDebug = now;
    renderDebug();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Show the remembered source on the start card.
if (store.settings.source === 'sim') $('#useSim').classList.add('primary');
