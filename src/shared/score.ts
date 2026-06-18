import type { ScoreModel } from "./types";

export function createDemoScore(instrumentPresetId = "guitar-standard-6"): ScoreModel {
  return {
    id: "demo-score",
    title: "변환 미리보기",
    tempo: 92,
    timeSignature: [4, 4],
    tracks: [
      {
        id: "track-1",
        name: "기본 TAB",
        instrumentPresetId,
        notes: [
          { id: "n1", measure: 1, beat: 1, durationBeats: 1, midi: 52, source: "demo", confidence: 0.7 },
          { id: "n2", measure: 1, beat: 2, durationBeats: 1, midi: 55, source: "demo", confidence: 0.7 },
          { id: "n3", measure: 1, beat: 3, durationBeats: 1, midi: 59, source: "demo", confidence: 0.7 },
          { id: "n4", measure: 1, beat: 4, durationBeats: 1, midi: 64, source: "demo", confidence: 0.7 },
          { id: "n5", measure: 2, beat: 1, durationBeats: 1, midi: 67, source: "demo", confidence: 0.7 },
          { id: "n6", measure: 2, beat: 2, durationBeats: 1, midi: 64, source: "demo", confidence: 0.7 },
          { id: "n7", measure: 2, beat: 3, durationBeats: 1, midi: 59, source: "demo", confidence: 0.7 },
          { id: "n8", measure: 2, beat: 4, durationBeats: 1, midi: 55, source: "demo", confidence: 0.7 }
        ]
      }
    ]
  };
}

export function cloneScore(score: ScoreModel): ScoreModel {
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      notes: track.notes.map((note) => ({
        ...note,
        tab: note.tab ? { ...note.tab } : undefined
      }))
    }))
  };
}
