// Higher-level detectors built on top of Analyzer frames.
import { computeChroma, matchChord, identifyChord, normalize } from './chroma.js';
import { freqToMidi } from '../music/theory.js';
import { samePcs } from '../music/chords.js';

const nextPow2 = (x) => 1 << Math.ceil(Math.log2(x));

/**
 * ChordJudge verifies that the *expected* chord was strummed.
 *
 * After every strum (onset) that happens after the current target was set, it
 * analyses windows that start just after the strum (so the previous chord's
 * ringing is excluded) and accepts as soon as one matches the target. If no
 * window matches within `evalMs`, it reports what it heard instead.
 */
export class ChordJudge {
  constructor(analyzer, opts = {}) {
    this.analyzer = analyzer;
    const sr = analyzer.sampleRate;
    this.windowSize = opts.windowSize || nextPow2(sr * 0.16);
    this.offset = Math.round(sr * ((opts.offsetMs ?? 20) / 1000));
    this.evalSamples = Math.round(sr * ((opts.evalMs ?? 650) / 1000));
    this.sensitivity = opts.sensitivity || 'normal';
    this.target = null;
    this.pool = [];
    this.since = 0;
    this.attempt = null;
    this.listeners = new Set();
    this.last = null; // last analysis, for debug display
    this.strumLevel = 0; // typical level of accepted strums
    this._hop = 0;
    this._off = analyzer.onFrame((f) => this._onFrame(f));
  }

  dispose() {
    this._off();
  }

  onResult(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Set the chord we're waiting for. Only strums after `sinceSample` count. */
  setTarget(target, pool, sinceSample = this.analyzer.processed) {
    this.target = target;
    this.pool = pool;
    this.since = sinceSample;
    this.attempt = null;
  }

  _emit(r) {
    for (const fn of this.listeners) fn(r);
  }

  _finalize(a) {
    if (a.done || a.evals === 0 || !this.target) return;
    a.done = true;
    const avg = normalize(a.sum);
    const { chord, score } = identifyChord(avg, this.pool);
    // Only call it a wrong strum if it was a real strum: loud compared with the
    // noise floor and with recent correct strums (not finger noise or open
    // strings ringing while the fretting hand moves).
    const strongEnough = a.peak >= Math.max(a.noiseFloor * 8, this.strumLevel * 0.3);
    if (chord && score >= 0.78 && strongEnough && !samePcs(chord.pcs, this.target.pcs)) {
      this._emit({
        type: 'wrong',
        target: this.target,
        heard: chord,
        onsetTime: a.onsetSample / this.analyzer.sampleRate,
      });
    }
  }

  _onFrame(f) {
    if (!this.target) return;
    if (f.onset && f.onsetSample >= this.since) {
      if (this.attempt) this._finalize(this.attempt);
      this.attempt = { onsetSample: f.onsetSample, evals: 0, sum: new Float64Array(12), done: false, peak: 0, noiseFloor: f.noiseFloor };
    }
    const a = this.attempt;
    if (!a || a.done) return;
    if (f.rms > a.peak) a.peak = f.rms;
    const windowStart = f.sample - this.windowSize;
    if (windowStart < a.onsetSample + this.offset) return;
    if ((this._hop++ & 1) === 1) return; // evaluate every other hop
    if (f.rms < f.noiseFloor * 2.5) {
      this._finalize(a);
      return;
    }
    const samples = this.analyzer.getRange(f.sample, this.windowSize);
    const { chroma } = computeChroma(samples, this.analyzer.sampleRate);
    const res = matchChord(chroma, this.target, this.pool, this.sensitivity);
    this.last = { chroma, ...res, time: f.time, target: this.target };
    a.evals++;
    for (let i = 0; i < 12; i++) a.sum[i] += chroma[i];
    if (res.match) {
      a.done = true;
      // Running estimate of a typical strum level (for the wrong-strum gate).
      this.strumLevel = this.strumLevel ? 0.7 * this.strumLevel + 0.3 * a.peak : a.peak;
      this._emit({
        type: 'correct',
        target: this.target,
        score: res.score,
        onsetTime: a.onsetSample / this.analyzer.sampleRate,
        decisionTime: f.time,
      });
    } else if (f.sample - a.onsetSample > this.evalSamples) {
      this._finalize(a);
    }
  }
}

/**
 * NoteTracker turns pitch frames into discrete note events: a note is emitted
 * when the pitch has been stable for `stableFrames` hops, and it's either a
 * different note than the last one or there was a fresh pluck (onset).
 */
export class NoteTracker {
  constructor(analyzer, { minClarity = 0.86, stableFrames = 3 } = {}) {
    this.analyzer = analyzer;
    this.minClarity = minClarity;
    this.stableFrames = stableFrames;
    this.cand = null;
    this.lastMidi = null;
    this.lastOnsetTime = -Infinity;
    this.silentFrames = 0;
    this.listeners = new Set();
    this.current = null; // latest pitch reading, for display
    this._off = analyzer.onFrame((f) => this._onFrame(f));
  }

  dispose() {
    this._off();
  }

  onNote(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _onFrame(f) {
    if (f.onset) {
      this.lastOnsetTime = f.onsetTime;
      this.cand = null; // a new pluck must re-stabilise
      this.lastMidi = null;
    }
    const voiced = f.freq > 0 && f.clarity >= this.minClarity;
    if (!voiced) {
      this.current = null;
      this.cand = null;
      if (f.rms < f.noiseFloor * 2) {
        if (++this.silentFrames > 8) this.lastMidi = null;
      }
      return;
    }
    this.silentFrames = 0;
    const m = freqToMidi(f.freq);
    const r = Math.round(m);
    const cents = Math.round((m - r) * 100);
    this.current = { midi: r, cents, freq: f.freq, clarity: f.clarity };
    if (Math.abs(m - r) > 0.4) {
      this.cand = null;
      return;
    }
    if (this.cand && this.cand.midi === r) this.cand.count++;
    else {
      this.cand = { midi: r, count: 1, start: f.time - this.analyzer.pitchSize / this.analyzer.sampleRate };
    }
    if (this.cand.count === this.stableFrames && r !== this.lastMidi) {
      this.lastMidi = r;
      // Prefer the pluck time if it was recent; otherwise the start of the stable run.
      const onsetRecent = this.cand.start - this.lastOnsetTime < 0.15 && this.cand.start >= this.lastOnsetTime - 0.05;
      const time = onsetRecent ? this.lastOnsetTime : Math.max(this.cand.start, 0);
      for (const fn of this.listeners) fn({ midi: r, cents, time, freq: f.freq });
    }
  }
}
