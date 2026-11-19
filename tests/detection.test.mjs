// Regression tests for the detection pipeline (synthesized guitar audio).
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaTest, streamTest, noteTest } from './eval-detection.mjs';
import { CHORD_BY_NAME } from '../js/music/chords.js';
import { PitchDetector } from '../js/audio/pitch.js';
import { fft } from '../js/audio/fft.js';

test('FFT of a pure tone peaks at the right bin', () => {
  const n = 1024;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
  fft(re, im);
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
  assert.equal(best, 37);
});

test('pitch detector finds low E and high A within 5 cents', () => {
  const sr = 48000;
  const det = new PitchDetector(2048, sr);
  for (const f of [82.41, 110, 196, 440, 880]) {
    const x = new Float32Array(2048);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] = Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t);
    }
    const r = det.detect(x);
    assert.ok(r, `no pitch for ${f}`);
    const cents = 1200 * Math.log2(r.freq / f);
    assert.ok(Math.abs(cents) < 5, `${f} Hz detected as ${r.freq.toFixed(2)} (${cents.toFixed(1)} cents)`);
  }
});

test('chord voicings have the expected pitch classes', () => {
  assert.deepEqual(CHORD_BY_NAME.C.pcs, [0, 4, 7]);
  assert.deepEqual(CHORD_BY_NAME.Am.pcs, [0, 4, 9]);
  assert.deepEqual(CHORD_BY_NAME.D7.pcs, [0, 2, 6, 9]);
  assert.deepEqual(CHORD_BY_NAME['F#m'].pcs, [1, 6, 9]);
});

test('static chroma matching: high recall, few false accepts', () => {
  for (const r of chromaTest(8192, 'normal', 4)) {
    assert.ok(r.recall >= 0.93, `${r.cond}: recall ${r.recall}`);
    assert.ok(r.falseAcceptRate <= 0.015, `${r.cond}: false accept ${r.falseAcceptRate}`);
  }
});

test('streaming chord judge accepts every correct strum and no wrong ones', () => {
  for (const preset of ['beginner', 'campfire', 'sevenths', 'barre']) {
    const r = streamTest(preset, preset.length * 13);
    assert.equal(r.accepted, r.expected, `${preset}: accepted ${r.accepted}/${r.expected}`);
    assert.equal(r.falseAccepts, 0, `${preset}: false accepts`);
    assert.ok(r.timingErrMs < 15, `${preset}: onset timing error ${r.timingErrMs}ms`);
    assert.ok(r.wrongReported >= r.wrongStrums - 1, `${preset}: wrong strums reported`);
  }
});

test('finger noise between chords is not reported as a wrong strum', () => {
  for (const preset of ['beginner', 'campfire']) {
    const r = streamTest(preset, preset.length * 13, undefined, 30, { fingerNoise: true });
    assert.equal(r.accepted, r.expected, `${preset}: accepted ${r.accepted}/${r.expected}`);
    assert.equal(r.falseAccepts, 0);
    assert.ok(r.wrongReported <= r.wrongStrums, `${preset}: ${r.wrongReported} wrong reports for ${r.wrongStrums} wrong strums`);
  }
});

test('note tracker detects plucked notes across the neck', () => {
  const r = noteTest();
  assert.ok(r.hit >= r.notes - 1, `hit ${r.hit}/${r.notes}`);
  assert.equal(r.octaveErr, 0);
  assert.ok(r.extra <= 2, `extra detections: ${r.extra}`);
});
