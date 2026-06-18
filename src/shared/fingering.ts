import { getInstrumentPreset } from "./instruments";
import { clampMidi } from "./pitch";
import { cloneScore } from "./score";
import type {
  FingeringCandidate,
  FingeringWarning,
  InstrumentPreset,
  NoteEvent,
  RemapResult,
  ScoreModel,
  TransposeOptions
} from "./types";

export function transposeScore(score: ScoreModel, semitones: number): ScoreModel {
  const next = cloneScore(score);
  for (const track of next.tracks) {
    for (const note of track.notes) {
      note.midi = clampMidi(note.midi + semitones);
      note.tab = undefined;
    }
  }
  return next;
}

export function generateFingeringCandidates(
  midi: number,
  preset: InstrumentPreset,
  capo: number,
  previous?: NoteEvent
): FingeringCandidate[] {
  const candidates: FingeringCandidate[] = [];

  for (const string of preset.strings) {
    const fret = midi - string.openMidi - capo;
    if (!Number.isInteger(fret) || fret < 0 || fret > preset.fretCount) {
      continue;
    }

    const reasons: string[] = [];
    let score = 100;

    const physicalFret = fret + capo;
    const preferredFret = preset.type === "bass" ? 5 : 4;
    score -= Math.abs(fret - preferredFret) * (preset.type === "bass" ? 2.5 : 2);

    if (fret === 0) {
      score += preset.type === "guitar" ? 8 : 3;
      reasons.push("개방현");
    }

    if (previous?.tab) {
      const stringDistance = Math.abs(previous.tab.stringNumber - string.stringNumber);
      const fretDistance = Math.abs(previous.tab.fret - fret);
      score -= stringDistance * 3;
      score -= fretDistance * 2;

      if (fretDistance > 7) {
        reasons.push("포지션 이동이 큼");
      }
      if (stringDistance > 2) {
        reasons.push("줄 이동이 큼");
      }
    }

    if (physicalFret > 12) {
      score -= (physicalFret - 12) * 3;
      reasons.push("높은 프렛");
    }

    candidates.push({
      stringNumber: string.stringNumber,
      fret,
      physicalFret,
      midi,
      score,
      reasons
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function recommendFingering(
  note: NoteEvent,
  preset: InstrumentPreset,
  capo: number,
  previous?: NoteEvent
): FingeringCandidate | undefined {
  return generateFingeringCandidates(note.midi, preset, capo, previous)[0];
}

export function transposeAndRemap(score: ScoreModel, options: TransposeOptions): RemapResult {
  const transposed = transposeScore(score, options.semitones);
  const preset = getInstrumentPreset(options.instrumentPresetId);
  const warnings: FingeringWarning[] = [];

  for (const track of transposed.tracks) {
    track.instrumentPresetId = preset.id;
    let previous: NoteEvent | undefined;

    for (const note of track.notes) {
      const candidate = recommendFingering(note, preset, options.capo, previous);

      if (!candidate) {
        warnings.push({
          noteId: note.id,
          measure: note.measure,
          severity: "error",
          message: `${preset.name}에서 MIDI ${note.midi} 음을 칠 수 있는 위치가 없습니다.`
        });
        previous = note;
        continue;
      }

      note.tab = {
        stringNumber: candidate.stringNumber,
        fret: candidate.fret,
        physicalFret: candidate.physicalFret
      };

      for (const reason of candidate.reasons) {
        if (reason === "포지션 이동이 큼" || reason === "높은 프렛") {
          warnings.push({
            noteId: note.id,
            measure: note.measure,
            severity: "warning",
            message: `${reason}: ${candidate.stringNumber}번줄 ${candidate.fret}프렛`
          });
        }
      }

      previous = note;
    }
  }

  return { score: transposed, warnings };
}
