// Minimal iterative radix-2 FFT with cached tables. No dependencies.

const tableCache = new Map();

function getTables(n) {
  let t = tableCache.get(n);
  if (t) return t;
  if (n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  t = { rev, cos, sin };
  tableCache.set(n, t);
  return t;
}

/** In-place forward FFT of (re, im). Both arrays must have power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = getTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hannCache = new Map();
export function hann(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/**
 * Hann-windowed magnitude spectrum of `frame` (length n, power of two).
 * Returns Float64Array of length n/2.
 */
export function magnitudeSpectrum(frame, out) {
  const n = frame.length;
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * w[i];
  fft(re, im);
  const mag = out || new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}
