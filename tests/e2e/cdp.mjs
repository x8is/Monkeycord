// Tiny headless-Chrome driver over the DevTools protocol (no dependencies,
// uses Node 22's built-in WebSocket). Set CHROME_PATH to override the browser.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p));
const SHOTS = join(fileURLToPath(new URL('.', import.meta.url)), 'screens');

export async function launch({ port = 9333, width = 1280, height = 900 } = {}) {
  if (!CHROME) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  const profile = join(tmpdir(), `monkeycord-e2e-${port}`);
  mkdirSync(profile, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push(`[exception] ${d.exception?.description || d.text} @${d.url}:${d.lineNumber}`);
    } else if (msg.method === 'Log.entryAdded') {
      logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const api = {
    send,
    logs,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(1200);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, code = key, keyCode = 0) {
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 ? key : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async click(selector) {
      const box = await api.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    async shot(file, { width: w, height: hgt } = {}) {
      if (w) await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: w < 500 });
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const path = join(SHOTS, file);
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    async close() {
      try { await send('Browser.close'); } catch {}
      ws.close();
      setTimeout(() => proc.kill(), 500);
    },
  };
  return api;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
