// Browser smoke test: starts the dev server, opens headless Chrome, uses the
// simulated guitar + bot in every mode and checks that the detection pipeline
// (AudioWorklet -> analyzer -> detectors -> UI) advances. Screenshots are
// written to tests/e2e/screens/.
// Run: npm run e2e
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const PORT = 5199;
const root = fileURLToPath(new URL('../..', import.meta.url));
const server = spawn(process.execPath, ['tools/serve.js', String(PORT)], { cwd: root, stdio: 'ignore' });
await sleep(600);

const url = (hash) => `http://localhost:${PORT}/#${hash}`;
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures.push(msg);
};

const b = await launch({ port: 9339 });
const clickPill = (label) => b.eval(`[...document.querySelectorAll('.config .pill')].find(p => p.textContent === ${JSON.stringify(label)}).click()`);
const state = () => b.eval(`({ phase: monkeycord.mode.phase, idx: monkeycord.mode.idx, wrongs: monkeycord.mode.wrongs })`);

// Hash navigation doesn't reload the page, so only click the start button if
// the overlay is showing, and set the bot state explicitly.
async function open(hash) {
  await b.goto(url(hash));
  if (await b.eval(`!document.querySelector('#startOverlay').hidden`)) await b.click('#useSim');
  await sleep(600);
}
async function botOn() {
  if (await b.eval(`document.querySelector('#botBtn').textContent.includes('off')`)) await b.key('b', 'KeyB', 66);
}

try {
  await open('chords');
  check(await b.eval(`monkeycord.engine.ctx.state === 'running'`), 'audio context running');
  await clickPill('changes');
  await clickPill('10');
  await botOn();
  await sleep(4000);
  await b.shot('chords-running.png');
  const c1 = await state();
  check(c1.phase === 'running' && c1.idx >= 2, `chords: bot strums are detected (idx ${c1.idx})`);
  await sleep(14000);
  const c2 = await state();
  check(c2.phase === 'done', `chords: 10-change test finishes (phase ${c2.phase}, idx ${c2.idx})`);
  check(await b.eval(`!!document.querySelector('.results .res-value')`), 'chords: results screen shows');
  await b.shot('chords-results.png');

  await open('fretboard');
  await clickPill('10');
  await botOn();
  await sleep(20000);
  const f = await state();
  check(f.phase === 'done', `fretboard: 10 prompts complete (phase ${f.phase}, idx ${f.idx})`);
  await b.shot('fretboard-results.png');

  await open('npm');
  await clickPill('25');
  await botOn();
  await sleep(15000);
  const n = await state();
  check(n.idx >= 15, `notes: scale run advances (idx ${n.idx})`);
  await b.shot('npm.png');

  await open('sight');
  await clickPill('16');
  await botOn();
  await sleep(16000);
  const s = await state();
  check(s.idx >= 10, `sight-read: notes advance (idx ${s.idx})`);
  await b.shot('sight.png');

  await open('tuner');
  await b.key('Enter', 'Enter', 13);
  await sleep(500);
  check(await b.eval(`document.querySelector('.tuner-note').textContent !== '–'`), 'tuner: shows a note');

  await b.shot('mobile.png', { width: 390, height: 844 });
  check((await b.eval(`document.documentElement.scrollWidth - window.innerWidth`)) <= 0, 'no horizontal scroll at 390px');

  const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[console.error]'));
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  check(false, `exception: ${e.message}`);
} finally {
  await b.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall browser checks passed');
process.exitCode = failures.length ? 1 : 0;
