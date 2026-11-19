// Chord library: voicings (frets from low E to high e, -1 = muted string),
// suggested fingers (0 = open / unfretted), optional barre.
import { STANDARD_TUNING, pitchClass, parsePitchClass } from './theory.js';

const RAW = [
  // name, frets, fingers, barre (fret, fromString, toString), tags
  ['C', [-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0], null, 'open major'],
  ['D', [-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2], null, 'open major'],
  ['E', [0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0], null, 'open major'],
  ['G', [3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3], null, 'open major'],
  ['A', [-1, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0], null, 'open major'],
  ['Am', [-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0], null, 'open minor'],
  ['Em', [0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0], null, 'open minor'],
  ['Dm', [-1, -1, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1], null, 'open minor'],
  ['E7', [0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0], null, 'open seventh'],
  ['A7', [-1, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0], null, 'open seventh'],
  ['D7', [-1, -1, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3], null, 'open seventh'],
  ['G7', [3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1], null, 'open seventh'],
  ['C7', [-1, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0], null, 'open seventh'],
  ['B7', [-1, 2, 1, 2, 0, 2], [0, 2, 1, 3, 0, 4], null, 'open seventh'],
  ['Am7', [-1, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0], null, 'open seventh'],
  ['Em7', [0, 2, 2, 0, 3, 0], [0, 1, 2, 0, 4, 0], null, 'open seventh'],
  ['Dm7', [-1, -1, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1], null, 'open seventh'],
  ['Cmaj7', [-1, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0], null, 'open seventh'],
  ['Fmaj7', [-1, -1, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0], null, 'open seventh'],
  ['Cadd9', [-1, 3, 2, 0, 3, 3], [0, 2, 1, 0, 3, 4], null, 'open color'],
  ['Asus2', [-1, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0], null, 'open color'],
  ['Asus4', [-1, 0, 2, 2, 3, 0], [0, 0, 1, 2, 3, 0], null, 'open color'],
  ['Dsus2', [-1, -1, 0, 2, 3, 0], [0, 0, 0, 1, 3, 0], null, 'open color'],
  ['Dsus4', [-1, -1, 0, 2, 3, 3], [0, 0, 0, 1, 3, 4], null, 'open color'],
  ['Esus4', [0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0], null, 'open color'],
  ['F', [1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1], [1, 0, 5], 'barre major'],
  ['B', [-1, 2, 4, 4, 4, 2], [0, 1, 3, 3, 3, 1], [2, 1, 5], 'barre major'],
  ['Bb', [-1, 1, 3, 3, 3, 1], [0, 1, 3, 3, 3, 1], [1, 1, 5], 'barre major'],
  ['Bm', [-1, 2, 4, 4, 3, 2], [0, 1, 3, 4, 2, 1], [2, 1, 5], 'barre minor'],
  ['F#m', [2, 4, 4, 2, 2, 2], [1, 3, 4, 1, 1, 1], [2, 0, 5], 'barre minor'],
  ['Cm', [-1, 3, 5, 5, 4, 3], [0, 1, 3, 4, 2, 1], [3, 1, 5], 'barre minor'],
  ['Gm', [3, 5, 5, 3, 3, 3], [1, 3, 4, 1, 1, 1], [3, 0, 5], 'barre minor'],
];

function build([name, frets, fingers, barre, tags]) {
  const midis = frets
    .map((f, s) => (f < 0 ? null : STANDARD_TUNING[s] + f))
    .filter((m) => m !== null);
  const pcs = [...new Set(midis.map(pitchClass))].sort((a, b) => a - b);
  const rootName = name.match(/^[A-G][#b]?/)[0];
  return {
    name,
    frets,
    fingers,
    barre: barre ? { fret: barre[0], from: barre[1], to: barre[2] } : null,
    tags: tags.split(' '),
    midis,
    pcs,
    root: parsePitchClass(rootName),
  };
}

export const CHORDS = RAW.map(build);
export const CHORD_BY_NAME = Object.fromEntries(CHORDS.map((c) => [c.name, c]));

export const CHORD_PRESETS = {
  beginner: { label: 'beginner', chords: ['E', 'A', 'D', 'Em', 'Am'] },
  campfire: { label: 'campfire', chords: ['G', 'C', 'D', 'Em', 'Am'] },
  majors: { label: 'open majors', chords: ['C', 'D', 'E', 'G', 'A'] },
  minors: { label: 'open minors', chords: ['Am', 'Em', 'Dm'] },
  sevenths: { label: 'sevenths', chords: ['E7', 'A7', 'D7', 'G7', 'C7', 'B7'] },
  allOpen: {
    label: 'all open',
    chords: CHORDS.filter((c) => c.tags.includes('open')).map((c) => c.name),
  },
  barre: { label: 'barre', chords: ['F', 'B', 'Bb', 'Bm', 'F#m', 'Cm', 'Gm'] },
};

// ---- Generic chord templates used to label "what did we hear?" ----------
const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  5: [0, 7],
};
const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const GENERIC_TEMPLATES = [];
for (let root = 0; root < 12; root++) {
  for (const [q, ivs] of Object.entries(QUALITIES)) {
    GENERIC_TEMPLATES.push({
      name: ROOT_NAMES[root] + q,
      pcs: ivs.map((i) => (root + i) % 12).sort((a, b) => a - b),
      root,
    });
  }
}

export const samePcs = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
