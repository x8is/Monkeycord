// Notes per minute: play scale runs / sequences cleanly and fast.
import { NoteModeBase } from './note-base.js';
import { STANDARD_TUNING, STRING_NAMES, SHARP_NAMES, FLAT_NAMES, pitchClass, parsePitchClass } from '../music/theory.js';
import { barChart, fretboardSVG } from '../ui/svg.js';
import { renderConfig, renderResults, tableHtml, fmtMs, fmtSec, avg, median, pick, speedClass, escapeHtml } from '../ui/common.js';

const SCALES = {
  major: { label: 'major', iv: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'minor', iv: [0, 2, 3, 5, 7, 8, 10] },
  minPent: { label: 'minor pent', iv: [0, 3, 5, 7, 10] },
  majPent: { label: 'major pent', iv: [0, 2, 4, 7, 9] },
  blues: { label: 'blues', iv: [0, 3, 5, 6, 7, 10] },
};
const KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'random'];
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db use flats
const DEFAULTS = { scale: 'minPent', key: 'A', pattern: 'updown', octave: 'strict', test: 'count', count: 50, time: 60 };
const pretty = (s) => s.replace('#', '♯').replace(/([A-G])b/, '$1♭');

/** Scale notes within a 5-fret box anchored on the root's position on the low E string. */
export function scaleBox(rootPc, intervals) {
  const f0 = (rootPc - 4 + 12) % 12;
  const lo = Math.max(0, f0 - 1);
  const hi = lo + 4;
  const seen = new Map();
  for (let s = 0; s < 6; s++) {
    for (let f = lo; f <= hi; f++) {
      const midi = STANDARD_TUNING[s] + f;
      const deg = (pitchClass(midi) - rootPc + 12) % 12;
      if (intervals.includes(deg) && !seen.has(midi)) seen.set(midi, { midi, string: s, fret: f });
    }
  }
  return { notes: [...seen.values()].sort((a, b) => a.midi - b.midi), lo, hi };
}

export class NpmMode extends NoteModeBase {
  static id = 'npm';
  static label = 'notes';

  constructor(app) {
    super(app, 'npm', DEFAULTS);
    this.timing = 'interval';
  }

  renderConfig() {
    const groups = [
      { key: 'scale', options: Object.entries(SCALES).map(([k, s]) => ({ value: k, label: s.label })), value: this.cfg.scale },
      { key: 'key', options: KEYS.map((k) => ({ value: k, label: pretty(k) })), value: this.cfg.key },
      { key: 'pattern', options: [{ value: 'updown', label: 'up & down' }, { value: 'thirds', label: 'in thirds' }, { value: 'random', label: 'random walk' }], value: this.cfg.pattern },
      { key: 'octave', options: [{ value: 'strict', label: 'exact octave', title: 'The note must be in the shown octave/position' }, { value: 'any', label: 'any octave' }], value: this.cfg.octave },
      { key: 'test', options: [{ value: 'count', label: 'notes' }, { value: 'time', label: 'time' }], value: this.cfg.test },
      this.cfg.test === 'time'
        ? { key: 'time', options: [30, 60, 120].map((v) => ({ value: v, label: String(v) })), value: this.cfg.time }
        : { key: 'count', options: [25, 50, 100].map((v) => ({ value: v, label: String(v) })), value: this.cfg.count },
    ];
    renderConfig(this.app.configEl, groups, (k, v) => {
      this.saveCfg({ [k]: v });
      this.renderConfig();
      this.restart();
    });
    this.app.configExtraEl.innerHTML = '';
  }

  get testKey() {
    return `npm:${this.cfg.scale}:${this.cfg.pattern}:${this.cfg.octave}:${this.cfg.test === 'time' ? `t${this.cfg.time}` : `n${this.cfg.count}`}`;
  }

  restart() {
    const keyName = this.cfg.key === 'random' ? pick(KEYS.slice(0, -1)) : this.cfg.key;
    this.rootPc = parsePitchClass(keyName);
    this.keyName = keyName;
    this.box = scaleBox(this.rootPc, SCALES[this.cfg.scale].iv);
    this.walkPos = 0;
    this.walkDir = 1;
    super.restart();
  }

  name(midi) {
    const pc = pitchClass(midi);
    return (FLAT_KEYS.has(this.rootPc) ? FLAT_NAMES : SHARP_NAMES)[pc];
  }

  makeTargets(n) {
    const notes = this.box.notes;
    const out = [];
    const L = notes.length;
    if (this.cfg.pattern === 'updown') {
      // Continue a bouncing walk through the box: 0..L-1..0..
      while (out.length < n) {
        out.push(notes[this.walkPos]);
        if (this.walkPos + this.walkDir < 0 || this.walkPos + this.walkDir >= L) this.walkDir *= -1;
        this.walkPos += this.walkDir;
      }
    } else if (this.cfg.pattern === 'thirds') {
      // 1-3, 2-4, 3-5 ... up then down
      while (out.length < n) {
        const i = this.walkPos;
        const j = i + 2 * this.walkDir;
        if (j < 0 || j >= L) {
          this.walkDir *= -1;
          continue;
        }
        out.push(notes[i], notes[j]);
        this.walkPos += this.walkDir;
      }
    } else {
      let i = this.walkPos;
      while (out.length < n) {
        const steps = [-2, -1, 1, 2].filter((d) => i + d >= 0 && i + d < L);
        i += pick(steps);
        out.push(notes[i]);
      }
      this.walkPos = i;
    }
    return out.map((x) => ({ ...x, label: this.name(x.midi) }));
  }

