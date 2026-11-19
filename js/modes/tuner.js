// Tuner + input check. Detection accuracy depends on a tuned guitar, so this
// lives next to the trainers.
import { STANDARD_TUNING, STRING_NAMES, noteName, midiToFreq } from '../music/theory.js';

export class TunerMode {
  static id = 'tuner';
  static label = 'tuner';

  constructor(app) {
    this.app = app;
    this.smooth = null;
  }

  mount() {
    this.app.configEl.innerHTML = '<span class="cfg-label">standard tuning · E A D G B e</span>';
    this.app.configExtraEl.innerHTML = '';
    this.app.stageEl.innerHTML = `
      <div class="tuner">
        <div class="tuner-note">–</div>
        <div class="tuner-meter"><div class="tuner-scale"></div><div class="tuner-center"></div><div class="tuner-needle"></div></div>
        <div class="tuner-readout">play a single string</div>
        <div class="tuner-strings">${STANDARD_TUNING.map((m, i) => `<span data-s="${i}">${STRING_NAMES[i]}<small>${noteName(m, { octave: true })}</small></span>`).join('')}</div>
      </div>`;
  }

  unmount() {}
  restart() {}
  skip() {}
  botKey() {
    return null;
  }
  simulate() {
    const s = Math.floor(Math.random() * 6);
    this.app.engine.simPluck(STANDARD_TUNING[s]);
  }

  tick() {
    const cur = this.app.notes.current;
    const root = this.app.stageEl;
    const noteEl = root.querySelector('.tuner-note');
    if (!noteEl) return;
    if (!cur) {
      root.querySelector('.tuner').classList.add('idle');
      return;
    }
    root.querySelector('.tuner').classList.remove('idle');
    const exact = 69 + 12 * Math.log2(cur.freq / 440);
    // Snap to the nearest open string when close to one, otherwise the nearest note.
    let target = Math.round(exact);
    let sIdx = STANDARD_TUNING.findIndex((m) => Math.abs(exact - m) < 1.5);
    if (sIdx >= 0) target = STANDARD_TUNING[sIdx];
    const cents = (exact - target) * 100;
    this.smooth = this.smooth == null ? cents : this.smooth * 0.7 + cents * 0.3;
    const c = Math.max(-50, Math.min(50, this.smooth));
    noteEl.textContent = noteName(target, { octave: true });
    const needle = root.querySelector('.tuner-needle');
    needle.style.left = `${50 + c}%`;
    const inTune = Math.abs(this.smooth) < 5;
    needle.classList.toggle('in-tune', inTune);
    root.querySelector('.tuner-readout').textContent = `${cur.freq.toFixed(1)} Hz · ${this.smooth > 0 ? '+' : ''}${Math.round(this.smooth)} cents · target ${midiToFreq(target).toFixed(1)} Hz`;
    root.querySelectorAll('.tuner-strings span').forEach((el) => el.classList.toggle('active', Number(el.dataset.s) === sIdx));
  }
}
