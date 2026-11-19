// Chord-change trainer: chords per minute (CPM).
import { CHORDS, CHORD_BY_NAME, CHORD_PRESETS, samePcs } from '../music/chords.js';
import { prettyAccidentals } from '../music/theory.js';
import { chordDiagram, barChart } from '../ui/svg.js';
import { renderConfig, renderResults, tableHtml, fmtSec, avg, median, pick, speedClass, escapeHtml, h } from '../ui/common.js';

const DEFAULTS = { preset: 'campfire', custom: ['G', 'C', 'D', 'Em'], test: 'time', time: 30, count: 25, drill: 'random', pairA: 'G', pairB: 'C' };
const nice = (name) => prettyAccidentals(name);

export class ChordsMode {
  static id = 'chords';
  static label = 'chords';

  constructor(app) {
    this.app = app;
    this.cfg = { ...DEFAULTS, ...(app.store.settings.chords || {}) };
    this.offs = [];
  }

  // ---- lifecycle ------------------------------------------------------------
  mount() {
    this.renderConfig();
    this.offs.push(this.app.judge.onResult((r) => this.onJudge(r)));
    this.restart();
  }

  unmount() {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.app.judge.setTarget(null, []);
  }

  saveCfg(patch) {
    this.cfg = { ...this.cfg, ...patch };
    this.app.store.saveSettings({ chords: this.cfg });
  }

  get pool() {
    if (this.cfg.drill === 'pair') return [CHORD_BY_NAME[this.cfg.pairA], CHORD_BY_NAME[this.cfg.pairB]];
    const names = this.cfg.preset === 'custom' ? this.cfg.custom : CHORD_PRESETS[this.cfg.preset].chords;
    return names.map((n) => CHORD_BY_NAME[n]).filter(Boolean);
  }

  get testKey() {
    const what = this.cfg.drill === 'pair' ? `pair:${[this.cfg.pairA, this.cfg.pairB].sort().join('-')}` : this.cfg.preset === 'custom' ? `custom:${[...this.cfg.custom].sort().join('-')}` : this.cfg.preset;
    const len = this.cfg.test === 'time' ? `t${this.cfg.time}` : `n${this.cfg.count}`;
    return `chords:${what}:${len}`;
  }

  renderConfig() {
    const presetOpts = Object.entries(CHORD_PRESETS).map(([k, p]) => ({ value: k, label: p.label, title: p.chords.join(' ') }));
    presetOpts.push({ value: 'custom', label: 'custom' });
    const groups = [
      { key: 'drill', options: [{ value: 'random', label: 'random' }, { value: 'pair', label: 'pair drill', title: 'Alternate between two chords (One Minute Changes)' }], value: this.cfg.drill },
    ];
    if (this.cfg.drill === 'random') groups.push({ key: 'preset', options: presetOpts, value: this.cfg.preset });
    groups.push({ key: 'test', options: [{ value: 'time', label: 'time' }, { value: 'count', label: 'changes' }], value: this.cfg.test });
    groups.push(
      this.cfg.test === 'time'
        ? { key: 'time', options: [15, 30, 60, 120].map((v) => ({ value: v, label: String(v) })), value: this.cfg.time }
        : { key: 'count', options: [10, 25, 50, 100].map((v) => ({ value: v, label: String(v) })), value: this.cfg.count },
    );
    renderConfig(this.app.configEl, groups, (key, value) => {
      this.saveCfg({ [key]: value });
      this.renderConfig();
      this.restart();
    });

    // Second row: custom chord picker or pair selectors.
    const extra = this.app.configExtraEl;
    extra.innerHTML = '';
    if (this.cfg.drill === 'pair') {
      const opts = (sel) => CHORDS.map((c) => `<option value="${c.name}"${c.name === sel ? ' selected' : ''}>${nice(c.name)}</option>`).join('');
      const row = h(`<div class="pair-row"><select aria-label="first chord" data-k="pairA">${opts(this.cfg.pairA)}</select><span class="sub">↔</span><select aria-label="second chord" data-k="pairB">${opts(this.cfg.pairB)}</select></div>`);
      row.querySelectorAll('select').forEach((s) =>
        s.addEventListener('change', () => {
          this.saveCfg({ [s.dataset.k]: s.value });
          s.blur();
          this.restart();
        }),
      );
      extra.append(row);
    } else if (this.cfg.preset === 'custom') {
      renderConfig(extra, [{ key: 'custom', multi: true, options: CHORDS.map((c) => ({ value: c.name, label: nice(c.name) })), value: this.cfg.custom }], (key, value) => {
        if (value.length < 2) return;
        this.saveCfg({ custom: value });
        this.renderConfig();
        this.restart();
      });
    }
  }

