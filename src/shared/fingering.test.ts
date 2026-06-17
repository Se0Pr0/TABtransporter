import { describe, expect, it } from "vitest";
import { BASS_STANDARD_4, GUITAR_STANDARD_6 } from "./instruments";
import { generateFingeringCandidates, transposeAndRemap } from "./fingering";
import { createDemoScore } from "./score";
import { midiToNoteName, noteNameToMidi } from "./pitch";

describe("pitch helpers", () => {
  it("round-trips standard note names", () => {
    expect(noteNameToMidi("E2")).toBe(40);
    expect(midiToNoteName(64)).toBe("E4");
  });
});

describe("fingering candidates", () => {
  it("finds multiple guitar positions for E4", () => {
    const candidates = generateFingeringCandidates(64, GUITAR_STANDARD_6, 0);
    expect(candidates.map((item) => `${item.stringNumber}:${item.fret}`)).toContain("1:0");
    expect(candidates.map((item) => `${item.stringNumber}:${item.fret}`)).toContain("2:5");
    expect(candidates.map((item) => `${item.stringNumber}:${item.fret}`)).toContain("3:9");
  });

  it("supports bass E1 as an open string", () => {
    const candidates = generateFingeringCandidates(28, BASS_STANDARD_4, 0);
    expect(candidates[0]).toMatchObject({ stringNumber: 4, fret: 0 });
  });

  it("rejects notes outside the instrument range", () => {
    const candidates = generateFingeringCandidates(20, BASS_STANDARD_4, 0);
    expect(candidates).toHaveLength(0);
  });

  it("accounts for capo in relative and physical frets", () => {
    const candidates = generateFingeringCandidates(66, GUITAR_STANDARD_6, 2);
    expect(candidates.map((item) => `${item.stringNumber}:${item.fret}:${item.physicalFret}`)).toContain("1:0:2");
  });
});

describe("transpose and remap", () => {
  it("transposes a demo score and assigns tab positions", () => {
    const result = transposeAndRemap(createDemoScore(), {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });

    expect(result.score.tracks[0].notes[0].midi).toBe(54);
    expect(result.score.tracks[0].notes.every((note) => note.tab)).toBe(true);
  });
});
