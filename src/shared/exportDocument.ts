import type { FingeringWarning, ScoreModel, TransposeOptions } from "./types";
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
  const rows = score.tracks
    .flatMap((track) =>
      track.notes.map((note) => {
        const tab = note.tab ? `${note.tab.stringNumber}번줄 ${note.tab.fret}프렛` : "운지 없음";
        return `
          <tr>
            <td>${escapeHtml(String(note.measure))}</td>
            <td>${escapeHtml(String(note.beat))}</td>
            <td>${escapeHtml(midiToNoteName(note.midi))}</td>
            <td>${escapeHtml(tab)}</td>
          </tr>
        `;
      })
    )
    .join("");

  const scoreSystems = score.tracks
    .map((track) => {
      const preset = getInstrumentPreset(track.instrumentPresetId);
      const measures = new Map<number, typeof track.notes>();
      for (const note of track.notes) {
        const notes = measures.get(note.measure) ?? [];
        notes.push(note);
        measures.set(note.measure, notes);
      }

      return Array.from(measures.entries())
        .map(
          ([measure, notes]) => {
            const strings = Array.from({ length: preset.stringCount }, (_, index) => index + 1);
            const measureBeats = Math.max(4, ...notes.map((note) => note.beat + note.durationBeats - 1));
            return `
            <section class="score-system">
              <h3>${measure}마디</h3>
              <div class="notation-row">
                <span>일반 악보</span>
                <div class="staff-lines">
                  ${notes
                    .map(
                      (note, index) => `
                        <b class="note-head" style="left:${xForBeat(note.beat, measureBeats)};top:${staffTopFor(note.midi)};z-index:${index + 1}">
                          ${escapeHtml(midiToNoteName(note.midi))}
                        </b>
                      `
                    )
                    .join("")}
                </div>
              </div>
              <div class="notation-row">
                <span>TAB</span>
                <div class="tab-lines">
                  ${strings
                    .map(
                      (stringNumber, index) => `
                        <i class="tab-line" data-string="${stringNumber}" style="top:${lineTopFor(index, strings.length)}"></i>
                      `
                    )
                    .join("")}
                  ${notes
                    .map(
                      (note, index) => `
                        <b class="tab-fret" style="left:${xForBeat(note.beat, measureBeats)};top:${tabTopFor(note.tab?.stringNumber, strings.length)};z-index:${index + 1}">
                          ${escapeHtml(note.tab ? String(note.tab.fret) : "?")}
                        </b>
                      `
                    )
                    .join("")}
                </div>
              </div>
            </section>
          `;
          }
        )
        .join("");
    })
    .join("");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(score.title)} 변환 결과</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        color: #24211d;
        background: #fffdf8;
        font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif;
      }
      header {
        border-bottom: 2px solid #2f5f6d;
        padding-bottom: 16px;
        margin-bottom: 22px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 18px;
        color: #5d574f;
        font-size: 13px;
      }
      .score-system {
        break-inside: avoid;
        border: 1px solid #d8d1c6;
        border-radius: 8px;
        padding: 14px;
        margin: 0 0 14px;
      }
      .score-system h3 {
        margin: 0 0 10px;
        font-size: 15px;
        color: #2f5f6d;
      }
      .notation-row {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 10px;
        align-items: center;
        margin-top: 8px;
      }
      .notation-row > span {
        color: #5d574f;
        font-size: 12px;
        font-weight: 700;
      }
      .staff-lines,
      .tab-lines {
        position: relative;
        min-height: 92px;
        border-left: 2px solid #4b453e;
        border-right: 2px solid #4b453e;
        background:
          linear-gradient(#4b453e, #4b453e) 0 20% / 100% 1px no-repeat,
          linear-gradient(#4b453e, #4b453e) 0 35% / 100% 1px no-repeat,
          linear-gradient(#4b453e, #4b453e) 0 50% / 100% 1px no-repeat,
          linear-gradient(#4b453e, #4b453e) 0 65% / 100% 1px no-repeat,
          linear-gradient(#4b453e, #4b453e) 0 80% / 100% 1px no-repeat;
      }
      .tab-lines {
        min-height: 112px;
        background: transparent;
      }
      .note-head,
      .tab-fret {
        position: absolute;
        transform: translate(-50%, -50%);
        display: inline-grid;
        place-items: center;
        min-width: 32px;
        min-height: 22px;
        padding: 0 5px;
        border-radius: 999px;
        background: #fffdf9;
        border: 1px solid #4b453e;
        color: #2f2d2a;
        font-size: 12px;
        font-style: normal;
      }
      .tab-line {
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: #5c554d;
        font-style: normal;
      }
      .tab-line::before {
        content: attr(data-string);
        position: absolute;
        left: -18px;
        top: -7px;
        color: #746e64;
        font-size: 11px;
      }
      .tab-fret {
        min-width: 24px;
        min-height: 20px;
        border-color: #2f5f6d;
        color: #244955;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 22px;
        font-size: 13px;
      }
      th,
      td {
        border: 1px solid #ded6cb;
        padding: 8px;
        text-align: left;
      }
      th {
        background: #eee7dd;
      }
      .warnings {
        margin-top: 18px;
        color: #8a4a1b;
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
      ${scoreSystems || '<p class="warnings">변환된 음표가 없습니다.</p>'}
      <table>
        <thead>
          <tr>
            <th>마디</th>
            <th>박</th>
            <th>음</th>
            <th>추천 운지</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
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
