# Monkeycord

A minimalist guitar speed trainer that listens through your microphone. It works like a typing test, but for chord changes.

| Mode | What you do | Score |
|---|---|---|
| **chords** | Strum the highlighted chord. The next one appears as soon as the app hears the right one. | Correct chords per minute (CPM), accuracy, slowest transitions. The first chord starts the clock and counts. Skips count towards the test length but not as correct, and lower accuracy (correct ÷ (correct + wrong strums + skips)). |
| **fretboard** | Find the prompted note (optionally on a specific string or fret range). | Reaction time in ms, per-note averages, fretboard heat map |
| **notes** | Play a scale run or sequence cleanly and fast. | Notes per minute (NPM), hesitation hot spots, string-crossing vs same-string speed |
| **sight-read** | Read notes on a treble staff and play them. | Notes per minute, slowest notes to read |
| **tuner** | Tune up. Detection works best on a tuned guitar. | |

Everything runs in the browser. Audio is analysed locally and never recorded or uploaded. There are no runtime dependencies and no build step.

## Run it

Requires Node 22 or newer (only for the dev server and tests).

```bash
npm start          # http://localhost:5173
```

Open the page and choose **use microphone**, or **try a simulated guitar** if you don't have one at hand.

> Browsers only allow the microphone on `https://` or `http://localhost`. To deploy, any static host with HTTPS works (GitHub Pages, Netlify, Cloudflare Pages). Upload the folder as is.

### Keys

| Key | Action |
|---|---|
| `tab` / `esc` | Restart the test |
| `space` | Skip the current chord or note |
| `` ` `` | Detector view: live chroma bars, match score, pitch and levels |
| `enter` | *(simulated guitar)* Play the current target |
| `x` | *(simulated guitar)* Play something wrong |
| `b` | *(simulated guitar)* Toggle the bot, which plays the test for you with human-ish timing and occasional mistakes |

### Settings (gear icon)

- **chord strictness** (strict / normal / lenient): how sure the detector must be. Lenient is more forgiving of sloppy chords, but may accept near-identical ones (C vs Cmaj7).
- **strum sensitivity**: onset detection threshold. Raise it if soft strums aren't noticed; lower it if noise triggers strums.
- **input gain**: boost for quiet microphones.

## How detection works

```
mic / simulated guitar ─► AudioWorklet (512-sample chunks) ─► Analyzer (one frame per hop, ~11 ms)
                                                               ├─ onset detector (spectral flux, adaptive threshold)
                                                               ├─ pitch detector (McLeod Pitch Method)
                                                               ▼
                                         ChordJudge (chords)    NoteTracker (single notes)
