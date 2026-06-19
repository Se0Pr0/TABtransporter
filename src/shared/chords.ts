const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

const PITCH_CLASS: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};

export function transposeChordText(text: string, semitones: number): string {
  const trimmed = text.trim();
  if (!trimmed || semitones === 0) {
    return text;
  }

  const match = /^([A-G])([#b]?)(.*)$/.exec(trimmed);
  if (!match) {
    return text;
  }

  const [, step, accidental, suffix] = match;
  const preferFlats = accidental === "b" && !trimmed.includes("#");
  const transposedRoot = transposePitchClass(`${step}${accidental}`, semitones, preferFlats);
  if (!transposedRoot) {
    return text;
  }

  const transposedSuffix = suffix.replace(/\/([A-G])([#b]?)/g, (_value, bassStep: string, bassAccidental: string) => {
    const bass = transposePitchClass(`${bassStep}${bassAccidental}`, semitones, preferFlats);
    return bass ? `/${bass}` : _value;
  });

  return `${transposedRoot}${transposedSuffix}`;
}

function transposePitchClass(note: string, semitones: number, preferFlats: boolean): string | undefined {
  const pitchClass = PITCH_CLASS[note];
  if (pitchClass === undefined) {
    return undefined;
  }
  const next = ((pitchClass + semitones) % 12 + 12) % 12;
  return preferFlats ? FLAT_NAMES[next] : SHARP_NAMES[next];
}
