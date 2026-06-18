import type { FingeringWarning, NoteEvent, ScoreModel, TransposeOptions } from "./types";
import { getInstrumentPreset } from "./instruments";
import { midiToNoteName } from "./pitch";

export interface ExportDocumentOptions {
  score: ScoreModel;
  sourceName: string;
  instrumentName: string;
  transposeOptions: TransposeOptions;
  warnings: FingeringWarning[];
}

export function buildExportHtml(options: ExportDocumentOptions): string {
  const { score, sourceName, instrumentName, transposeOptions, warnings } = options;
  const systems = score.tracks.map((track) => {
    const preset = getInstrumentPreset(track.instrumentPresetId);
    const measures = groupByMeasure(track.notes);

    return Array.from(measures.entries())
      .map(([measure, notes]) => {
        const strings = Array.from({ length: preset.stringCount }, (_, index) => index + 1);
        const measureBeats = Math.max(4, ...notes.map((note) => note.beat + note.durationBeats - 1));
        const sorted = [...notes].sort((a, b) => a.beat - b.beat || a.midi - b.midi);

        return `
          <section class="score-system">
            <div class="measure-number">${measure}</div>
            <div class="notation-row">
              <span>일반 악보</span>
              <div class="staff-lines">
                ${sorted.map((note) => renderStaffNote(note, measureBeats)).join("")}
              </div>
            </div>
            <div class="notation-row">
              <span>TAB</span>
              <div class="tab-lines">
                ${strings.map((stringNumber, index) => renderTabLine(stringNumber, index, strings.length)).join("")}
                ${sorted.map((note) => renderTabNote(note, measureBeats, strings.length)).join("")}
              </div>
            </div>
          </section>
        `;
      })
      .join("");
  });

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(score.title)} 변환 결과</title>
    <style>
      @page {
        size: A4;
        margin: 14mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: #211f1c;
        background: #ffffff;
        font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif;
      }

      header {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 16px;
        align-items: end;
        border-bottom: 1.5px solid #211f1c;
        padding-bottom: 12px;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 34px;
        font-weight: 500;
      }

      .meta {
        color: #55504a;
        font-size: 12px;
        line-height: 1.45;
        text-align: right;
      }

      .score-system {
        position: relative;
        break-inside: avoid;
        padding: 10px 0 14px 36px;
        margin: 0 0 14px;
      }

      .measure-number {
        position: absolute;
        left: 0;
        top: 10px;
        color: #5f5850;
        font-size: 12px;
      }

      .notation-row {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        margin: 7px 0;
      }

      .notation-row > span {
        color: #332f2a;
        font-size: 12px;
        font-weight: 700;
      }

      .staff-lines,
      .tab-lines {
        position: relative;
        min-height: 92px;
        border-left: 2px solid #1f1d1a;
        border-right: 2px solid #1f1d1a;
        background:
          linear-gradient(#1f1d1a, #1f1d1a) 0 20% / 100% 1px no-repeat,
          linear-gradient(#1f1d1a, #1f1d1a) 0 35% / 100% 1px no-repeat,
          linear-gradient(#1f1d1a, #1f1d1a) 0 50% / 100% 1px no-repeat,
          linear-gradient(#1f1d1a, #1f1d1a) 0 65% / 100% 1px no-repeat,
          linear-gradient(#1f1d1a, #1f1d1a) 0 80% / 100% 1px no-repeat;
      }

      .tab-lines {
        min-height: 112px;
        background: transparent;
      }

      .tab-line {
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: #1f1d1a;
      }

      .tab-line::before {
        content: attr(data-string);
        position: absolute;
        left: -18px;
        top: -7px;
        color: #5f5850;
        font-size: 11px;
      }

      .note-head {
        position: absolute;
        transform: translate(-50%, -50%) rotate(-18deg);
        width: 15px;
        height: 11px;
        border-radius: 50%;
        background: #1f1d1a;
      }

      .note-head::after {
        content: "";
        position: absolute;
        right: -2px;
        bottom: 5px;
        width: 1.5px;
        height: 34px;
        background: #1f1d1a;
        transform: rotate(18deg);
        transform-origin: bottom center;
      }

      .tab-fret {
        position: absolute;
        transform: translate(-50%, -50%);
        min-width: 22px;
        min-height: 18px;
        display: inline-grid;
        place-items: center;
        padding: 0 4px;
        background: #ffffff;
        color: #211f1c;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
      }

      .warnings {
        break-inside: avoid;
        margin-top: 18px;
        padding: 10px 12px;
        border-top: 1px solid #c9c1b6;
        color: #704018;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(score.title)} 변환 결과</h1>
      <div class="meta">
        <div>원본: ${escapeHtml(sourceName)}</div>
        <div>악기: ${escapeHtml(instrumentName)}</div>
        <div>조옮김: ${formatSemitones(transposeOptions.semitones)}</div>
        <div>카포: ${transposeOptions.capo}</div>
      </div>
    </header>
    <main>
      ${systems.join("") || '<p class="warnings">변환된 음표가 없습니다.</p>'}
      ${
        warnings.length
          ? `<section class="warnings"><strong>확인 필요</strong><ul>${warnings
              .map((warning) => `<li>${escapeHtml(warning.message)}</li>`)
              .join("")}</ul></section>`
          : ""
      }
    </main>
  </body>
</html>`;
}

function groupByMeasure(notes: NoteEvent[]): Map<number, NoteEvent[]> {
  const measures = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const items = measures.get(note.measure) ?? [];
    items.push(note);
    measures.set(note.measure, items);
  }
  return measures;
}

function renderStaffNote(note: NoteEvent, measureBeats: number): string {
  return `<i class="note-head" style="left:${xForBeat(note.beat, measureBeats)};top:${staffTopFor(
    note.midi
  )}" title="${escapeHtml(midiToNoteName(note.midi))}"></i>`;
}

function renderTabLine(stringNumber: number, index: number, total: number): string {
  return `<i class="tab-line" data-string="${stringNumber}" style="top:${lineTopFor(index, total)}"></i>`;
}

function renderTabNote(note: NoteEvent, measureBeats: number, stringCount: number): string {
  const title = note.tab ? `추천 운지: ${note.tab.stringNumber}번줄 ${note.tab.fret}프렛` : "추천 운지 없음";
  return `<b class="tab-fret" style="left:${xForBeat(note.beat, measureBeats)};top:${tabTopFor(
    note.tab?.stringNumber,
    stringCount
  )}" title="${escapeHtml(title)}">${escapeHtml(note.tab ? String(note.tab.fret) : "?")}</b>`;
}

function formatSemitones(semitones: number): string {
  if (semitones === 0) {
    return "원본";
  }
  return semitones > 0 ? `반음 +${semitones}` : `반음 ${semitones}`;
}

function xForBeat(beat: number, measureBeats: number): string {
  return `${Math.max(7, Math.min(93, (beat / (measureBeats + 1)) * 100))}%`;
}

function staffTopFor(midi: number): string {
  return `${Math.max(14, Math.min(86, 62 - (midi - 60) * 4))}%`;
}

function lineTopFor(index: number, total: number): string {
  if (total <= 1) {
    return "50%";
  }
  return `${(index / (total - 1)) * 100}%`;
}

function tabTopFor(stringNumber: number | undefined, stringCount: number): string {
  if (!stringNumber || stringCount <= 1) {
    return "50%";
  }
  return `${((stringNumber - 1) / (stringCount - 1)) * 100}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
