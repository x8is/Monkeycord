// Sight-reading: read notes on a treble staff and play them.
// Guitar music is written an octave above where it sounds, so a note written
// on the bottom line (E4) is played as E3 (open D string, 2nd fret).
import { NoteModeBase } from './note-base.js';
import { SHARP_NAMES, FLAT_NAMES, pitchClass, noteName } from '../music/theory.js';
import { staffSVG } from '../ui/svg.js';
import { renderConfig, renderResults, tableHtml, fmtMs, avg, median, pick, escapeHtml } from '../ui/common.js';

// Sounding MIDI ranges.
const RANGES = {
  first: { label: '1st position', lo: 40, hi: 68, title: 'Frets 0–4, all strings (E2–G♯4)' },
  low: { label: 'low strings', lo: 40, hi: 55, title: 'E, A, D strings, frets 0–5' },
  high: { label: 'high strings', lo: 55, hi: 69, title: 'G, B, e strings, frets 0–5' },
  twelve: { label: 'to 12th fret', lo: 40, hi: 76, title: 'E2–E5' },
};
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
const PER_LINE = 8;
const DEFAULTS = { range: 'first', accidentals: 'off', octave: 'strict', test: 'count', count: 32, time: 60, names: 'after' };

export class SightMode extends NoteModeBase {
  static id = 'sight';
  static label = 'sight-read';

  constructor(app) {
    super(app, 'sight', DEFAULTS);
    this.timing = 'interval';
  }

  renderConfig() {
    const groups = [
      { key: 'range', options: Object.entries(RANGES).map(([k, r]) => ({ value: k, label: r.label, title: r.title })), value: this.cfg.range },
      { key: 'accidentals', options: [{ value: 'off', label: 'naturals' }, { value: 'on', label: '♯ ♭' }], value: this.cfg.accidentals },
      { key: 'octave', options: [{ value: 'strict', label: 'exact octave' }, { value: 'any', label: 'any octave' }], value: this.cfg.octave },
      { key: 'names', options: [{ value: 'after', label: 'names after' }, { value: 'never', label: 'no names' }], value: this.cfg.names },
      { key: 'test', options: [{ value: 'count', label: 'notes' }, { value: 'time', label: 'time' }], value: this.cfg.test },
      this.cfg.test === 'time'
        ? { key: 'time', options: [30, 60, 120].map((v) => ({ value: v, label: String(v) })), value: this.cfg.time }
        : { key: 'count', options: [16, 32, 64].map((v) => ({ value: v, label: String(v) })), value: this.cfg.count },
    ];
    renderConfig(this.app.configEl, groups, (k, v) => {
      this.saveCfg({ [k]: v });
      this.renderConfig();
      this.restart();
    });
    this.app.configExtraEl.innerHTML = '';
  }

  get testKey() {
    return `sight:${this.cfg.range}:${this.cfg.accidentals}:${this.cfg.octave}:${this.cfg.test === 'time' ? `t${this.cfg.time}` : `n${this.cfg.count}`}`;
  }

  makeTargets(n) {
    const { lo, hi } = RANGES[this.cfg.range];
    const allowed = [];
    for (let m = lo; m <= hi; m++) if (this.cfg.accidentals === 'on' || NATURAL.has(pitchClass(m))) allowed.push(m);
    const out = [];
    let prev = this.targets.length ? this.targets[this.targets.length - 1].midi : pick(allowed);
    while (out.length < n) {
      // Mostly stepwise / small leaps, like a real melody.
      const near = allowed.filter((m) => m !== prev && Math.abs(m - prev) <= 7);
      const m = near.length ? pick(near) : pick(allowed);
      out.push(spell(m));
      prev = m;
    }
    return out;
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
    return `<span class="live-main">${prog}</span><span>${elapsed > 2 ? Math.round(((n - 1) / elapsed) * 60) : 0} npm</span>`;
  }

  renderStage() {
    const lineStart = Math.floor(this.idx / PER_LINE) * PER_LINE;
    const notes = [];
    for (let i = lineStart; i < lineStart + PER_LINE; i++) {
      const t = this.targets[i];
      const it = this.items[i];
      const state = i < this.idx ? (it?.skipped ? 'skipped' : it?.wrongs ? 'had-wrong' : 'ok') : '';
      notes.push({ ...t, state, label: i < this.idx && this.cfg.names === 'after' ? noteName(t.midi, { octave: true }) : '' });
    }
    const upcoming = this.targets.slice(lineStart + PER_LINE, lineStart + PER_LINE * 2).map((t) => ({ ...t }));
    this.app.stageEl.innerHTML = `
      <div class="live">${this.phase === 'ready' ? '<span class="live-main">ready</span>' : this.liveHtml(this.app.engine.time - this.startTime)}</div>
      <div class="staff-wrap">${staffSVG(notes, { currentIndex: this.idx - lineStart })}</div>
      <div class="staff-wrap next-line">${staffSVG(upcoming)}</div>
      <div class="feedback" aria-live="polite"></div>
      <div class="stage-hint">${this.phase === 'ready' ? 'play the first note to start · guitar sounds an octave below written pitch' : ''}</div>`;
  }

  finish() {
    this.phase = 'done';
    const timed = this.timed;
    const ms = timed.map((i) => i.ms);
    const npm = this.rate();
    const byNote = new Map();
    for (const i of timed) {
      const k = i.target.written;
      if (!byNote.has(k)) byNote.set(k, []);
      byNote.get(k).push(i.ms);
    }
    const slow = [...byNote.entries()].map(([k, v]) => ({ k, avg: avg(v), n: v.length })).sort((a, b) => b.avg - a.avg);
    const { isPb, previous } = timed.length >= 8 ? this.app.store.submit(this.testKey, npm, { details: { acc: this.accuracy() } }) : {};
    renderResults(this.app.stageEl, {
      pb: isPb ? (previous == null ? 'first result saved' : `new personal best! (was ${previous})`) : null,
      headline: [
        { label: 'npm', value: String(npm), sub: 'notes read / min' },
        { label: 'acc', value: `${this.accuracy()}%`, sub: `${this.wrongs} wrong note${this.wrongs === 1 ? '' : 's'}` },
      ],
      stats: [
        { label: 'notes', value: String(this.hits.length) },
        { label: 'avg per note', value: fmtMs(avg(ms)) },
        { label: 'median', value: fmtMs(median(ms)) },
        { label: 'skipped', value: String(this.skips) },
        { label: 'pb', value: String(this.app.store.pb(this.testKey) ?? '–') },
      ],
      sections: [
        { title: 'slowest notes to read (written pitch)', html: tableHtml(['note', 'avg', 'times'], slow.slice(0, 6).map((s) => [s.k, fmtMs(s.avg), String(s.n)])) },
      ],
      onAgain: () => this.restart(),
    });
  }
}

/** Spell a sounding MIDI note as a written (octave-up) staff note. */
function spell(midi) {
  const written = midi + 12;
  const pc = pitchClass(written);
  const name = NATURAL.has(pc) ? SHARP_NAMES[pc] : Math.random() < 0.5 ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
  const letter = name[0];
  const acc = name.length > 1 ? name[1] : '';
  // Octave of the *letter* (Cb/B# never generated, so this is safe).
  const octave = Math.floor(written / 12) - 1;
  return { midi, letter, acc, octave, written: `${name.replace('#', '♯').replace(/([A-G])b/, '$1♭')}${octave}` };
}