```

**Chords are verified, not recognised.** The app always knows which chord it expects, so it only has to answer "is this the G chord?". That is much easier and more reliable than open-ended chord recognition.

1. A strum is detected as a spectral-flux onset.
2. The audio *after* the strum (a ~170 ms window, so the previous chord's ringing is excluded) becomes a 12-bin **chromagram**. The steps are:
   - pick the spectral peaks, with parabolic interpolation;
   - estimate the guitar's global tuning offset;
   - down-weight 3rd, 5th, 6th and 7th harmonics, which land on non-chord notes;
   - apply power compression, so a chord's third (often on one string only) still counts.
3. The chord is accepted if all three hold:
   - its pitch classes reach a cosine-similarity threshold;
   - no other chord in the current pool fits better;
   - no generic chord template (any root: triads, 7ths, sus, power chords) fits clearly better.
4. If nothing matches within ~650 ms, the app shows what it heard ("heard Em"). It counts a wrong strum only if the strum was loud compared with your recent correct strums, so finger noise and open strings ringing while you change don't count against you.

Chord-change times are measured **strum onset to strum onset** (accurate to a few ms), not from when the app reacted (~200 ms later).

**Single notes** use the McLeod Pitch Method (normalised square difference function, computed via FFT autocorrelation). A note counts once its pitch has been stable for three hops (~30 ms). A fresh pluck (onset) lets the same note count again.

All DSP lives in [js/audio/](js/audio/) and has no DOM dependencies, so the browser and Node tests run the same code.

## Measured accuracy (synthesized guitar)

`npm run eval` renders strums and plucks with a Karplus-Strong guitar synthesizer ([js/audio/synth.js](js/audio/synth.js)) under three conditions: clean, room noise plus mains hum, and noisy plus a guitar tuned 15 cents flat with ±10 cent string detune. It then runs the real detection pipeline on that audio.

| Test | Result |
|---|---|
| Streaming chord test (4 presets × 3 conditions, 30 chords each, ~20% deliberate wrong strums) | **360/360 chords accepted, 0 false accepts, every wrong strum reported**, onset timing error ≈ 3–5 ms, decision ≈ 200 ms after the strum |
| Same, with quiet "finger noise" between every chord | All accepted, **no spurious wrong-strum reports** |
| Single chroma window, every chord vs every other chord in its pools (normal strictness) | 96–98% recall per window, 0.5–0.7% false accepts; misses are mostly near-identical pairs such as C/Cadd9 and Am/Am7. In practice several windows are checked per strum. |
| Single notes E2–A5 (60 notes × 3 conditions) | **180/180**, 0 octave errors, timing error ≈ 3–13 ms |

`npm test` locks these in as regression tests (7 tests). `npm run e2e` drives headless Chrome through every mode with the simulated guitar and its bot, and saves screenshots to `tests/e2e/screens/`.

## Known limitations

- **Not yet validated with a real guitar and microphone.** The thresholds were tuned on synthesized audio. Real instruments, cheap laptop mics, room echo and fret buzz will differ. The detector view (`` ` ``) and strictness settings exist to tune this. The next step is to record real strums and add them to the evaluation set.
- **Fretboard mode can't verify which string you used.** The same pitch on two strings sounds nearly identical. The exact octave is verified, so "on the A string" prompts are partly honour-system.
- **Near-identical chords** (C vs Cmaj7 vs Cadd9, Am vs Am7) are inherently hard to tell apart. Presets mostly avoid mixing them; "all open" does mix them.
- **Reaction times include the audio input latency** (typically 10–40 ms, more on Bluetooth). It is not compensated yet.
- **Sight-reading** checks pitches only; rhythm and timing aren't scored yet.
- Tested in Chrome. Firefox should work; Safari is untested.

## Ideas for next steps

1. Record a small set of real guitar clips (each chord, several strums, a couple of mics) and add them to `tests/` as ground truth.
2. Add a calibration flow: measure the noise floor and a reference strum on first use, and auto-set strum sensitivity and gain.
3. Add a song or progression mode (e.g. "G C D G", or paste chords from a song) instead of only random sequences.
4. Score rhythm in sight-reading against a metronome, with latency calibration.
5. Accounts and leaderboards (needs a small backend, e.g. Supabase or Firebase). PBs are currently stored in `localStorage` only.
6. A PWA or offline install, and MIDI input as an alternative to the microphone.
7. Before launching publicly, consider a name that doesn't lean on Monkeytype's.

## Project layout

```
index.html, css/style.css     UI shell and styling (dark and light themes)
js/main.js                    app shell: input selection, modes, keys, settings, bot, detector view
js/audio/                     engine (Web Audio), capture worklet, analyzer, FFT, chroma,
                              pitch (MPM), detectors (ChordJudge, NoteTracker), synth
js/music/                     theory helpers, chord library and presets
js/modes/                     chords, fretboard, npm, sight, tuner (+ shared note-mode base)
js/ui/                        SVG renderers (chord diagrams, staff, fretboard, charts), helpers
tests/                        detection evaluation + regression tests, e2e browser smoke test
tools/serve.js                zero-dependency static dev server
```
