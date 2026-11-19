// Fretboard mastery: find the prompted note as fast as possible (reaction time).
import { NoteModeBase } from './note-base.js';
import { STANDARD_TUNING, STRING_NAMES, SHARP_NAMES, FLAT_NAMES, pitchClass, noteName } from '../music/theory.js';
import { fretboardSVG, barChart } from '../ui/svg.js';
import { renderConfig, renderResults, tableHtml, fmtMs, avg, median, pick, escapeHtml } from '../ui/common.js';

const DEFAULTS = { notes: 'natural', where: 'any', strings: [0, 1, 2, 3, 4, 5], frets: '0-12', test: 'count', count: 20, time: 60 };
const RANGES = { '0-4': [0, 4], '0-12': [0, 12], '5-12': [5, 12] };
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
const STRING_LONG = ['low E', 'A', 'D', 'G', 'B', 'high e'];
const pretty = (s) => s.replace('#', '♯').replace(/([A-G])b/, '$1♭');

export class FretboardMode extends NoteModeBase {
  static id = 'fretboard';
  static label = 'fretboard';

  constructor(app) {
    super(app, 'fretboard', DEFAULTS);
    this.timing = 'prompt';
  }

  renderConfig() {
    const groups = [
      { key: 'notes', options: [{ value: 'natural', label: 'naturals' }, { value: 'all', label: 'all 12' }], value: this.cfg.notes },
      { key: 'where', options: [{ value: 'any', label: 'any string' }, { value: 'string', label: 'on a string', title: 'Prompts name a string; the exact pitch is verified' }], value: this.cfg.where },
    ];
    if (this.cfg.where === 'string')
      groups.push({ key: 'strings', multi: true, options: STRING_NAMES.map((n, i) => ({ value: i, label: n })), value: this.cfg.strings });
    groups.push({ key: 'frets', label: 'frets', options: Object.keys(RANGES).map((k) => ({ value: k, label: k.replace('-', '–') })), value: this.cfg.frets });
    groups.push({ key: 'test', options: [{ value: 'count', label: 'prompts' }, { value: 'time', label: 'time' }], value: this.cfg.test });
    groups.push(
      this.cfg.test === 'time'
        ? { key: 'time', options: [30, 60, 120].map((v) => ({ value: v, label: String(v) })), value: this.cfg.time }
        : { key: 'count', options: [10, 20, 40].map((v) => ({ value: v, label: String(v) })), value: this.cfg.count },
    );
    renderConfig(this.app.configEl, groups, (k, v) => {
      this.saveCfg({ [k]: v });
      this.renderConfig();
      this.restart();
    });
    this.app.configExtraEl.innerHTML = '';
  }

  get testKey() {
    const where = this.cfg.where === 'any' ? 'any' : `s${[...this.cfg.strings].sort().join('')}`;
    return `fretboard:${this.cfg.notes}:${where}:${this.cfg.frets}:${this.cfg.test === 'time' ? `t${this.cfg.time}` : `n${this.cfg.count}`}`;
  }

  makeTargets(n) {
    const [lo, hi] = RANGES[this.cfg.frets];
    const out = [];
    let prevPc = this.targets.length ? this.targets[this.targets.length - 1].pc : -1;
    while (out.length < n) {
      if (this.cfg.where === 'string') {
        const s = pick(this.cfg.strings);
        const fret = lo + Math.floor(Math.random() * (hi - lo + 1));
        const pc = pitchClass(STANDARD_TUNING[s] + fret);
        if (pc === prevPc || (this.cfg.notes === 'natural' && !NATURAL.has(pc))) continue;
        const midis = [];
        for (let f = lo; f <= hi; f++) if (pitchClass(STANDARD_TUNING[s] + f) === pc) midis.push(STANDARD_TUNING[s] + f);
        out.push({ pc, string: s, midis, label: this.spell(pc) });
        prevPc = pc;
      } else {
        const pcs = this.cfg.notes === 'natural' ? [...NATURAL] : [...Array(12).keys()];
        const pc = pick(pcs.filter((p) => p !== prevPc));
        // Any octave, as long as it's playable within the chosen fret range on some string.
        const midis = [];
        for (let s = 0; s < 6; s++) for (let f = lo; f <= hi; f++) if (pitchClass(STANDARD_TUNING[s] + f) === pc) midis.push(STANDARD_TUNING[s] + f);
        out.push({ pc, string: null, midis: [...new Set(midis)], label: this.spell(pc) });
        prevPc = pc;
      }
    }
    return out;
  }

  spell(pc) {
    if (NATURAL.has(pc)) return SHARP_NAMES[pc];
    return Math.random() < 0.5 ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
  }

  accepts(t, midi) {
    return t.midis.includes(midi);
  }

  simMidi(t) {
    return pick(t.midis);
  }