  accepts(t, midi) {
    return this.cfg.octave === 'strict' ? midi === t.midi : pitchClass(midi) === pitchClass(t.midi);
  }

  simMidi(t) {
    return t.midi;
  }

  liveHtml(elapsed) {
    const prog = this.cfg.test === 'time' ? Math.max(0, Math.ceil(this.cfg.time - elapsed)) : `${this.items.length}/${this.cfg.count}`;
    const n = this.hits.length;
    const npm = elapsed > 2 ? Math.round(((n - 1) / elapsed) * 60) : 0;
    return `<span class="live-main">${prog}</span><span>${npm} npm</span>`;
  }

  renderStage() {
    const from = Math.max(0, this.idx - 5);
    const med = median(this.timed.map((i) => i.ms));
    const toks = [];
    for (let i = from; i < this.idx + 12; i++) {
      const t = this.targets[i];
      let cls = 'tok note-tok';
      let sub = `${STRING_NAMES[t.string]}·${t.fret}`;
      if (i < this.idx) {
        const it = this.items[i];
        cls += ' done';
        if (it?.skipped) cls += ' skipped';
        else if (it?.ms != null && !it.afterSkip) cls += ` ${speedClass(it.ms, med)}`;
        if (it?.wrongs) cls += ' had-wrong';
      } else if (i === this.idx) cls += ' current';
      toks.push(`<div class="${cls}"><span class="tok-name">${escapeHtml(pretty(t.label))}</span><span class="tok-sub">${sub}</span></div>`);
    }
    const t = this.target;
    const scaleLabel = `${pretty(this.keyName)} ${SCALES[this.cfg.scale].label} · frets ${this.box.lo}–${this.box.hi}`;
    const marks = this.box.notes.map((x) => ({
      string: x.string,
      fret: x.fret,
      label: '',
      cls: x.midi === t.midi && x.string === t.string ? 'current' : pitchClass(x.midi) === this.rootPc ? 'root' : '',
    }));
    this.app.stageEl.innerHTML = `
      <div class="live">${this.phase === 'ready' ? '<span class="live-main">ready</span>' : this.liveHtml(this.app.engine.time - this.startTime)}</div>
      <div class="scale-label">${escapeHtml(scaleLabel)}</div>
      <div class="tokens">${toks.join('')}</div>
      <div class="feedback" aria-live="polite"></div>
      <div class="box-board">${fretboardSVG({ frets: Math.max(12, this.box.hi + 1), marks, highlightRange: [this.box.lo, this.box.hi] })}</div>
      <div class="stage-hint">${this.phase === 'ready' ? 'play the first note to start the clock' : ''}</div>`;
  }

  finish() {
    this.phase = 'done';
    const timed = this.timed;
    const ms = timed.map((i) => i.ms);
    const npm = this.rate();
    const byPair = new Map();
    for (let k = 1; k < this.items.length; k++) {
      const a = this.items[k - 1];
      const b = this.items[k];
      if (b.ms == null || b.skipped || b.afterSkip || a.skipped) continue;
      const key = `${pretty(a.target.label)} (${STRING_NAMES[a.target.string]}·${a.target.fret}) → ${pretty(b.target.label)} (${STRING_NAMES[b.target.string]}·${b.target.fret})`;
      if (!byPair.has(key)) byPair.set(key, { v: [], cross: a.target.string !== b.target.string });
      byPair.get(key).v.push(b.ms);
    }
    const pairs = [...byPair.entries()].map(([k, x]) => ({ k, avg: avg(x.v), n: x.v.length, cross: x.cross })).sort((a, b) => b.avg - a.avg);
    const cross = pairs.filter((p) => p.cross);
    const same = pairs.filter((p) => !p.cross);
    const med = median(ms);
    const { isPb, previous } = timed.length >= 8 ? this.app.store.submit(this.testKey, npm, { details: { acc: this.accuracy() } }) : {};
    renderResults(this.app.stageEl, {
      pb: isPb ? (previous == null ? 'first result saved' : `new personal best! (was ${previous})`) : null,
      headline: [
        { label: 'npm', value: String(npm), sub: 'notes / min' },
        { label: 'acc', value: `${this.accuracy()}%`, sub: `${this.wrongs} wrong note${this.wrongs === 1 ? '' : 's'}` },
      ],
      stats: [
        { label: 'notes', value: String(this.hits.length) },
        { label: 'avg gap', value: fmtMs(avg(ms)) },
        { label: 'steadiness', value: ms.length > 2 ? `±${fmtMs(stdev(ms))}` : '–', title: 'standard deviation' },
        { label: 'same-string avg', value: fmtMs(avg(same.flatMap((p) => Array(p.n).fill(p.avg)))) },
        { label: 'string-cross avg', value: fmtMs(avg(cross.flatMap((p) => Array(p.n).fill(p.avg)))) },
        { label: 'pb', value: String(this.app.store.pb(this.testKey) ?? '–') },
      ],
      sections: [
        { title: 'time between notes', html: barChart(timed.map((i) => ({ label: pretty(i.target.label), value: i.ms, cls: speedClass(i.ms, med) })), { showLabels: timed.length <= 40 }) },
        { title: 'hesitation hot spots (slowest transitions)', html: tableHtml(['transition', 'avg', 'times'], pairs.slice(0, 6).map((p) => [p.k, fmtSec(p.avg), String(p.n)])) },
      ],
      onAgain: () => this.restart(),
    });
  }
}

function stdev(xs) {
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
}
