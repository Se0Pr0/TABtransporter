import type { InstrumentPreset } from "./types";

export const GUITAR_STANDARD_6: InstrumentPreset = {
  id: "guitar-standard-6",
  name: "6현 기타 표준 튜닝",
  type: "guitar",
  stringCount: 6,
  fretCount: 22,
  defaultCapo: 0,
  strings: [
    { stringNumber: 6, label: "E2", openMidi: 40 },
    { stringNumber: 5, label: "A2", openMidi: 45 },
    { stringNumber: 4, label: "D3", openMidi: 50 },
    { stringNumber: 3, label: "G3", openMidi: 55 },
    { stringNumber: 2, label: "B3", openMidi: 59 },
    { stringNumber: 1, label: "E4", openMidi: 64 }
  ]
};

export const BASS_STANDARD_4: InstrumentPreset = {
  id: "bass-standard-4",
  name: "4현 베이스 표준 튜닝",
  type: "bass",
  stringCount: 4,
  fretCount: 24,
  defaultCapo: 0,
  strings: [
    { stringNumber: 4, label: "E1", openMidi: 28 },
    { stringNumber: 3, label: "A1", openMidi: 33 },
    { stringNumber: 2, label: "D2", openMidi: 38 },
    { stringNumber: 1, label: "G2", openMidi: 43 }
  ]
};

export const INSTRUMENT_PRESETS = [GUITAR_STANDARD_6, BASS_STANDARD_4] as const;

export function getInstrumentPreset(id: string): InstrumentPreset {
  const preset = INSTRUMENT_PRESETS.find((item) => item.id === id);
  if (!preset) {
    throw new Error(`Unknown instrument preset: ${id}`);
  }
  return preset;
}
