// Detection accuracy evaluation using synthesized guitar audio.
// Run: node tests/eval-detection.mjs
import { CHORDS, CHORD_BY_NAME, CHORD_PRESETS } from '../js/music/chords.js';
import { renderStrum, renderPluck, addRoomNoise, mulberry32 } from '../js/audio/synth.js';
import { computeChroma, matchChord } from '../js/audio/chroma.js';
import { Analyzer } from '../js/audio/analyzer.js';
import { ChordJudge, NoteTracker } from '../js/audio/detectors.js';
import { midiToFreq } from '../js/music/theory.js';

const SR = 48000;
const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');

const CONDITIONS = [
  { name: 'clean', noise: 0, hum: 0, tuning: 0, detune: 3 },
  { name: 'room', noise: 0.003, hum: 0.003, tuning: 0, detune: 6 },
  { name: 'noisy+15c flat', noise: 0.008, hum: 0.006, tuning: -15, detune: 10 },
];

// ---------------------------------------------------------------------------
// 1. Static chroma test: one strum, window right after the attack.
// ---------------------------------------------------------------------------
export function chromaTest(windowSize = 8192, sensitivity = 'normal', trials = 6) {
  const results = [];
  for (const cond of CONDITIONS) {
    let tp = 0, fn = 0, fp = 0, tn = 0;
    const misses = {};
    const falseAccepts = {};
    for (const chord of CHORDS) {
      const pools = Object.values(CHORD_PRESETS).filter((p) => p.chords.includes(chord.name));
      const pool = [...new Set(pools.flatMap((p) => p.chords))].map((n) => CHORD_BY_NAME[n]);
      for (let t = 0; t < trials; t++) {
        const rng = mulberry32(1000 * t + chord.name.length * 7 + chord.frets.join('').length);
        const buf = new Float32Array(SR * 1);
        renderStrum(buf, 0, chord.frets, SR, {
          rng, detuneCents: cond.detune, tuningCents: cond.tuning, length: SR, up: t % 3 === 2,
        });
        addRoomNoise(buf, SR, { noiseLevel: cond.noise, humLevel: cond.hum, rng });
        const start = Math.floor(SR * 0.09) + Math.floor(rng() * SR * 0.05);
        const { chroma } = computeChroma(buf.subarray(start, start + windowSize), SR);
        // Played chord as target -> should match.
        if (matchChord(chroma, chord, pool, sensitivity).match) tp++;
        else {
          fn++;
          misses[chord.name] = (misses[chord.name] || 0) + 1;
        }
        // Every other pool chord as target -> should NOT match.
        for (const other of pool) {
          if (other === chord) continue;
          if (other.pcs.join() === chord.pcs.join()) continue;
          if (matchChord(chroma, other, pool, sensitivity).match) {
            fp++;
            const k = `${chord.name}->${other.name}`;
            falseAccepts[k] = (falseAccepts[k] || 0) + 1;
          } else tn++;
        }
      }
    }
    results.push({ cond: cond.name, recall: tp / (tp + fn), falseAcceptRate: fp / (fp + tn), misses, falseAccepts });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 2. Streaming test: a "player" strums each target chord after a reaction
//    delay; sometimes strums a wrong chord first. Pipeline must accept the
//    right ones (with accurate onset time) and never the wrong ones.
// ---------------------------------------------------------------------------
export function streamTest(presetKey = 'campfire', seed = 1, cond = CONDITIONS[1], n = 30, { fingerNoise = false } = {}) {
  const rng = mulberry32(seed);
  const pool = CHORD_PRESETS[presetKey].chords.map((c) => CHORD_BY_NAME[c]);
  const seq = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    let c;
    do c = pool[Math.floor(rng() * pool.length)];
    while (c === prev);
    seq.push(c);
    prev = c;
  }
  // Plan strum events: [{time, chord, intended}]
  const events = [];
  let t = 0.5;
  for (const c of seq) {
    if (rng() < 0.2) {
      let w;
      do w = pool[Math.floor(rng() * pool.length)];
      while (w.pcs.join() === c.pcs.join());
      events.push({ time: t, chord: w, wrong: true });
      t += 0.9 + rng() * 0.4;
    }
    events.push({ time: t, chord: c, wrong: false });
    t += 0.7 + rng() * 0.9;
  }
  const total = Math.ceil((t + 1.5) * SR);
  const buf = new Float32Array(total);
  events.forEach((e, i) => {
    const start = Math.floor(e.time * SR);
    const next = events[i + 1];
    const releaseAt = next ? Math.floor((next.time - 0.03) * SR) - start : Infinity;
    renderStrum(buf, start, e.chord.frets, SR, {
      rng, detuneCents: cond.detune, tuningCents: cond.tuning, up: rng() < 0.3,
      length: Math.floor(SR * 2.5), releaseAt,
    });
  });
  if (fingerNoise) {
    // Fretting hand lifting off: two quiet open strings ~0.4 s after each
    // correct strum (well before the next strum).
    events.forEach((e, i) => {
      const next = events[i + 1];
      if (e.wrong || !next || next.time - e.time < 0.65) return;
      const start = Math.floor((e.time + 0.4) * SR);
      renderStrum(buf, start, [0, 0, -1, -1, -1, -1].map((f, s) => (s < 2 ? 0 : -1)), SR, {
        rng, amp: 0.035, length: Math.floor(SR * 0.6), releaseAt: Math.floor((next.time - e.time - 0.45) * SR),
      });
    });
  }
  addRoomNoise(buf, SR, { noiseLevel: cond.noise, humLevel: cond.hum, rng });

  const analyzer = new Analyzer(SR);
  analyzer.pitchEnabled = false;
  const judge = new ChordJudge(analyzer);
  let idx = 0;
  const accepted = [];
  const wrongReports = [];
  judge.setTarget(seq[0], pool, 0);
  judge.onResult((r) => {
    if (r.type === 'correct') {
      accepted.push({ chord: r.target.name, onsetTime: r.onsetTime, decisionTime: r.decisionTime });
      idx++;
      if (idx < seq.length) judge.setTarget(seq[idx], pool, analyzer.processed);
    } else wrongReports.push(r);
  });
  let onsets = 0;
  analyzer.onFrame((f) => { if (f.onset) onsets++; });
  for (let i = 0; i < buf.length; i += 128) analyzer.push(buf.subarray(i, i + 128));

  // Match accepted results to intended events.
  const intended = events.filter((e) => !e.wrong);
  let timingErr = [];
  let latency = [];
  let falseAccepts = 0;
  accepted.forEach((a, i) => {
    const e = intended[i];
    if (!e) return;
    const err = a.onsetTime - e.time;
    if (Math.abs(err) > 0.3) falseAccepts++;
    timingErr.push(err * 1000);
    latency.push((a.decisionTime - e.time) * 1000);
  });
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    preset: presetKey,
    cond: cond.name,
    expected: seq.length,
    accepted: accepted.length,
    strums: events.length,
    onsets,
    wrongStrums: events.filter((e) => e.wrong).length,
    wrongReported: wrongReports.length,
    timingErrMs: avg(timingErr.map(Math.abs)),
    latencyMs: avg(latency),
    falseAccepts,
  };
}

