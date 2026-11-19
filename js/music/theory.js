// Basic music theory helpers shared by the browser app and the Node tests.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Standard tuning, low E (string 6) to high e (string 1), as MIDI numbers. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / 440);
export const pitchClass = (midi) => ((Math.round(midi) % 12) + 12) % 12;

export function noteName(midi, { flats = false, octave = false } = {}) {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  const m = Math.round(midi);
  const name = names[((m % 12) + 12) % 12];
  return octave ? `${name}${Math.floor(m / 12) - 1}` : name;
}

/** Parse "C#", "Db", "A" etc. into a pitch class (0-11). */
export function parsePitchClass(name) {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0].toUpperCase()];
  let pc = base;
  for (const ch of name.slice(1)) {
    if (ch === '#' || ch === '♯') pc++;
    else if (ch === 'b' || ch === '♭') pc--;
  }
  return ((pc % 12) + 12) % 12;
}

/** Pretty-print accidentals with proper music glyphs. */
export const prettyAccidentals = (s) => s.replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭');

/** MIDI note produced by a string (0 = low E) at a given fret. */
export const fretToMidi = (string, fret, tuning = STANDARD_TUNING) => tuning[string] + fret;

/** All [string, fret] positions where a MIDI note can be played within maxFret. */
export function positionsForMidi(midi, maxFret = 15, tuning = STANDARD_TUNING) {
  const out = [];
  for (let s = 0; s < tuning.length; s++) {
    const fret = midi - tuning[s];
    if (fret >= 0 && fret <= maxFret) out.push([s, fret]);
  }
  return out;
}
