// Plucked-string guitar synthesizer (extended Karplus-Strong).
// Used for (a) the "simulated guitar" input in the browser, so the app can be
// tried without a guitar, and (b) automated detection tests in Node.
import { midiToFreq, STANDARD_TUNING } from '../music/theory.js';

/** Small seedable PRNG so tests are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render one plucked string into `out` (added), starting at `start`.
 * Options: amp, t60 (seconds), pluckPos (0..0.5), brightness (0..1),
 * length (samples to render), rng.
 */
export function renderPluck(out, start, freq, sr, opts = {}) {
  const {
    amp = 0.25,
    t60 = 3.5,
    pluckPos = 0.15,
    brightness = 0.6,
    length = Math.floor(sr * 2.5),
    releaseAt = Infinity, // sample offset (relative to start) where the note is damped
    rng = Math.random,
  } = opts;
  // Loop delay = N - 0.5 (reading buf[idx] and buf[idx+1]) + allpass fraction.
  const period = sr / freq + 0.5;
  let N = Math.floor(period);
  let frac = period - N;
  if (frac < 0.1) {
    N -= 1;
    frac += 1;
  }
  const C = (1 - frac) / (1 + frac); // first-order allpass for fractional delay
  const buf = new Float64Array(N);
  // Excitation: noise burst, low-passed by brightness, comb-filtered by pluck position.
  let lp = 0;
  const a = 0.2 + 0.75 * brightness;
  for (let i = 0; i < N; i++) {
    lp += a * (rng() * 2 - 1 - lp);
    buf[i] = lp;
  }
  const d = Math.max(1, Math.round(pluckPos * N));
  const exc = Float64Array.from(buf);
  for (let i = 0; i < N; i++) buf[i] = exc[i] - (i >= d ? exc[i - d] : 0);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  let peak = 1e-9;
  for (let i = 0; i < N; i++) {
    buf[i] -= mean;
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  for (let i = 0; i < N; i++) buf[i] *= amp / peak;

  const rho = Math.pow(0.001, 1 / (freq * t60));
  let idx = 0;
  let apIn = 0;
  let apOut = 0;
  const end = Math.min(out.length, start + length);
  const releaseLen = Math.floor(sr * 0.03);
  for (let n = start, k = 0; n < end; n++, k++) {
    const cur = buf[idx];
    let env = 1;
    if (k >= releaseAt) {
      const r = (k - releaseAt) / releaseLen;
      if (r >= 1) break;
      env = Math.pow(0.001, r);
    }
    if (n >= 0) out[n] += cur * env;
    const nxt = buf[idx + 1 < N ? idx + 1 : 0];
    const avg = rho * 0.5 * (cur + nxt);
    const y = C * avg + apIn - C * apOut;
    apIn = avg;
    apOut = y;
    buf[idx] = y;
    idx = idx + 1 < N ? idx + 1 : 0;
  }
}

/**
 * Render a strummed chord into `out`.
 * @param {number[]} frets per string low->high, -1 = muted
 */
export function renderStrum(out, start, frets, sr, opts = {}) {
  const {
    rng = Math.random,
    strumMs = 12, // delay between adjacent strings
    up = false,
    detuneCents = 6, // random per-string detune
    tuningCents = 0, // global tuning offset
    amp = 0.22,
    length = Math.floor(sr * 2.5),
    releaseAt = Infinity,
  } = opts;
  const order = frets.map((f, s) => s).filter((s) => frets[s] >= 0);
  if (up) order.reverse();
  order.forEach((s, i) => {
    const midi = STANDARD_TUNING[s] + frets[s];
    const cents = tuningCents + (rng() * 2 - 1) * detuneCents;
    const freq = midiToFreq(midi) * Math.pow(2, cents / 1200);
    const offset = Math.floor(((i * strumMs) / 1000) * sr * (0.8 + 0.4 * rng()));
    renderPluck(out, start + offset, freq, sr, {
      amp: amp * (0.65 + 0.35 * rng()),
      t60: 2.2 + 3.0 * (1 - s / 6) * (0.8 + 0.4 * rng()),
      pluckPos: 0.1 + 0.12 * rng(),
      brightness: 0.45 + 0.4 * rng(),
      length,
      releaseAt: releaseAt === Infinity ? Infinity : Math.max(0, releaseAt - offset),
      rng,
    });
  });
}

/** Add white noise and mains hum to simulate a cheap mic in a room. */
export function addRoomNoise(out, sr, { noiseLevel = 0.002, humLevel = 0.002, rng = Math.random } = {}) {
  for (let n = 0; n < out.length; n++) {
    const t = n / sr;
    out[n] +=
      noiseLevel * (rng() * 2 - 1) +
      humLevel * (Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 100 * t));
  }
}