// ---------------------------------------------------------------------------
// 3. Single-note test: plucked notes across the neck.
// ---------------------------------------------------------------------------
export function noteTest(cond = CONDITIONS[1], seed = 3) {
  const rng = mulberry32(seed);
  const notes = [];
  let t = 0.4;
  for (let i = 0; i < 60; i++) {
    let midi;
    do midi = 40 + Math.floor(rng() * 41); // E2..A5 (fret ~17 on high e)
    while (notes.length && notes[notes.length - 1].midi === midi);
    notes.push({ midi, time: t });
    t += 0.25 + rng() * 0.5;
  }
  const buf = new Float32Array(Math.ceil((t + 1) * SR));
  notes.forEach((n, i) => {
    const start = Math.floor(n.time * SR);
    const next = notes[i + 1];
    const cents = cond.tuning + (rng() * 2 - 1) * cond.detune;
    renderPluck(buf, start, midiToFreq(n.midi) * Math.pow(2, cents / 1200), SR, {
      rng, amp: 0.2 + 0.1 * rng(), t60: 2 + rng() * 2, pluckPos: 0.1 + 0.15 * rng(),
      brightness: 0.4 + 0.4 * rng(), length: SR * 2,
      releaseAt: next ? Math.floor((next.time - 0.02) * SR) - start : Infinity,
    });
  });
  addRoomNoise(buf, SR, { noiseLevel: cond.noise, humLevel: cond.hum, rng });
  const analyzer = new Analyzer(SR);
  const tracker = new NoteTracker(analyzer);
  const detected = [];
  tracker.onNote((n) => detected.push(n));
  for (let i = 0; i < buf.length; i += 128) analyzer.push(buf.subarray(i, i + 128));

  // For each played note find the first detection within [time-0.05, time+0.25].
  let hit = 0, octaveErr = 0, timing = [];
  const latencies = [];
  for (const n of notes) {
    const d = detected.find((x) => x.time >= n.time - 0.05 && x.time <= n.time + 0.25);
    if (!d) continue;
    if (d.midi === n.midi) {
      hit++;
      timing.push(Math.abs(d.time - n.time) * 1000);
    } else if ((d.midi - n.midi) % 12 === 0) octaveErr++;
  }
  const extra = detected.length - notes.length;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return { cond: cond.name, notes: notes.length, detected: detected.length, hit, octaveErr, extra, timingErrMs: avg(timing) };
}

