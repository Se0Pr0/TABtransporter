import type { FingeringWarning, NoteEvent, ScoreLayoutPage, ScoreModel, TransposeOptions } from "./types";
import { getInstrumentPreset } from "./instruments";
import { midiToNoteName } from "./pitch";
import { buildLayoutRewritePlacements } from "./layoutRewrite";

export interface ExportDocumentOptions {
  score: ScoreModel;
  sourceName: string;
  instrumentName: string;
  transposeOptions: TransposeOptions;
  warnings: FingeringWarning[];
}

export function buildExportHtml(options: ExportDocumentOptions): string {
  const { score, sourceName, instrumentName, transposeOptions, warnings } = options;
  const layoutPages = score.layoutPages?.filter((page) => page.width > 0 && page.height > 0 && page.dataUrl) ?? [];
  const layoutNotes = score.tracks.flatMap((track) => track.notes).filter((note) => note.originalSource);

  if (layoutPages.length && layoutNotes.length) {
    return buildLayoutPreservingHtml(options, layoutPages, layoutNotes);
  }

  throw new Error("원본과 같은 형식으로 저장할 원본 페이지 레이아웃 데이터가 없습니다.");

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

const STAFF_PX_PER_SEMITONE = 3.8;
const TAB_OFFSET_PX = 76;

function buildLayoutPreservingHtml(
  options: ExportDocumentOptions,
  pages: ScoreLayoutPage[],
  notes: NoteEvent[]
): string {
  const { score, sourceName, instrumentName, transposeOptions, warnings } = options;
  const pageHtml = pages
    .map((page) => {
      const pageNotes = notes.filter((note) => note.originalSource?.page === page.page);
      const placements = buildLayoutRewritePlacements(pageNotes, page);
      return `
        <section class="source-page" style="aspect-ratio:${page.width}/${page.height}">
          <img src="${page.dataUrl}" alt="${page.page}페이지 변환 악보" />
          <div class="rewrite-layer">
            ${placements.map(renderLayoutRewritePlacement).join("")}
          </div>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(score.title)} 변환 결과</title>
    <style>
      @page {
        size: A4;
        margin: 0;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #ffffff;
        color: #111111;
        font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif;
      }

      .source-page {
        position: relative;
        width: 100vw;
        max-width: 210mm;
        margin: 0 auto;
        overflow: hidden;
        page-break-after: always;
        background: #ffffff;
      }

      .source-page:last-of-type {
        page-break-after: auto;
      }

      .source-page img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: fill;
      }

      .rewrite-layer {
        position: absolute;
        inset: 0;
      }

      .note-mask,
      .tab-mask,
      .rewrite-note,
      .rewrite-tab {
        position: absolute;
        transform: translate(-50%, -50%);
      }

      .note-mask {
        background: #ffffff;
      }

      .rewrite-note {
        border-radius: 50%;
        background: #111111;
        transform: translate(-50%, -50%) rotate(-18deg);
      }

      .rewrite-note::after {
        content: "";
        position: absolute;
        right: -1px;
        bottom: 4px;
        width: 1px;
        height: var(--stem-height, 28px);
        background: #111111;
        transform: rotate(18deg);
        transform-origin: bottom center;
      }

      .tab-mask {
        background: #ffffff;
      }

      .rewrite-tab {
        min-width: 14px;
        min-height: 12px;
        display: inline-grid;
        place-items: center;
        background: #ffffff;
        color: #111111;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
      }

      .export-meta {
        display: none;
      }

      .warnings {
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="export-meta">
      <span>원본: ${escapeHtml(sourceName)}</span>
      <span>악기: ${escapeHtml(instrumentName)}</span>
      <span>조옮김: ${formatSemitones(transposeOptions.semitones)}</span>
      <span>카포: ${transposeOptions.capo}</span>
    </div>
    ${pageHtml}
    ${
      warnings.length
        ? `<section class="warnings"><strong>확인 필요</strong><ul>${warnings
            .map((warning) => `<li>${escapeHtml(warning.message)}</li>`)
            .join("")}</ul></section>`
        : ""
    }
  </body>
</html>`;
}

function renderLayoutRewritePlacement(placement: ReturnType<typeof buildLayoutRewritePlacements>[number]): string {
  return `
    <span class="note-mask" style="left:${placement.noteLeftPercent}%;top:${placement.sourceTopPercent}%;width:${placement.noteMaskWidth}px;height:${placement.noteMaskHeight}px"></span>
    <span class="rewrite-note" style="left:${placement.noteLeftPercent}%;top:${placement.rewrittenTopPercent}%;width:${placement.noteWidth}px;height:${placement.noteHeight}px;--stem-height:${placement.stemHeight}px" title="${escapeHtml(placement.noteTitle)}"></span>
    ${
      placement.tabValue && placement.tabLeftPercent !== undefined && placement.tabTopPercent !== undefined
        ? `<span class="tab-mask" style="left:${placement.tabLeftPercent}%;top:${placement.tabTopPercent}%;width:${placement.tabMaskWidth}px;height:${placement.tabMaskHeight}px"></span>
           <span class="rewrite-tab" style="left:${placement.tabLeftPercent}%;top:${placement.tabTopPercent}%;font-size:${placement.tabFontSize}px" title="${escapeHtml(
             placement.tabTitle ?? ""
           )}">${escapeHtml(placement.tabValue)}</span>`
        : ""
    }
  `;
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
