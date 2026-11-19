// Monophonic pitch detection using the McLeod Pitch Method (MPM):
// normalised square difference function (NSDF) computed with an FFT-based
// autocorrelation, then "key maximum" peak picking with parabolic refinement.
import { fft } from './fft.js';

export class PitchDetector {
  /**
   * @param {number} size window length in samples (e.g. 2048 at 48 kHz)
   * @param {number} sampleRate
   */
  constructor(size, sampleRate, { minFreq = 70, maxFreq = 1400, cutoff = 0.9 } = {}) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    this.maxTau = Math.min(size - 2, Math.ceil(sampleRate / minFreq));
    this.cutoff = cutoff;
    let n = 1;
    while (n < 2 * size) n <<= 1;
    this.fftSize = n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.nsdf = new Float64Array(size);
  }

  /** @returns {{freq:number, clarity:number} | null} */
  detect(x) {
    const { size, fftSize, re, im, nsdf } = this;
    re.fill(0);
    im.fill(0);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      re[i] = x[i];
      energy += x[i] * x[i];
    }
    if (energy < 1e-8) return null;
    // Autocorrelation r(tau) = IFFT(|X|^2). |X|^2 is real & even, so a forward
    // FFT divided by n gives the same result.
    fft(re, im);
    for (let k = 0; k < fftSize; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k];
      im[k] = 0;
    }
    fft(re, im);
    // m(tau) = sum x_j^2 + x_{j+tau}^2, computed incrementally.
    let m = 2 * energy;
    const maxTau = this.maxTau;
    for (let tau = 0; tau <= maxTau; tau++) {
      const r = re[tau] / fftSize;
      nsdf[tau] = m > 0 ? (2 * r) / m : 0;
      m -= x[tau] * x[tau] + x[size - 1 - tau] * x[size - 1 - tau];
    }

    // Key maxima: highest point between each positive-going and the following
    // negative-going zero crossing, after the first negative crossing.
    const maxima = [];
    let tau = 1;
    while (tau < maxTau && nsdf[tau] > 0) tau++; // skip initial positive lobe
    while (tau < maxTau) {
      while (tau < maxTau && nsdf[tau] <= 0) tau++;
      let best = -1;
      let bestTau = -1;
      while (tau < maxTau && nsdf[tau] > 0) {
        if (nsdf[tau] > best) {
          best = nsdf[tau];
          bestTau = tau;
        }
        tau++;
      }
      if (bestTau > 0) maxima.push(bestTau);
    }
    if (!maxima.length) return null;
    let highest = 0;
    for (const t of maxima) if (nsdf[t] > highest) highest = nsdf[t];
    const thresh = this.cutoff * highest;
    for (const t of maxima) {
      if (t < this.minTau) continue;
      if (nsdf[t] >= thresh) {
        const a = nsdf[t - 1];
        const b = nsdf[t];
        const c = nsdf[t + 1];
        const denom = a - 2 * b + c;
        const p = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
        const clarity = b - 0.25 * (a - c) * p;
        return { freq: this.sampleRate / (t + p), clarity: Math.min(1, clarity) };
      }
    }
    return null;
  }
}
