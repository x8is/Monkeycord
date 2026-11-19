// Browser audio engine: microphone or simulated guitar -> AudioWorklet -> Analyzer.
import { Analyzer } from './analyzer.js';
import { renderStrum, renderPluck } from './synth.js';
import { midiToFreq } from '../music/theory.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyzer = null;
    this.source = null; // 'mic' | 'sim'
    this.micStream = null;
    this.micNode = null;
    this.simBus = null;
    this.simVoice = null;
    this.inputGain = null;
    this.monitor = null;
    this.level = 0;
    this.listeners = new Set();
    this.simVolume = 0.6;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get sampleRate() {
    return this.ctx?.sampleRate || 48000;
  }

  /** Current position in the analysis timeline, in samples. */
  get now() {
    return this.analyzer ? this.analyzer.processed : 0;
  }

  /** Current analysis time in seconds. */
  get time() {
    return this.analyzer ? this.analyzer.time : 0;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _changed() {
    for (const fn of this.listeners) fn(this);
  }

  async _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    const worklet = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.analyzer = new Analyzer(ctx.sampleRate);
    worklet.port.onmessage = (e) => this.analyzer.push(e.data);
    this.analyzer.onFrame((f) => {
      this.level = f.rms;
    });
    // The worklet must be pulled by the graph; route it into a muted gain.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    worklet.connect(sink).connect(ctx.destination);
    this.inputGain = ctx.createGain();
    this.inputGain.connect(worklet);
    // Simulated guitar bus: feeds the analyser and (optionally) the speakers.
    this.simBus = ctx.createGain();
    this.monitor = ctx.createGain();
    this.monitor.gain.value = this.simVolume;
    this.simBus.connect(this.monitor).connect(ctx.destination);
    this.ctx = ctx;
    this.worklet = worklet;
    if (ctx.state !== 'running') await ctx.resume();
  }

  setInputGain(g) {
    if (this.inputGain) this.inputGain.gain.value = g;
  }

  setSimVolume(v) {
    this.simVolume = v;
    if (this.monitor) this.monitor.gain.value = v;
  }

  /** Switch input. Must be called from a user gesture the first time. */
  async useSource(kind) {
    await this._ensureContext();
    if (kind === this.source) return;
    // Disconnect previous.
    if (this.micNode) {
      this.micNode.disconnect();
      this.micNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    try {
      this.simBus.disconnect(this.inputGain);
    } catch {
      /* not connected */
    }
    if (kind === 'mic') {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.micNode = this.ctx.createMediaStreamSource(this.micStream);
      this.micNode.connect(this.inputGain);
    } else {
      this.simBus.connect(this.inputGain);
    }
    this.source = kind;
    this._changed();
  }

  // ---- Simulated guitar --------------------------------------------------
  _playBuffer(data) {
    if (!this.ctx || this.source !== 'sim') return;
    const now = this.ctx.currentTime;
    if (this.simVoice) {
      // Damp the previous chord like a fretting hand lifting off.
      const { gain, node } = this.simVoice;
      gain.gain.setTargetAtTime(0, now, 0.012);
      node.stop(now + 0.15);
    }
    const buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    const gain = this.ctx.createGain();
    node.connect(gain).connect(this.simBus);
    node.start(now + 0.01);
    this.simVoice = { node, gain };
  }

  /** Strum a chord on the simulated guitar. frets: low E -> high e, -1 muted. */
  simStrum(frets, { up = false } = {}) {
    const sr = this.sampleRate;
    const data = new Float32Array(Math.floor(sr * 2.5));
    renderStrum(data, 0, frets, sr, { up, amp: 0.2, detuneCents: 5 });
    this._playBuffer(data);
  }

  /** Pluck a single note on the simulated guitar. */
  simPluck(midi) {
    const sr = this.sampleRate;
    const data = new Float32Array(Math.floor(sr * 1.8));
    const cents = (Math.random() * 2 - 1) * 4;
    renderPluck(data, 0, midiToFreq(midi) * Math.pow(2, cents / 1200), sr, {
      amp: 0.3,
      t60: 2.2,
      length: data.length,
      pluckPos: 0.12 + Math.random() * 0.1,
    });
    this._playBuffer(data);
  }
}