if (process.argv[1]?.endsWith('eval-detection.mjs')) {
  const ws = Number([...args].find((a) => a.startsWith('--window='))?.split('=')[1] || 8192);
  console.log(`\n=== Static chroma test (window ${ws}) ===`);
  for (const sens of ['strict', 'normal', 'lenient']) {
    for (const r of chromaTest(ws, sens)) {
      console.log(
        `${sens.padEnd(8)} ${r.cond.padEnd(16)} recall ${(r.recall * 100).toFixed(1)}%  falseAccept ${(r.falseAcceptRate * 100).toFixed(2)}%`,
      );
      if (!quiet && sens === 'normal') {
        if (Object.keys(r.misses).length) console.log('   misses:', JSON.stringify(r.misses));
        if (Object.keys(r.falseAccepts).length) console.log('   falseAccepts:', JSON.stringify(r.falseAccepts));
      }
    }
  }
  console.log('\n=== Streaming chord test ===');
  for (const preset of ['beginner', 'campfire', 'sevenths', 'barre']) {
    for (const cond of CONDITIONS) {
      const r = streamTest(preset, preset.length * 13, cond);
      console.log(
        `${preset.padEnd(9)} ${cond.name.padEnd(16)} accepted ${r.accepted}/${r.expected}  falseAcc ${r.falseAccepts}  ` +
          `wrongStrums ${r.wrongStrums} reported ${r.wrongReported}  onsets ${r.onsets}/${r.strums}  ` +
          `onsetErr ${r.timingErrMs.toFixed(1)}ms  latency ${r.latencyMs.toFixed(0)}ms`,
      );
    }
  }
  console.log('\n=== Streaming with finger noise after each chord ===');
  for (const preset of ['beginner', 'campfire', 'sevenths']) {
    const r = streamTest(preset, preset.length * 13, CONDITIONS[1], 30, { fingerNoise: true });
    console.log(
      `${preset.padEnd(9)} accepted ${r.accepted}/${r.expected}  falseAcc ${r.falseAccepts}  ` +
        `wrongStrums ${r.wrongStrums} reported ${r.wrongReported}  onsets ${r.onsets}/${r.strums}`,
    );
  }
  console.log('\n=== Single-note test ===');
  for (const cond of CONDITIONS) {
    const r = noteTest(cond);
    console.log(
      `${cond.name.padEnd(16)} hit ${r.hit}/${r.notes}  octaveErr ${r.octaveErr}  extraDetections ${r.extra}  timingErr ${r.timingErrMs.toFixed(1)}ms`,
    );
  }
}
