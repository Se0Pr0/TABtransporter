import type { ScoreModel } from "./types";

export function createEmptyScore(): ScoreModel {
  return {
    id: "empty-score",
    title: "악보 변환",
    tempo: 92,
    timeSignature: [4, 4],
    tracks: [
      {
        id: "empty-track",
        name: "빈 TAB",
        instrumentPresetId: "guitar-standard-6",
        notes: []
      }
    ]
  };
}

export function cloneScore(score: ScoreModel): ScoreModel {
  return {
    ...score,
    layoutPages: score.layoutPages?.map((page) => ({ ...page })),
    tracks: score.tracks.map((track) => ({
      ...track,
      notes: track.notes.map((note) => ({
        ...note,
        tab: note.tab ? { ...note.tab } : undefined,
        originalTab: note.originalTab ? { ...note.originalTab } : undefined,
        originalSource: note.originalSource ? { ...note.originalSource } : undefined
      })),
      chords: track.chords?.map((chord) => ({
        ...chord,
        originalSource: chord.originalSource ? { ...chord.originalSource } : undefined
      }))
    }))
  };
}
