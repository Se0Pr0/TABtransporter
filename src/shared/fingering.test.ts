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

  it("preserves original source coordinates after transpose", () => {
    const result = transposeAndRemap(createTestScore(), {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });

    expect(result.score.tracks[0].notes[0].originalSource).toEqual({
      page: 1,
      x: 120,
      y: 240,
      width: 10,
      height: 8,
      staff: 1
    });
  });

  it("preserves layout pages after transpose", () => {
    const result = transposeAndRemap(createTestScore(), {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });

    expect(result.score.layoutPages).toEqual([{ page: 1, width: 1819, height: 2573, dataUrl: "data:image/png;base64,test" }]);
  });

  it("transposes chord symbols with the notes", () => {
    const result = transposeAndRemap(createTestScore(), {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    });

    expect(result.score.tracks[0].chords?.[0]).toMatchObject({
      text: "D#m7/F#",
      originalText: "C#m7/E"
    });
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
    layoutPages: [{ page: 1, width: 1819, height: 2573, dataUrl: "data:image/png;base64,test" }],
    tracks: [
      {
        id: "track-1",
        name: "테스트 트랙",
        instrumentPresetId: GUITAR_STANDARD_6.id,
        chords: [{ id: "ch1", measure: 1, beat: 1, text: "C#m7/E" }],
        notes: [
          {
            id: "n1",
            measure: 1,
            beat: 1,
            durationBeats: 1,
            midi: 52,
            originalSource: { page: 1, x: 120, y: 240, width: 10, height: 8, staff: 1 }
          },
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
