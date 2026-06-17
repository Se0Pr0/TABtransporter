const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const NOTE_TO_PC: Record<string, number> = {
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

export function midiToNoteName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new Error(`MIDI note out of range: ${midi}`);
  }
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES_SHARP[pc]}${octave}`;
}

export function noteNameToMidi(noteName: string): number {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(noteName.trim());
  if (!match) {
    throw new Error(`Invalid note name: ${noteName}`);
  }
  const pitchClass = NOTE_TO_PC[match[1]];
  if (pitchClass === undefined) {
    throw new Error(`Invalid pitch class: ${match[1]}`);
  }
  const octave = Number(match[2]);
  const midi = (octave + 1) * 12 + pitchClass;
  if (midi < 0 || midi > 127) {
    throw new Error(`MIDI note out of range: ${noteName}`);
  }
  return midi;
}

export function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, midi));
}