  // ---- test flow ------------------------------------------------------------
  restart() {
    const pool = this.pool;
    if (this.cfg.drill === 'pair' && samePcs(pool[0].pcs, pool[1].pcs)) {
      this.app.stageEl.innerHTML = `<p class="notice">Pick two different chords for the pair drill.</p>`;
      return;
    }
    this.phase = 'ready';
    this.seq = [];
    this.idx = 0;
    this.startTime = null;
    this.lastOnset = null;
    this.lastEvent = null; // time of the last correct chord or skip
    this.changes = []; // {from, to, ms, wrongs}
    this.tokens = []; // per position: {ms, wrongs, skipped}
    this.correct = 0; // correctly played chords, including the first one
    this.wrongs = 0;
    this.wrongsHere = 0;
    this.skips = 0;
    this.afterSkip = false;
    this.extend();
    this.app.judge.setTarget(this.seq[0], pool, this.app.engine.now);
    this.renderStage();
  }

  extend() {
    const pool = this.pool;
    while (this.seq.length < this.idx + 20) {
      const prev = this.seq[this.seq.length - 1];
      let next;
      if (this.cfg.drill === 'pair') next = !prev || prev === pool[1] ? pool[0] : pool[1];
      else {
        do next = pick(pool);
        while (prev && next === prev && pool.length > 1);
      }
      this.seq.push(next);
    }
  }

  get target() {
    return this.phase === 'done' ? null : this.seq[this.idx];
  }

  /** Chords completed so far: correct ones plus skipped ones. */
  get played() {
    return this.correct + this.skips;
  }

  /** Start the clock (on the first correct chord or the first skip). */
  start(time) {
    this.phase = 'running';
    this.startTime = time;
  }

  /** After a chord is completed (correct or skipped): finish or move on. */
  advance() {
    this.idx++;
    this.extend();
    if (this.cfg.test === 'count' && this.played >= this.cfg.count) {
      this.finish();
      return;
    }
    this.app.judge.setTarget(this.seq[this.idx], this.pool, this.app.engine.now);
    this.renderStage();
  }

  onJudge(r) {
    if (this.phase === 'done' || r.target !== this.target) return;
    if (r.type === 'wrong') {
      if (this.phase === 'running') {
        this.wrongs++;
        this.wrongsHere++;
      }
      this.flash('bad', `heard ${nice(r.heard.name)}`);
      return;
    }
    // Correct chord. The first one starts the clock and counts towards the total.
    if (this.phase === 'ready') {
      this.start(r.onsetTime);
      this.tokens[this.idx] = { ms: null, wrongs: 0 };
    } else {
      const deadline = this.cfg.test === 'time' ? this.startTime + this.cfg.time : Infinity;
      if (r.onsetTime > deadline) return;
      // Change time is only meaningful when the previous chord was played (not skipped).
      const timed = !this.afterSkip && this.lastOnset != null;
      const ms = timed ? (r.onsetTime - this.lastOnset) * 1000 : null;
      if (timed) this.changes.push({ from: this.seq[this.idx - 1].name, to: r.target.name, ms, wrongs: this.wrongsHere });
      this.tokens[this.idx] = { ms, wrongs: this.wrongsHere };
    }
    this.correct++;
    this.afterSkip = false;
    this.wrongsHere = 0;
    this.lastOnset = r.onsetTime;
    this.lastEvent = r.onsetTime;
    this.flash('good');
    this.advance();
  }

