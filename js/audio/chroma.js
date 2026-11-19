// Chromagram (12-bin pitch-class profile) and chord matching.
//
// Approach: pick spectral peaks, refine their frequency with parabolic
// interpolation, map each peak to the nearest semitone, and accumulate a
// compressed magnitude into its pitch class. Peaks that look like the 3rd /
// 5th / 6th / 7th harmonic of a stronger lower peak are down-weighted because
// those harmonics land on pitch classes that are usually *not* in the chord.
import { magnitudeSpectrum } from './fft.js';
import { GENERIC_TEMPLATES, samePcs } from '../music/chords.js';

const MIN_FREQ = 70;
const MAX_FREQ = 2000;

/** Spectral peaks: [{freq, amp}] sorted by frequency. */
export function spectralPeaks(samples, sampleRate, { relFloor = 0.015 } = {}) {
  const n = samples.length;
  const mag = magnitudeSpectrum(samples);
  const binHz = sampleRate / n;
  const kMin = Math.max(2, Math.floor(MIN_FREQ / binHz));
  const kMax = Math.min(mag.length - 2, Math.ceil(MAX_FREQ / binHz));
  let maxMag = 0;
  for (let k = kMin; k <= kMax; k++) if (mag[k] > maxMag) maxMag = mag[k];
  if (maxMag <= 0) return { peaks: [], maxMag: 0 };
  const floor = maxMag * relFloor;
  const peaks = [];
  for (let k = kMin; k <= kMax; k++) {
    const m = mag[k];
    if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
    const a = Math.log(mag[k - 1] + 1e-12);
    const b = Math.log(m + 1e-12);
    const c = Math.log(mag[k + 1] + 1e-12);
    const denom = a - 2 * b + c;
    const p = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    peaks.push({ freq: (k + p) * binHz, amp: Math.exp(b - 0.25 * (a - c) * p) });
  }
  return { peaks, maxMag };
}

/**
 * Compute a chroma vector (Float64Array(12), L2-normalised) from a block of
 * samples. Also returns the estimated global tuning offset in semitones.
 */
export const CHROMA_DEFAULTS = { power: 0.3, suppress: 0.35, relFloor: 0.015 };

export function computeChroma(samples, sampleRate, opts = CHROMA_DEFAULTS) {
  const { power, suppress, relFloor } = { ...CHROMA_DEFAULTS, ...opts };
  const { peaks, maxMag } = spectralPeaks(samples, sampleRate, { relFloor });
  const chroma = new Float64Array(12);
  if (!peaks.length) return { chroma, tuning: 0, energy: 0 };

  // Estimate global tuning offset (guitar slightly sharp/flat overall) via a
  // weighted circular mean of the peaks' deviations from equal temperament.
  let sx = 0, sy = 0;
  for (const pk of peaks) {
    const midi = 69 + 12 * Math.log2(pk.freq / 440);
    const ang = 2 * Math.PI * (midi - Math.round(midi));
    const w = pk.amp;
    sx += w * Math.cos(ang);
    sy += w * Math.sin(ang);
  }
  const tuning = Math.atan2(sy, sx) / (2 * Math.PI); // -0.5 .. 0.5 semitones

  // Harmonic suppression: mark peaks that coincide with a non-octave harmonic
  // of a stronger, lower peak.
  const weights = peaks.map((pk) => Math.pow(pk.amp / maxMag, power));
  for (let i = 0; i < peaks.length; i++) {
    for (let j = 0; j < i; j++) {
      if (peaks[j].amp < peaks[i].amp * 0.5) continue;
      const ratio = peaks[i].freq / peaks[j].freq;
      const h = Math.round(ratio);
      if (h === 3 || h === 5 || h === 6 || h === 7) {
        const cents = 1200 * Math.abs(Math.log2(ratio / h));
        if (cents < 25) {
          weights[i] *= suppress;
          break;
        }
      }
    }
  }

  let energy = 0;
  for (let i = 0; i < peaks.length; i++) {
    const pk = peaks[i];
    const midi = 69 + 12 * Math.log2(pk.freq / 440) - tuning;
    const nearest = Math.round(midi);
    const dev = midi - nearest;
    if (Math.abs(dev) > 0.4) continue; // inharmonic / noise
    const tuneW = Math.cos(Math.PI * dev) ** 2;
    // Gently de-emphasise high frequencies (mostly harmonics).
    const freqW = pk.freq < 600 ? 1 : Math.max(0.35, 1 - (pk.freq - 600) / 2000);
    const w = weights[i] * tuneW * freqW;
    chroma[((nearest % 12) + 12) % 12] += w;
    energy += w;
  }
  normalize(chroma);
  return { chroma, tuning, energy };
}

export function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s);
  if (s > 0) for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
}

/** Cosine similarity between an L2-normalised chroma and a binary pc set. */
export function templateScore(chroma, pcs) {
  let dot = 0;
  for (const pc of pcs) dot += chroma[pc];
  return dot / Math.sqrt(pcs.length);
}

// Tuned with tests/eval-detection.mjs on synthesized strums (see README).
// threshold:     minimum cosine similarity with the target's pitch classes
// margin:        target may trail the best *pool* chord by at most this much
// genericMargin: target may trail the best generic chord (any root, triads,
//                7ths, sus, power) by at most this much; null = don't check.
export const SENSITIVITY = {
  strict: { threshold: 0.8, margin: 0.0, genericMargin: 0.05 },
  normal: { threshold: 0.78, margin: 0.02, genericMargin: 0.1 },
  lenient: { threshold: 0.72, margin: 0.04, genericMargin: null },
};

/**
 * Decide whether `chroma` matches `target` (a chord object with .pcs).
 * `pool` is the list of chords currently in play; the target must score at
 * least as well as any pool chord with a different pitch-class set (minus a
 * small margin), and not be clearly beaten by a generic chord template.
 */
export function matchChord(chroma, target, pool, sensitivity = 'normal') {
  const { threshold, margin, genericMargin } = SENSITIVITY[sensitivity] || SENSITIVITY.normal;
  const score = templateScore(chroma, target.pcs);
  let bestOther = -1;
  let bestOtherChord = null;
  for (const c of pool) {
    if (samePcs(c.pcs, target.pcs)) continue;
    const s = templateScore(chroma, c.pcs);
    if (s > bestOther) {
      bestOther = s;
      bestOtherChord = c;
    }
  }
  let match = score >= threshold && score >= bestOther - margin;
  if (match && genericMargin != null) {
    for (const c of GENERIC_TEMPLATES) {
      if (samePcs(c.pcs, target.pcs)) continue;
      if (templateScore(chroma, c.pcs) > score + genericMargin) {
        match = false;
        break;
      }
    }
  }
  return { match, score, bestOther, bestOtherChord };
}

/** Best guess for what chord the chroma represents (for "heard: X" labels). */
export function identifyChord(chroma, pool = []) {
  let best = null;
  let bestScore = -1;
  // Pool chords first so that voicing names (e.g. "Cadd9") are preferred on ties.
  for (const c of [...pool, ...GENERIC_TEMPLATES]) {
    const s = templateScore(chroma, c.pcs);
    if (s > bestScore + 1e-9) {
      bestScore = s;
      best = c;
    }
  }
  return { chord: best, score: bestScore };
}
