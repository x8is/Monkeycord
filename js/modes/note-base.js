// Shared flow for single-note modes (fretboard, notes-per-minute, sight-reading).
// Subclasses provide: defaults, renderConfig(), makeTargets(n), accepts(target, midi),
// renderStage(), results(), and optionally timing ('prompt' | 'interval').
import { noteName } from '../music/theory.js';

export class NoteModeBase {
  constructor(app, id, defaults) {
    this.app = app;
    this.id = id;
    this.cfg = { ...defaults, ...(app.store.settings[id] || {}) };
    this.offs = [];
    // 'prompt': time from the prompt appearing to the note (reaction time)
    // 'interval': time between consecutive correct notes (speed through a sequence)
    this.timing = 'interval';
  }

  mount() {
    this.renderConfig();
    this.offs.push(this.app.notes.onNote((n) => this.onNote(n)));
    this.restart();
  }

  unmount() {
    this.offs.forEach((f) => f());
    this.offs = [];
  }

  saveCfg(patch) {
    this.cfg = { ...this.cfg, ...patch };
    this.app.store.saveSettings({ [this.id]: this.cfg });
  }

  restart() {
    this.phase = 'ready';
    this.targets = [];
    this.idx = 0;
    this.items = []; // {target, ms, wrongs, midi}
    this.wrongs = 0;
    this.wrongsHere = 0;
    this.skips = 0;
    this.startTime = null;
    this.lastHit = null; // {midi, time}
    this.ensureTargets();
    this.promptTime = this.app.engine.time;
    this.renderStage();
  }

  ensureTargets() {
    if (this.targets.length < this.idx + 24) this.targets.push(...this.makeTargets(48));
  }

  get target() {
    return this.phase === 'done' ? null : this.targets[this.idx];
  }

  get limit() {
    return this.cfg.test === 'time' ? null : this.cfg.count;
  }

  onNote(n) {
    if (this.phase === 'done') return;
    const target = this.target;
    if (!target) return;
    if (n.time < this.promptTime - 0.03) return; // detected before the prompt existed
    if (this.accepts(target, n.midi)) {
      let ms = null;
      if (this.phase === 'ready') {
        this.phase = 'running';
        this.startTime = n.time;
      } else {
        if (this.cfg.test === 'time' && n.time > this.startTime + this.cfg.time) return;
        const ref = this.timing === 'prompt' ? this.promptTime : this.lastHit?.time ?? this.promptTime;
        ms = Math.max(0, (n.time - ref) * 1000);
      }
      this.items.push({ target, ms, wrongs: this.wrongsHere, midi: n.midi, time: n.time, afterSkip: this.afterSkip });
      this.afterSkip = false;
      this.wrongsHere = 0;
      this.lastHit = { midi: n.midi, time: n.time };
      this.idx++;
      this.ensureTargets();
      this.promptTime = this.timing === 'prompt' ? this.app.engine.time : n.time;
      const done = this.limit != null && this.items.length >= this.limit;
      if (done) this.finish();
      else this.renderStage();
      return;
    }
    // A different note: ignore the previous note re-triggering shortly after.
    if (this.lastHit && n.midi === this.lastHit.midi && n.time - this.lastHit.time < 0.8) return;
    if (this.phase === 'running') {
      this.wrongs++;
      this.wrongsHere++;
    }
    this.flashWrong(`heard ${noteName(n.midi, { octave: true })}`);
  }

  skip() {
    if (this.phase !== 'running') return;
    this.skips++;
    this.items.push({ target: this.target, ms: null, skipped: true, wrongs: this.wrongsHere });
    this.wrongsHere = 0;
    this.afterSkip = true;
    this.lastHit = null;
    this.idx++;
    this.ensureTargets();
    this.promptTime = this.app.engine.time;
    if (this.limit != null && this.items.length >= this.limit) this.finish();
    else this.renderStage();
  }

  tick() {
    if (this.phase !== 'running') return;
    const elapsed = this.app.engine.time - this.startTime;
    if (this.cfg.test === 'time' && elapsed >= this.cfg.time + 0.3) {
      this.finish();
      return;
    }
    const el = this.app.stageEl.querySelector('.live');
    if (el) el.innerHTML = this.liveHtml(elapsed);
  }

  /** Correct, timed items (excludes the untimed first note and skips). */
  get timed() {
    return this.items.filter((i) => i.ms != null && !i.skipped && !i.afterSkip);
  }

  get hits() {
    return this.items.filter((i) => !i.skipped);
  }

  /** Notes per minute over the test. */
  rate() {
    const hits = this.hits;
    if (hits.length < 2) return 0;
    const T = this.cfg.test === 'time' ? this.cfg.time : hits[hits.length - 1].time - this.startTime;
    // The first note starts the clock, so it isn't counted as a "played in time" note.
    return Math.round(((hits.length - 1) / Math.max(T, 0.001)) * 600) / 10;
  }

  accuracy() {
    const n = this.hits.length;
    return n + this.wrongs ? Math.round((n / (n + this.wrongs)) * 100) : 100;
  }

  flashWrong(text) {
    const fb = this.app.stageEl.querySelector('.feedback');
    if (!fb) return;
    fb.textContent = text;
    fb.className = 'feedback bad show';
    clearTimeout(this._fbT);
    this._fbT = setTimeout(() => (fb.className = 'feedback bad'), 900);
  }

  botKey() {
    return this.phase === 'done' ? null : `n${this.idx}`;
  }

  /** Simulated guitar: play the target (or a wrong note). */
  simulate(correct) {
    const t = this.target;
    if (!t) return;
    let midi = this.simMidi(t);
    if (!correct) midi += Math.random() < 0.5 ? 1 : -2;
    this.app.engine.simPluck(midi);
  }
}