  /** Skipping counts towards the total chords, but not as correct. */
  skip() {
    if (this.phase === 'done') return;
    const now = this.app.engine.time;
    if (this.phase === 'ready') this.start(now);
    else if (this.cfg.test === 'time' && now > this.startTime + this.cfg.time) return;
    this.skips++;
    this.tokens[this.idx] = { skipped: true, wrongs: this.wrongsHere };
    this.afterSkip = true;
    this.wrongsHere = 0;
    this.lastEvent = now;
    this.advance();
  }

  tick() {
    if (this.phase !== 'running') return;
    const elapsed = this.app.engine.time - this.startTime;
    if (this.cfg.test === 'time' && elapsed >= this.cfg.time + 0.3) {
      this.finish();
      return;
    }
    this.updateLive(elapsed);
  }

  liveCpm(elapsed) {
    return elapsed > 2 ? Math.round((this.correct / elapsed) * 60) : 0;
  }

  updateLive(elapsed) {
    const el = this.app.stageEl.querySelector('.live');
    if (!el) return;
    const left = this.cfg.test === 'time' ? Math.max(0, Math.ceil(this.cfg.time - elapsed)) : `${this.played}/${this.cfg.count}`;
    el.innerHTML = `<span class="live-main">${left}</span><span>${this.liveCpm(elapsed)} cpm</span>`;
  }

  // ---- rendering ------------------------------------------------------------
  renderStage() {
    const target = this.seq[this.idx];
    const next = this.seq[this.idx + 1];
    const from = Math.max(0, this.idx - 4);
    const ms = this.changes.map((c) => c.ms);
    const med = median(ms);
    const tokens = [];
    for (let i = from; i < this.idx + 9; i++) {
      const c = this.seq[i];
      let cls = 'tok';
      let sub = '';
      if (i < this.idx) {
        const t = this.tokens[i] || {};
        cls += ' done';
        if (t.skipped) {
          cls += ' skipped';
          sub = 'skip';
        } else if (t.ms != null) {
          cls += ` ${speedClass(t.ms, med)}`;
          sub = fmtSec(t.ms);
        } else sub = i === 0 ? 'start' : '–';
        if (t.wrongs) cls += ' had-wrong';
      } else if (i === this.idx) cls += ' current';
      tokens.push(`<div class="${cls}"><span class="tok-name">${escapeHtml(nice(c.name))}</span><span class="tok-sub">${sub}</span></div>`);
    }
    const hint =
      this.phase === 'ready'
        ? `strum <b>${escapeHtml(nice(target.name))}</b> (or skip it) to start the timer`
        : '';
    this.app.stageEl.innerHTML = `
      <div class="live">${this.phase === 'ready' ? '<span class="live-main">ready</span>' : ''}</div>
      <div class="tokens">${tokens.join('')}</div>
      <div class="diagrams">
        <div class="diag current-diag"><div class="diag-name">${escapeHtml(nice(target.name))}</div>${chordDiagram(target)}</div>
        <div class="diag next-diag"><div class="diag-name">next · ${escapeHtml(nice(next.name))}</div>${chordDiagram(next)}</div>
      </div>
      <div class="feedback" aria-live="polite"></div>
      <div class="stage-hint">${hint}</div>`;
    if (this.phase === 'running') this.updateLive(this.app.engine.time - this.startTime);
  }

  flash(kind, text = '') {
    const fb = this.app.stageEl.querySelector('.feedback');
    if (kind === 'bad' && fb) {
      fb.textContent = text;
      fb.className = 'feedback bad show';
      clearTimeout(this._fbT);
      this._fbT = setTimeout(() => fb && (fb.className = 'feedback bad'), 900);
    }
    if (kind === 'good') {
      // re-rendered right after; nudge the current token via CSS animation
      this.app.stageEl.classList.remove('pulse');
      void this.app.stageEl.offsetWidth;
      this.app.stageEl.classList.add('pulse');
    }
  }

