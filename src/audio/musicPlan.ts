/**
 * The music's score, as pure data: from the mood of the sea (how rough, how light, in harbour or not) it picks a
 * mode and a tempo, and writes the bars one at a time with a seeded random generator. The engine (`music.ts`)
 * only plays what is written here, so the choices can be tested without a sound card.
 */
export interface MusicMood {
  /** Sea state 0 (glassy) … 1 (storm). */
  sea: number;
  /** Daylight 0 (night) … 1 (day). */
  day: number;
  /** Moored in a harbour. */
  docked: boolean;
}

export type ModeName = 'lydian' | 'ionian' | 'dorian' | 'aeolian' | 'phrygian';

/** Semitone steps of each mode from its root. */
export const MODES: Readonly<Record<ModeName, readonly number[]>> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** The key the score stays in: D, with the bass an octave and a half below the pad. */
export const ROOT_MIDI = 50;

/** A bright mode for a fair day, a warm one in harbour, a modal dusk, a dark night, a tense storm. */
export function modeFor(m: MusicMood): ModeName {
  if (m.sea > 0.75) return 'phrygian';
  if (m.docked) return 'ionian';
  if (m.day < 0.25) return 'aeolian';
  if (m.day < 0.7) return 'dorian';
  return 'lydian';
}

/** Beats per minute: slow and wide at night, gentle by day, restless in a storm. */
export function tempoFor(m: MusicMood): number {
  const base = 50 + 22 * m.day + (m.docked ? -6 : 0);
  return Math.round(base + 34 * Math.max(0, m.sea - 0.3));
}

/** How densely the melody plays: sparse bells at night and in harbour, more on a bright, lively sea. */
export function densityFor(m: MusicMood): number {
  return Math.min(1, Math.max(0.15, 0.25 + 0.35 * m.day + 0.4 * m.sea - (m.docked ? 0.15 : 0)));
}

export type Pluck = 'pluck' | 'bell';

export interface PlannedNote {
  /** Beat within the bar, 0 … 4, and length in beats. */
  beat: number;
  length: number;
  midi: number;
  kind: Pluck;
}

export interface Bar {
  mode: ModeName;
  tempo: number;
  /** MIDI notes of the pad chord and of the bass note. */
  chord: readonly number[];
  bass: number;
  notes: readonly PlannedNote[];
  /** A low drum on beat 1 (and 3 in a storm): the sea getting rough. */
  drums: readonly number[];
}

/** Scale degrees of the chords, in four-bar phrases: home, away and back. */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [0, 2, 3, 4],
  [0, 4, 5, 3],
];

const degreeMidi = (mode: ModeName, degree: number, octave = 0): number => {
  const steps = MODES[mode];
  const n = steps.length;
  const d = ((degree % n) + n) % n;
  const o = Math.floor(degree / n);
  return ROOT_MIDI + (steps[d] ?? 0) + 12 * (o + octave);
};

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A chord of three stacked thirds on a scale degree. */
const triad = (mode: ModeName, degree: number): number[] => [degreeMidi(mode, degree), degreeMidi(mode, degree + 2), degreeMidi(mode, degree + 4)];

/** Bar number `index` of the piece for a mood. `rng` is the score's own seeded generator (called in a fixed order). */
export function planBar(mood: MusicMood, index: number, rng: () => number): Bar {
  const mode = modeFor(mood);
  const phrase = PROGRESSIONS[Math.floor(index / 4) % PROGRESSIONS.length] ?? PROGRESSIONS[0]!;
  const degree = phrase[index % 4] ?? 0;
  const chord = triad(mode, degree).map((m) => m + 12);
  const bass = degreeMidi(mode, degree, -1);
  const density = densityFor(mood);
  const notes: PlannedNote[] = [];
  // Eighth notes: chord tones and neighbours of the mode, dropping most of them when the music is sparse.
  for (let step = 0; step < 8; step++) {
    if (rng() > density * (step % 2 === 0 ? 1.1 : 0.7)) continue;
    const pick = Math.floor(rng() * 5);
    const degreeUp = degree + [0, 2, 4, 7, 9][pick]!;
    const kind: Pluck = mood.day < 0.25 || mood.docked ? 'bell' : rng() < 0.2 ? 'bell' : 'pluck';
    notes.push({ beat: step / 2, length: kind === 'bell' ? 2 : 0.75, midi: degreeMidi(mode, degreeUp, 1), kind });
  }
  const drums = mood.sea > 0.55 ? (mood.sea > 0.8 ? [0, 1.5, 2] : [0, 2]) : [];
  return { mode, tempo: tempoFor(mood), chord, bass, notes, drums };
}
