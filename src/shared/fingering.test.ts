import { describe, expect, it } from "vitest";
import { BASS_STANDARD_4, GUITAR_STANDARD_6 } from "./instruments";
import { generateFingeringCandidates, transposeAndRemap } from "./fingering";
import { midiToNoteName, noteNameToMidi } from "./pitch";
import type { ScoreModel } from "./types";

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
  it("transposes score notes and assigns tab positions", () => {
    const result = transposeAndRemap(createTestScore(), {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });

    expect(result.score.tracks[0].notes[0].midi).toBe(54);
    expect(result.score.tracks[0].notes.every((note) => note.tab)).toBe(true);
  });

  it("avoids assigning the same string to simultaneous notes", () => {
    const result = transposeAndRemap(createChordScore(), {
      semitones: 0,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });
    const strings = result.score.tracks[0].notes.map((note) => note.tab?.stringNumber);

    expect(new Set(strings).size).toBe(strings.length);
    expect(result.warnings).toHaveLength(0);
  });
});

function createTestScore(): ScoreModel {
  return {
    id: "test-score",
    title: "테스트 악보",
    tempo: 92,
    timeSignature: [4, 4],
    tracks: [
      {
        id: "track-1",
        name: "테스트 트랙",
        instrumentPresetId: GUITAR_STANDARD_6.id,
        notes: [
          { id: "n1", measure: 1, beat: 1, durationBeats: 1, midi: 52 },
          { id: "n2", measure: 1, beat: 2, durationBeats: 1, midi: 55 },
          { id: "n3", measure: 1, beat: 3, durationBeats: 1, midi: 59 },
          { id: "n4", measure: 1, beat: 4, durationBeats: 1, midi: 64 }
        ]
      }
    ]
  };
}

function createChordScore(): ScoreModel {
  return {
    id: "chord-score",
    title: "화음 테스트",
    tempo: 92,
    timeSignature: [4, 4],
    tracks: [
      {
        id: "track-1",
        name: "테스트 트랙",
        instrumentPresetId: GUITAR_STANDARD_6.id,
        notes: [
          { id: "c1", measure: 1, beat: 1, durationBeats: 1, midi: 64 },
          { id: "c2", measure: 1, beat: 1, durationBeats: 1, midi: 64 }
        ]
      }
    ]
  };
}