  finish() {
    this.phase = 'done';
    this.app.judge.setTarget(null, []);
    // CPM = correct chords per minute (skips count towards the total, not the score).
    const T = this.cfg.test === 'time' ? this.cfg.time : (this.lastEvent ?? 0) - (this.startTime ?? 0);
    const correct = this.correct;
    const cpm = T > 0 ? Math.round((correct / T) * 600) / 10 : 0;
    const ms = this.changes.map((c) => c.ms);
    // Accuracy: correct chords out of everything attempted (wrong strums and skips both count against it).
    const attempts = correct + this.wrongs + this.skips;
    const acc = attempts ? Math.round((correct / attempts) * 100) : 0;
    const clean = this.tokens.filter((t) => t && !t.skipped && !t.wrongs).length;
    // Per-transition stats (direction-agnostic pairs give more data per pair).
    const byPair = new Map();
    for (const c of this.changes) {
      const k = `${nice(c.from)} → ${nice(c.to)}`;
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(c.ms);
    }
    const pairs = [...byPair.entries()].map(([k, v]) => ({ k, avg: avg(v), n: v.length })).sort((a, b) => b.avg - a.avg);
    const med = median(ms);
    const { isPb, previous } = this.played >= 3 ? this.app.store.submit(this.testKey, cpm, { details: { acc } }) : { isPb: false, previous: this.app.store.pb(this.testKey) };
    const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    renderResults(this.app.stageEl, {
      pb: isPb ? (previous == null ? 'first result saved' : `new personal best! (was ${previous})`) : null,
      headline: [
        { label: 'cpm', value: String(cpm), sub: 'correct chords / min' },
        { label: 'acc', value: `${acc}%`, sub: `${plural(this.wrongs, 'wrong strum')} · ${plural(this.skips, 'skip')}` },
      ],
      stats: [
        { label: 'correct', value: `${correct}/${this.played}` },
        { label: 'avg change', value: ms.length ? fmtSec(avg(ms)) : '–' },
        { label: 'fastest', value: ms.length ? fmtSec(Math.min(...ms)) : '–' },
        { label: 'slowest', value: ms.length ? fmtSec(Math.max(...ms)) : '–' },
        { label: 'first-try', value: correct ? `${Math.round((clean / correct) * 100)}%` : '–' },
        { label: 'skipped', value: String(this.skips) },
        { label: 'pb', value: String(this.app.store.pb(this.testKey) ?? '–') },
      ],
      sections: [
        {
          title: 'change times',
          html: barChart(this.changes.map((c, i) => ({ label: nice(c.to), value: c.ms, cls: speedClass(c.ms, med), title: `${i + 1}. ${nice(c.from)} → ${nice(c.to)}: ${fmtSec(c.ms)}${c.wrongs ? ` (${c.wrongs} wrong)` : ''}` }))),
        },
        {
          title: 'slowest transitions',
          html: tableHtml(['transition', 'avg', 'times'], pairs.slice(0, 6).map((p) => [p.k, fmtSec(p.avg), String(p.n)])),
        },
      ],
      onAgain: () => this.restart(),
    });
  }

  // ---- simulated guitar -----------------------------------------------------
  botKey() {
    return this.phase === 'done' ? null : `c${this.idx}`;
  }

  simulate(correct) {
    const t = this.target;
    if (!t) return;
    let chord = t;
    if (!correct) {
      const others = [...this.pool, ...CHORDS.filter((c) => c.tags.includes('open'))].filter((c) => !samePcs(c.pcs, t.pcs));
      chord = pick(others);
    }
    this.app.engine.simStrum(chord.frets, { up: Math.random() < 0.25 });
  }
}
