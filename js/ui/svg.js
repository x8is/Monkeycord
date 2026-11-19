// Small SVG renderers: chord diagrams, treble staff, fretboard, bar charts.
// All colours come from CSS classes so the theme stays in style.css.
import { STANDARD_TUNING, STRING_NAMES } from '../music/theory.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------------------
// Chord diagram (vertical: strings left->right low E..high e, frets downward)
// ---------------------------------------------------------------------------
export function chordDiagram(chord, { showFingers = true } = {}) {
  const fretted = chord.frets.filter((f) => f > 0);
  const maxFret = Math.max(0, ...fretted);
  const minFret = fretted.length ? Math.min(...fretted) : 1;
  const base = maxFret <= 4 ? 1 : minFret;
  const rows = 4;
  const x0 = 22, y0 = 30, dx = 16, dy = 22;
  const W = x0 + dx * 5 + 18;
  const H = y0 + dy * rows + 10;
  const sx = (s) => x0 + s * dx;
  const parts = [];
  // Fret lines
  for (let r = 0; r <= rows; r++) {
    const y = y0 + r * dy;
    parts.push(`<line class="cd-fret" x1="${sx(0)}" y1="${y}" x2="${sx(5)}" y2="${y}"/>`);
  }
  if (base === 1) parts.push(`<rect class="cd-nut" x="${sx(0) - 1}" y="${y0 - 4}" width="${dx * 5 + 2}" height="5" rx="1"/>`);
  else parts.push(`<text class="cd-basefret" x="${x0 - 8}" y="${y0 + dy * 0.5 + 4}" text-anchor="end">${base}</text>`);
  // Strings
  for (let s = 0; s < 6; s++) {
    parts.push(`<line class="cd-string" x1="${sx(s)}" y1="${y0}" x2="${sx(s)}" y2="${y0 + rows * dy}"/>`);
  }
  // Barre
  if (chord.barre) {
    const r = chord.barre.fret - base;
    const y = y0 + (r + 0.5) * dy;
    parts.push(
      `<rect class="cd-barre" x="${sx(chord.barre.from) - 6}" y="${y - 6}" width="${sx(chord.barre.to) - sx(chord.barre.from) + 12}" height="12" rx="6"/>`,
    );
  }
  // Markers and dots
  chord.frets.forEach((f, s) => {
    const x = sx(s);
    if (f < 0) {
      parts.push(`<text class="cd-mute" x="${x}" y="${y0 - 10}" text-anchor="middle">×</text>`);
    } else if (f === 0) {
      parts.push(`<circle class="cd-open" cx="${x}" cy="${y0 - 14}" r="4.2"/>`);
    } else {
      const r = f - base;
      const y = y0 + (r + 0.5) * dy;
      const onBarre = chord.barre && chord.barre.fret === f && s >= chord.barre.from && s <= chord.barre.to;
      if (!onBarre || s === chord.barre.from) {
        if (!onBarre) parts.push(`<circle class="cd-dot" cx="${x}" cy="${y}" r="6.5"/>`);
      }
      const finger = chord.fingers?.[s];
      if (showFingers && finger && !onBarre) {
        parts.push(`<text class="cd-finger" x="${x}" y="${y + 3.6}" text-anchor="middle">${finger}</text>`);
      }
    }
  });
  return `<svg class="chord-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(chord.name)} chord diagram">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Treble staff. notes: [{letter:'C', acc:''|'#'|'b', octave:4, state}]
// (written pitch; guitar sounds an octave lower than written)
// ---------------------------------------------------------------------------
const LETTERS = 'CDEFGAB';
export const diatonicStep = (letter, octave) => octave * 7 + LETTERS.indexOf(letter);
const BOTTOM_LINE = diatonicStep('E', 4); // 30
const TOP_LINE = diatonicStep('F', 5); // 38

export function staffSVG(notes, { currentIndex = -1 } = {}) {
  const sp = 12; // distance between staff lines
  const half = sp / 2;
  const left = 70;
  const noteGap = 64;
  const W = left + notes.length * noteGap + 20;
  const top = 70; // y of top line
  const bottomY = top + 4 * sp;
  const H = bottomY + 74;
  const yOf = (step) => bottomY - (step - BOTTOM_LINE) * half;
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(`<line class="st-line" x1="8" y1="${top + i * sp}" x2="${W - 8}" y2="${top + i * sp}"/>`);
  parts.push(`<text class="st-clef" x="12" y="${bottomY + 13}">𝄞</text>`);
  notes.forEach((n, i) => {
    const x = left + i * noteGap + noteGap / 2;
    const step = diatonicStep(n.letter, n.octave);
    const y = yOf(step);
    const cls = i === currentIndex ? 'current' : n.state || '';
    const g = [];
    // Ledger lines
    for (let s = BOTTOM_LINE - 2; s >= step; s -= 2) g.push(`<line class="st-ledger" x1="${x - 13}" y1="${yOf(s)}" x2="${x + 13}" y2="${yOf(s)}"/>`);
    for (let s = TOP_LINE + 2; s <= step; s += 2) g.push(`<line class="st-ledger" x1="${x - 13}" y1="${yOf(s)}" x2="${x + 13}" y2="${yOf(s)}"/>`);
    if (n.acc) g.push(`<text class="st-acc" x="${x - 18}" y="${y + 7}" text-anchor="middle">${n.acc === '#' ? '♯' : '♭'}</text>`);
    g.push(`<ellipse class="st-head" cx="${x}" cy="${y}" rx="7.2" ry="5.2" transform="rotate(-20 ${x} ${y})"/>`);
    // Stem: up if below middle line (B4), down otherwise.
    const middle = diatonicStep('B', 4);
    if (step < middle) g.push(`<line class="st-stem" x1="${x + 6.6}" y1="${y - 1}" x2="${x + 6.6}" y2="${y - 36}"/>`);
    else g.push(`<line class="st-stem" x1="${x - 6.6}" y1="${y + 1}" x2="${x - 6.6}" y2="${y + 36}"/>`);
    if (n.label) g.push(`<text class="st-label" x="${x}" y="${H - 8}" text-anchor="middle">${esc(n.label)}</text>`);
    parts.push(`<g class="st-note ${cls}">${g.join('')}</g>`);
  });
  return `<svg class="staff" viewBox="0 0 ${W} ${H}" role="img" aria-label="Staff notation">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Horizontal fretboard (high e on top, like tab). marks: [{string, fret, label, cls, value}]
// ---------------------------------------------------------------------------
export function fretboardSVG({ frets = 12, marks = [], highlightRange = null } = {}) {
  const left = 44, top = 16, fw = 46, sp = 18;
  const W = left + fw * (frets + 0.5) + 10;
  const H = top + sp * 5 + 30;
  const yOf = (s) => top + (5 - s) * sp; // s: 0 = low E (bottom)
  const xOf = (f) => (f === 0 ? left - 14 : left + (f - 0.5) * fw);
  const parts = [];
  if (highlightRange) {
    const [a, b] = highlightRange;
    const x1 = a === 0 ? left - 26 : left + (a - 1) * fw;
    parts.push(`<rect class="fb-range" x="${x1}" y="${top - 8}" width="${left + b * fw - x1}" height="${sp * 5 + 16}" rx="4"/>`);
  }
  for (const f of [3, 5, 7, 9, 15, 17]) if (f <= frets) parts.push(`<circle class="fb-inlay" cx="${xOf(f)}" cy="${top + 2.5 * sp}" r="4"/>`);
  if (frets >= 12) {
    parts.push(`<circle class="fb-inlay" cx="${xOf(12)}" cy="${top + 1.5 * sp}" r="4"/>`);
    parts.push(`<circle class="fb-inlay" cx="${xOf(12)}" cy="${top + 3.5 * sp}" r="4"/>`);
  }
  for (let f = 0; f <= frets; f++) {
    const x = left + f * fw;
    parts.push(`<line class="${f === 0 ? 'fb-nut' : 'fb-fret'}" x1="${x}" y1="${top}" x2="${x}" y2="${top + 5 * sp}"/>`);
    if (f > 0) parts.push(`<text class="fb-num" x="${xOf(f)}" y="${H - 6}" text-anchor="middle">${f}</text>`);
  }
  for (let s = 0; s < 6; s++) {
    parts.push(`<line class="fb-string" x1="${left}" y1="${yOf(s)}" x2="${left + fw * frets}" y2="${yOf(s)}" style="stroke-width:${0.8 + (5 - s) * 0.25}"/>`);
    parts.push(` <text class="fb-sname" x="4" y="${yOf(s) + 4}">${STRING_NAMES[s]}</text>`);
  }
  for (const m of marks) {
    const x = xOf(m.fret);
    const y = yOf(m.string);
    const style = m.fill ? ` style="fill:${m.fill}"` : '';
    parts.push(`<g class="fb-mark ${m.cls || ''}"><title>${esc(m.title || '')}</title><circle cx="${x}" cy="${y}" r="8"${style}/>`);
    if (m.label) parts.push(`<text x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(m.label)}</text>`);
    parts.push('</g>');
  }
  return `<svg class="fretboard" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fretboard">${parts.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Bar chart: bars [{label, value, title, cls}] ; value in ms (or anything)
// ---------------------------------------------------------------------------
export function barChart(bars, { height = 120, unit = 'ms', showLabels = true } = {}) {
  if (!bars.length) return '';
  const W = 820;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const bw = W / bars.length;
  const top = 14;
  const H = height + top + (showLabels ? 18 : 4);
  const parts = [];
  // Grid at max/2
  parts.push(`<line class="bc-grid" x1="0" y1="${top + height / 2}" x2="${W}" y2="${top + height / 2}"/>`);
  parts.push(`<text class="bc-axis" x="2" y="${top - 3}">${Math.round(max)}${unit}</text>`);
  bars.forEach((b, i) => {
    const h = Math.max(1.5, (b.value / max) * height);
    const x = i * bw + bw * 0.15;
    parts.push(
      `<rect class="bc-bar ${b.cls || ''}" x="${x}" y="${top + height - h}" width="${bw * 0.7}" height="${h}" rx="2"><title>${esc(b.title || `${b.label}: ${Math.round(b.value)}${unit}`)}</title></rect>`,
    );
    if (showLabels && bars.length <= 48)
      parts.push(`<text class="bc-label" x="${x + bw * 0.35}" y="${H - 4}" text-anchor="middle">${esc(b.label)}</text>`);
  });
  return `<svg class="bar-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`;
}

export const tuningLabel = () => STANDARD_TUNING.map((m, i) => STRING_NAMES[i]).join(' ');
