export type InstrumentType = "guitar" | "bass";

export type SourceKind = "pdf" | "image";

export type OutputFormat = "pdf" | "png";

export interface InstrumentString {
  stringNumber: number;
  label: string;
  openMidi: number;
}

export interface InstrumentPreset {
  id: string;
  name: string;
  type: InstrumentType;
  stringCount: number;
  fretCount: number;
  defaultCapo: number;
  strings: InstrumentString[];
}

export interface TabPosition {
  stringNumber: number;
  fret: number;
  physicalFret: number;
}

export interface NoteEvent {
  id: string;
  measure: number;
  beat: number;
  durationBeats: number;
  midi: number;
  velocity?: number;
  tab?: TabPosition;
  source?: "omr" | "manual" | "demo";
  confidence?: number;
}

export interface ScoreTrack {
  id: string;
  name: string;
  instrumentPresetId: string;
  notes: NoteEvent[];
}

export interface ScoreModel {
  id: string;
  title: string;
  tempo: number;
  timeSignature: [number, number];
  tracks: ScoreTrack[];
}

export interface FingeringCandidate {
  stringNumber: number;
  fret: number;
  physicalFret: number;
  midi: number;
  score: number;
  reasons: string[];
}

export interface FingeringWarning {
  noteId: string;
  measure: number;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface RemapResult {
  score: ScoreModel;
  warnings: FingeringWarning[];
}

export interface TransposeOptions {
  semitones: number;
  capo: number;
  instrumentPresetId: string;
}

export interface OpenedScoreFile {
  path: string;
  name: string;
  kind: SourceKind;
  dataUrl: string;
}

export interface ConversionResult {
  status: "converted" | "needs_converter" | "failed";
  sourcePath: string;
  message: string;
  musicXmlPath?: string;
  logPath?: string;
  logExcerpt?: string[];
  score?: ScoreModel;
  diagnostics: string[];
}

export interface LogInfo {
  directory: string;
  appLogFile: string;
}

export interface AudiverisStatus {
  installed: boolean;
  path?: string;
  version?: string;
  releaseUrl?: string;
  message: string;
}

export interface ExportRequest {
  format: OutputFormat;
  defaultFileName: string;
  html: string;
}

export interface ExportResult {
  status: "saved" | "cancelled" | "failed";
  path?: string;
  message: string;
}