  liveHtml(elapsed) {
    const t = this.timed.map((i) => i.ms);
    const prog = this.cfg.test === 'time' ? Math.max(0, Math.ceil(this.cfg.time - elapsed)) : `${this.items.length}/${this.cfg.count}`;
    return `<span class="live-main">${prog}</span><span>avg ${fmtMs(avg(t))}</span>`;
  }

  renderStage() {
    const t = this.target;
    const last = this.items[this.items.length - 1];
    const [lo, hi] = RANGES[this.cfg.frets];
    const where = t.string != null ? `on the <b>${STRING_LONG[t.string]}</b> string` : 'anywhere on the neck';
    let lastHtml = '';
    if (last && !last.skipped) {
      const s = last.target.string;
      lastHtml = `<div class="last-hit">${escapeHtml(pretty(last.target.label))} ${last.ms != null ? `· <b>${fmtMs(last.ms)}</b>` : '· start'}</div>`;
      if (s != null) {
        lastHtml += fretboardSVG({ frets: 12, highlightRange: [lo, hi], marks: [{ string: s, fret: last.midi - STANDARD_TUNING[s], label: pretty(last.target.label), cls: 'good' }] });
      }
    }
    this.app.stageEl.innerHTML = `
      <div class="live">${this.phase === 'ready' ? '<span class="live-main">ready</span>' : this.liveHtml(this.app.engine.time - (this.startTime ?? 0))}</div>
      <div class="prompt-note">${escapeHtml(pretty(t.label))}</div>
      <div class="prompt-sub">${where} · frets ${lo}–${hi}</div>
      <div class="feedback" aria-live="polite"></div>
      <div class="last">${lastHtml}</div>
      <div class="stage-hint">${this.phase === 'ready' ? 'play it to start · the first note is a warm-up' : ''}</div>`;
  }

  finish() {
    this.phase = 'done';
    const timed = this.timed;
    const ms = timed.map((i) => i.ms);
    const mean = Math.round(avg(ms));
    const byPc = new Map();
    for (const i of timed) {
      const k = i.target.pc;
      if (!byPc.has(k)) byPc.set(k, []);
      byPc.get(k).push(i.ms);
    }
    const pcs = [...byPc.entries()].map(([pc, v]) => ({ pc, avg: avg(v), n: v.length })).sort((a, b) => a.pc - b.pc);
    const { isPb, previous } = timed.length >= 5 ? this.app.store.submit(this.testKey, mean, { higherIsBetter: false, details: { acc: this.accuracy() } }) : {};
    // Heat map of positions when strings are known.
    let heat = '';
    if (this.cfg.where === 'string' && timed.length) {
      const med = median(ms);
      const marks = timed.map((i) => {
        const s = i.target.string;
        const ratio = Math.min(2, i.ms / med);
        const hue = Math.round(130 - 65 * ratio); // green -> red
        return { string: s, fret: i.midi - STANDARD_TUNING[s], label: '', fill: `hsl(${hue} 70% 50%)`, title: `${noteName(i.midi, { octave: true })} on ${STRING_LONG[s]}: ${fmtMs(i.ms)}` };
      });
      heat = fretboardSVG({ frets: 12, marks, highlightRange: RANGES[this.cfg.frets] });
    }
    renderResults(this.app.stageEl, {
      pb: isPb ? (previous == null ? 'first result saved' : `new personal best! (was ${previous}ms)`) : null,
      headline: [
        { label: 'avg', value: fmtMs(mean), sub: 'time to find a note' },
        { label: 'acc', value: `${this.accuracy()}%`, sub: `${this.wrongs} wrong note${this.wrongs === 1 ? '' : 's'}` },
      ],
      stats: [
        { label: 'median', value: fmtMs(median(ms)) },
        { label: 'fastest', value: fmtMs(Math.min(...ms)) },
        { label: 'slowest', value: fmtMs(Math.max(...ms)) },
        { label: 'notes', value: String(timed.length) },
        { label: 'skipped', value: String(this.skips) },
        { label: 'pb', value: this.app.store.pb(this.testKey) != null ? fmtMs(this.app.store.pb(this.testKey)) : '–' },
      ],
      sections: [
        { title: 'average per note', html: barChart(pcs.map((p) => ({ label: pretty(SHARP_NAMES[p.pc]), value: p.avg, title: `${SHARP_NAMES[p.pc]}: ${fmtMs(p.avg)} (${p.n}×)` }))) },
        { title: 'where you played (green = fast, red = slow)', html: heat },
        {
          title: 'slowest prompts',
          html: tableHtml(
            ['note', 'where', 'time'],
            [...timed].sort((a, b) => b.ms - a.ms).slice(0, 5).map((i) => [pretty(i.target.label), i.target.string != null ? `${STRING_LONG[i.target.string]} string` : noteName(i.midi, { octave: true }), fmtMs(i.ms)]),
          ),
        },
      ],
      onAgain: () => this.restart(),
    });
  }
}
