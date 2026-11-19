// Streaming audio analyzer. Feed it arbitrary-length chunks of mono samples;
// it processes fixed hops and emits one frame per hop containing level,
// onset flag and monophonic pitch. Works identically in the browser (fed by an
// AudioWorklet) and in Node (fed by synthesized buffers in tests).
import { magnitudeSpectrum } from './fft.js';
import { PitchDetector } from './pitch.js';

const nextPow2 = (x) => 1 << Math.ceil(Math.log2(x));

export class OnsetDetector {
  constructor(sampleRate, frameSize) {
    this.sampleRate = sampleRate;
    this.frameSize = frameSize;
    const binHz = sampleRate / frameSize;
    this.kMin = Math.max(1, Math.floor(60 / binHz));
    this.kMax = Math.min(frameSize / 2 - 1, Math.ceil(6000 / binHz));
    this.prev = null;
    this.history = [];
    this.lastOnsetTime = -Infinity;
    this.sensitivity = 1; // >1 = more sensitive
    this.lastFlux = 0;
  }

  /** @returns {boolean} whether this frame is an onset */
  process(frame, time, rms, noiseFloor) {
    const mag = magnitudeSpectrum(frame);
    const L = new Float64Array(this.kMax + 1);
    for (let k = this.kMin; k <= this.kMax; k++) L[k] = Math.log1p(20 * mag[k]);
    let flux = 0;
    if (this.prev) {
      for (let k = this.kMin; k <= this.kMax; k++) {
        const d = L[k] - this.prev[k];
        if (d > 0) flux += d;
      }
    }
    this.prev = L;
    flux /= this.kMax - this.kMin + 1;
    const hist = this.history;
    const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    hist.push(flux);
    if (hist.length > 12) hist.shift();
    this.lastFlux = flux;

    const s = this.sensitivity;
    const threshold = mean * (1 + 1.5 / s) + 0.012 / s;
    const loudEnough = rms > Math.max(noiseFloor * 3.2, 0.0025 / s);
    const refractory = time - this.lastOnsetTime < 0.075;
    if (flux > threshold && loudEnough && !refractory) {
      this.lastOnsetTime = time;
      return true;
    }
    return false;
  }
}

export class Analyzer {
  constructor(sampleRate, { hop = 512 } = {}) {
    this.sampleRate = sampleRate;
    this.hop = hop;
    this.ringSize = 1 << 16;
    this.ring = new Float32Array(this.ringSize);
    this.written = 0; // total samples received
    this.processed = 0; // total samples consumed into hops
    this.pitchSize = nextPow2(sampleRate * 0.04); // ~43 ms
    this.onsetSize = nextPow2(sampleRate * 0.02); // ~21 ms
    this.pitch = new PitchDetector(this.pitchSize, sampleRate);
    this.onset = new OnsetDetector(sampleRate, this.onsetSize);
    this.noiseFloor = 0.001;
    this.listeners = new Set();
    this.pitchEnabled = true;
    this._tmp = new Map();
  }

  onFrame(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Current analysis time in seconds (end of the processed audio). */
  get time() {
    return this.processed / this.sampleRate;
  }

  push(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      this.ring[(this.written + i) & (this.ringSize - 1)] = chunk[i];
    }
    this.written += chunk.length;
    while (this.written - this.processed >= this.hop) {
      this.processed += this.hop;
      this._processHop();
    }
  }

  /** Copy the `length` samples ending at absolute sample index `end`. */
  getRange(end, length) {
    let out = this._tmp.get(length);
    if (!out) {
      out = new Float32Array(length);
      this._tmp.set(length, out);
    }
    const start = end - length;
    for (let i = 0; i < length; i++) {
      const idx = start + i;
      out[i] = idx < 0 ? 0 : this.ring[idx & (this.ringSize - 1)];
    }
    return out;
  }

  _processHop() {
    const end = this.processed;
    const time = end / this.sampleRate;
    // Level of the latest hop.
    let sum = 0;
    for (let i = end - this.hop; i < end; i++) {
      const v = i < 0 ? 0 : this.ring[i & (this.ringSize - 1)];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.hop);
    // Track the noise floor: fall fast, rise slowly.
    if (rms < this.noiseFloor) this.noiseFloor = 0.7 * this.noiseFloor + 0.3 * rms;
    else this.noiseFloor *= 1.0015;
    this.noiseFloor = Math.max(this.noiseFloor, 1e-5);

    const onset = this.onset.process(this.getRange(end, this.onsetSize), time, rms, this.noiseFloor);

    let freq = 0;
    let clarity = 0;
    if (this.pitchEnabled && rms > Math.max(this.noiseFloor * 3, 0.002)) {
      const p = this.pitch.detect(this.getRange(end, this.pitchSize));
      if (p) {
        freq = p.freq;
        clarity = p.clarity;
      }
    }
    // Onsets are timestamped at the start of the hop in which they appear.
    const frame = {
      time,
      sample: end,
      rms,
      noiseFloor: this.noiseFloor,
      onset,
      onsetTime: onset ? time - this.hop / this.sampleRate : null,
      onsetSample: onset ? end - this.hop : null,
      freq,
      clarity,
      flux: this.onset.lastFlux,
    };
    for (const fn of this.listeners) fn(frame, this);
  }
}
