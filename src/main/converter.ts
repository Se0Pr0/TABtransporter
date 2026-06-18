import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import type { ConversionResult, OmrProgress, ScoreLayoutPage } from "../shared/types";
import { noteNameToMidi } from "../shared/pitch";
import type { NoteEvent, ScoreModel, SourceBounds } from "../shared/types";
import { resolveAudiverisPath } from "./audiveris";
import { appendLogFile, createRunLogFile, readLogTail, tailLines, writeAppLog } from "./logger";

const AUDIVERIS_TIMEOUT_MS = 180_000;
const PDF_RENDER_DPI = 220;
const AUDIVERIS_STEPS = [
  "LOAD",
  "BINARY",
  "SCALE",
  "GRID",
  "HEADERS",
  "STEM_SEEDS",
  "BEAMS",
  "LEDGERS",
  "HEADS",
  "STEMS",
  "REDUCTION",
  "CUE_BEAMS",
  "TEXTS",
  "MEASURES",
  "CHORDS",
  "CURVES",
  "SYMBOLS",
  "LINKS",
  "RHYTHMS",
  "PAGE"
];

const AUDIVERIS_STEP_LABELS: Record<string, string> = {
  LOAD: "이미지 불러오기",
  BINARY: "흑백 변환",
  SCALE: "오선 간격 계산",
  GRID: "오선/마디 구조 찾기",
  HEADERS: "조표/박자표 찾기",
  STEM_SEEDS: "기둥 후보 찾기",
  BEAMS: "빔 인식",
  LEDGERS: "덧줄 인식",
  HEADS: "음표 머리 인식",
  STEMS: "음표 기둥 연결",
  REDUCTION: "인식 충돌 정리",
  CUE_BEAMS: "작은 음표 빔 확인",
  TEXTS: "문자/OCR 확인",
  MEASURES: "마디 분리",
  CHORDS: "화음 묶기",
  CURVES: "슬러/곡선 인식",
  SYMBOLS: "악상 기호 인식",
  LINKS: "기호 연결",
  RHYTHMS: "리듬/박자 검증",
  PAGE: "페이지 연결"
};

interface AudiverisRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logPath: string;
  timedOut: boolean;
}

interface AudiverisRunOptions {
  beforeOutputArgs?: string[];
  label?: string;
}

interface OmrFallbackScore {
  score: ScoreModel;
  omrPath: string;
}

interface AudiverisHeadCandidate {
  id: string;
  sheetNumber: number;
  staff: number;
  x: number;
  y: number;
  width: number;
  height: number;
  midi: number;
  confidence: number;
}

interface PdfInfo {
  pages: number;
  widthPt: number;
  heightPt: number;
}

interface SegmentedOmrResult {
  score: ScoreModel;
  musicXmlPath: string;
  logExcerpt?: string[];
}

type ProgressSink = (progress: OmrProgress) => void;
type ProgressReporter = (percent: number, phase: OmrProgress["phase"], message: string, detail?: string) => void;

export async function convertWithLocalOmr(sourcePath: string, onProgress?: ProgressSink): Promise<ConversionResult> {
  const audiverisPath = resolveAudiverisPath();
  const diagnostics: string[] = [];
  const progress = createProgressReporter(onProgress);
  progress(2, "preparing", "악보 분석을 준비하고 있습니다.", sourcePath);
  await writeAppLog("omr", "conversion requested", { sourcePath });

  if (!audiverisPath) {
    progress(100, "failed", "Audiveris 실행 파일을 찾지 못했습니다.");
    await writeAppLog("omr", "audiveris not found", { sourcePath });
    return {
      status: "needs_converter",
      sourcePath,
      message: "로컬 Audiveris 실행 파일을 찾지 못했습니다. 실제 PDF/이미지 악보 분석을 하려면 Audiveris 연결이 필요합니다.",
      diagnostics: [
        "AUDIVERIS_BIN 환경 변수를 Audiveris 실행 파일로 지정하거나 지원되는 로컬 변환기를 설치하세요.",
        "실제 악보 분석 결과가 없으므로 변환 결과를 만들지 않습니다."
      ]
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), "tabtransporter-omr-"));
  let logPath: string | undefined;

  try {
    progress(6, "preparing", "원본 파일을 안전한 임시 이름으로 복사하고 있습니다.");
    const audiverisInputPath = await prepareAudiverisInput(sourcePath, workDir);
    diagnostics.push(`사용 중인 Audiveris 실행 파일: ${audiverisPath}`);
    diagnostics.push(`임시 작업 폴더: ${workDir}`);
    diagnostics.push(`Audiveris 입력 복사본: ${audiverisInputPath}`);

    progress(10, "omr", "Audiveris 분석을 시작합니다.", basename(sourcePath));
    const run = await runAudiveris(audiverisPath, audiverisInputPath, workDir, sourcePath, progress);
    logPath = run.logPath;
    const importantLines = extractImportantAudiverisLines(`${run.stdout}\n${run.stderr}`);
    diagnostics.push(`Audiveris 로그 파일: ${run.logPath}`);

    if (run.exitCode !== 0) {
      const message = summarizeAudiverisFailure(run);
      progress(86, "omr", "전체 변환이 실패해 페이지별 변환을 다시 시도합니다.", run.logPath);
      const segmented = await trySegmentedPdfOmr(audiverisPath, audiverisInputPath, workDir, sourcePath, progress, diagnostics);
      if (segmented) {
        const noteCount = segmented.score.tracks.reduce((sum, track) => sum + track.notes.length, 0);
        await writeAppLog("omr", "segmented pdf conversion completed", {
          sourcePath,
          notes: noteCount,
          musicXmlPath: segmented.musicXmlPath
        });
        progress(100, "done", "페이지/구간별 재분석으로 악보 변환이 끝났습니다.", `${noteCount}개 음표`);
        return {
          status: "converted",
          sourcePath,
          musicXmlPath: segmented.musicXmlPath,
          logPath: run.logPath,
          logExcerpt: segmented.logExcerpt ?? (importantLines.length ? importantLines : tailLines(`${run.stdout}\n${run.stderr}`, 20)),
          message: "전체 변환은 실패했지만 페이지/구간별 재분석으로 MusicXML 변환을 완료했습니다.",
          score: segmented.score,
          diagnostics: [...diagnostics, ...importantLines]
        };
      }
      progress(88, "parsing", "MusicXML 내보내기는 실패했습니다. Audiveris 내부 인식 데이터로 복구를 시도합니다.", run.logPath);
      const fallback = await buildFallbackScoreFromOmr(workDir, basename(sourcePath), diagnostics);
      if (fallback) {
        const noteCount = fallback.score.tracks.reduce((sum, track) => sum + track.notes.length, 0);
        const fallbackMessage =
          "Audiveris가 정식 MusicXML을 만들지 못했습니다. 내부 OMR 데이터는 참고용일 뿐 완성 변환으로 사용하지 않습니다.";
        await writeAppLog("omr", "audiveris failed but fallback score was recovered", {
          sourcePath,
          exitCode: run.exitCode,
          logPath: run.logPath,
          omrPath: fallback.omrPath,
          notes: noteCount
        });
        progress(100, "failed", "정식 MusicXML 변환에 실패했습니다.", `${noteCount}개 내부 음표는 참고용으로만 기록했습니다.`);
        return {
          status: "failed",
          sourcePath,
          message: fallbackMessage,
          logPath: run.logPath,
          logExcerpt: importantLines.length ? importantLines : tailLines(`${run.stdout}\n${run.stderr}`, 20),
          diagnostics: [
            ...diagnostics,
            ...importantLines,
            `Audiveris 내부 OMR 파일: ${fallback.omrPath}`,
            `참고용 내부 OMR 음표 수: ${noteCount}`,
            "정식 MusicXML export가 아니므로 변환 결과로 사용하지 않습니다.",
            "원본 디자인 보존 변환은 정식 구조 악보 데이터가 확보된 경우에만 진행해야 합니다."
          ]
        };
      }
      progress(100, "failed", message, run.logPath);
      await writeAppLog("omr", "audiveris failed", { sourcePath, exitCode: run.exitCode, logPath: run.logPath, message });
      return {
        status: "failed",
        sourcePath,
        message,
        logPath: run.logPath,
        logExcerpt: importantLines.length ? importantLines : tailLines(`${run.stdout}\n${run.stderr}`, 20),
        diagnostics: [...diagnostics, ...importantLines]
      };
    }

    const output = await findMusicXml(workDir);

    if (!output) {
      progress(88, "parsing", "MusicXML 결과가 없어 내부 OMR 데이터로 복구를 시도합니다.", logPath);
      const fallback = await buildFallbackScoreFromOmr(workDir, basename(sourcePath), diagnostics);
      if (fallback) {
        const noteCount = fallback.score.tracks.reduce((sum, track) => sum + track.notes.length, 0);
        const fallbackMessage =
          "Audiveris MusicXML 결과가 없습니다. 내부 OMR 데이터는 참고용일 뿐 완성 변환으로 사용하지 않습니다.";
        await writeAppLog("omr", "musicxml output not found but fallback score was recovered", {
          sourcePath,
          logPath,
          omrPath: fallback.omrPath,
          notes: noteCount
        });
        progress(100, "failed", "정식 MusicXML 결과가 없습니다.", `${noteCount}개 내부 음표는 참고용으로만 기록했습니다.`);
        return {
          status: "failed",
          sourcePath,
          message: fallbackMessage,
          logPath,
          logExcerpt: logPath ? await readLogTail(logPath, 30).catch(() => undefined) : undefined,
          diagnostics: [
            ...diagnostics,
            `Audiveris 내부 OMR 파일: ${fallback.omrPath}`,
            `참고용 내부 OMR 음표 수: ${noteCount}`,
            "정식 MusicXML export가 아니므로 변환 결과로 사용하지 않습니다.",
            "원본 디자인 보존 변환은 정식 구조 악보 데이터가 확보된 경우에만 진행해야 합니다."
          ]
        };
      }
      progress(100, "failed", "Audiveris 실행은 끝났지만 MusicXML 결과 파일을 찾지 못했습니다.", logPath);
      await writeAppLog("omr", "musicxml output not found", { sourcePath, logPath });
      return {
        status: "failed",
        sourcePath,
        message: "Audiveris 실행은 끝났지만 MusicXML 결과 파일을 찾지 못했습니다.",
        logPath,
        logExcerpt: logPath ? await readLogTail(logPath, 30).catch(() => undefined) : undefined,
        diagnostics
      };
    }

    progress(88, "parsing", "MusicXML 결과를 읽고 있습니다.", output);
    const musicXml = await readMusicXmlExport(output, workDir);
    progress(94, "parsing", "음표 데이터를 앱 내부 악보 모델로 바꾸고 있습니다.");
    const score = parseMusicXmlToScore(musicXml, basename(sourcePath));
    await attachAudiverisLayoutFromOmr(workDir, score, diagnostics);
    await attachPdfLayoutPagesIfPossible(audiverisInputPath, workDir, score, diagnostics);

    if (!score.tracks.some((track) => track.notes.length > 0)) {
      progress(100, "failed", "MusicXML은 생성됐지만 인식된 음표가 없습니다.", output);
      await writeAppLog("omr", "musicxml contained no notes", { sourcePath, output, logPath });
      return {
        status: "failed",
        sourcePath,
        message: "MusicXML은 생성됐지만 인식된 음표가 없습니다. 원본 악보와 OMR 설정을 확인해야 합니다.",
        musicXmlPath: output,
        logPath,
        logExcerpt: logPath ? await readLogTail(logPath, 30).catch(() => undefined) : undefined,
        diagnostics: [...diagnostics, `MusicXML 결과 파일: ${output}`]
      };
    }

    await writeAppLog("omr", "conversion completed", {
      sourcePath,
      output,
      notes: score.tracks.reduce((sum, track) => sum + track.notes.length, 0),
      logPath
    });
    progress(100, "done", "악보 분석이 끝났습니다.", `${score.tracks.reduce((sum, track) => sum + track.notes.length, 0)}개 음표`);
    return {
      status: "converted",
      sourcePath,
      musicXmlPath: output,
      logPath,
      logExcerpt: await readLogTail(logPath, 20).catch(() => undefined),
      message: `${basename(sourcePath)} 파일을 MusicXML로 변환했습니다.`,
      score,
      diagnostics
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 OMR 변환 오류입니다.";
    progress(100, "failed", message, logPath);
    await writeAppLog("omr", "conversion threw", { sourcePath, message, logPath });
    return {
      status: "failed",
      sourcePath,
      message,
      logPath,
      logExcerpt: logPath ? await readLogTail(logPath, 30).catch(() => undefined) : undefined,
      diagnostics
    };
  } finally {
    if (process.env.TABTRANSPORTER_KEEP_OMR_TMP !== "1") {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function trySegmentedPdfOmr(
  audiverisPath: string,
  pdfPath: string,
  workDir: string,
  originalSourcePath: string,
  progress: ProgressReporter,
  diagnostics: string[]
): Promise<SegmentedOmrResult | undefined> {
  if (extname(pdfPath).toLowerCase() !== ".pdf") {
    return undefined;
  }

  let pdfInfo: PdfInfo;
  try {
    pdfInfo = await readPdfInfo(pdfPath);
  } catch (error) {
    diagnostics.push(`페이지별 재분석을 건너뜁니다. pdfinfo 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  const segmentedDir = await mkdtemp(join(workDir, "segmented-"));
  const pageWidthPx = pdfPageWidthPx(pdfInfo);
  const pageHeightPx = pdfPageHeightPx(pdfInfo);
  const layoutPages = await buildPdfLayoutPages(pdfPath, pdfInfo, segmentedDir, diagnostics);
  const scoreParts: ScoreModel[] = [];
  const logExcerpt: string[] = [];
  diagnostics.push(`페이지별 재분석 시작: ${pdfInfo.pages}페이지`);

  for (let page = 1; page <= pdfInfo.pages; page += 1) {
    progress(86 + Math.min(8, page), "omr", `${page}페이지를 개별 분석하고 있습니다.`);
    const pageDir = await mkdtemp(join(segmentedDir, `page-${page}-`));
    let pageRun: AudiverisRunResult | undefined;
    try {
      const pageInputPath = await renderPdfPageImage(pdfPath, page, PDF_RENDER_DPI, pageDir, `page-${page}-source`);
      pageRun = await runAudiveris(audiverisPath, pageInputPath, pageDir, originalSourcePath, progress, {
        label: `page-${page}`
      });
      const pageOutput = pageRun.exitCode === 0 ? await findMusicXml(pageDir) : undefined;

      if (pageOutput) {
        const musicXml = await readMusicXmlExport(pageOutput, pageDir);
        const pageScore = parseMusicXmlToScore(musicXml, `${basename(originalSourcePath)} ${page}페이지`);
        await attachAudiverisLayoutFromOmr(pageDir, pageScore, diagnostics);
        remapSourceBounds(pageScore, page, pageWidthPx, pageHeightPx);
        if (pageScore.tracks.some((track) => track.notes.length > 0)) {
          scoreParts.push(pageScore);
          diagnostics.push(`${page}페이지 개별 MusicXML 변환 성공`);
          logExcerpt.push(...extractImportantAudiverisLines(`${pageRun.stdout}\n${pageRun.stderr}`));
          continue;
        }
      }
    } catch (error) {
      diagnostics.push(`${page}페이지 개별 이미지 변환 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    diagnostics.push(`${page}페이지 개별 변환 실패. 시스템 밴드 단위로 재분석합니다.`);
    const bandScores = await convertPdfPageByBands(audiverisPath, pdfPath, page, pdfInfo, segmentedDir, originalSourcePath, progress, diagnostics);
    if (bandScores.length) {
      scoreParts.push(...bandScores);
      continue;
    }

    diagnostics.push(`${page}페이지는 밴드 단위 재분석도 실패했습니다.`);
    if (pageRun) {
      logExcerpt.push(...extractImportantAudiverisLines(`${pageRun.stdout}\n${pageRun.stderr}`));
    }
  }

  const score = mergeScoreParts(scoreParts, basename(originalSourcePath), layoutPages);
  const noteCount = score.tracks.reduce((sum, track) => sum + track.notes.length, 0);
  if (noteCount === 0) {
    diagnostics.push("페이지/구간별 재분석에서 사용할 수 있는 음표를 얻지 못했습니다.");
    return undefined;
  }

  const musicXmlPath = join(segmentedDir, `${basename(originalSourcePath, extname(originalSourcePath))}-segmented.musicxml`);
  await writeFile(musicXmlPath, scoreToMusicXml(score), "utf8");
  diagnostics.push(`페이지/구간별 재분석 MusicXML: ${musicXmlPath}`);
  diagnostics.push(`페이지/구간별 재분석 음표 수: ${noteCount}`);

  return {
    score,
    musicXmlPath,
    logExcerpt: logExcerpt.length ? logExcerpt.slice(-30) : undefined
  };
}

async function convertPdfPageByBands(
  audiverisPath: string,
  pdfPath: string,
  page: number,
  pdfInfo: PdfInfo,
  segmentedDir: string,
  originalSourcePath: string,
  progress: ProgressReporter,
  diagnostics: string[]
): Promise<ScoreModel[]> {
  const dpi = PDF_RENDER_DPI;
  const widthPx = Math.ceil((pdfInfo.widthPt / 72) * dpi);
  const heightPx = Math.ceil((pdfInfo.heightPt / 72) * dpi);
  const bandCount = Math.max(1, Math.ceil(heightPx / 430));
  const bandHeight = Math.ceil(heightPx / bandCount);
  const scores: ScoreModel[] = [];

  for (let band = 0; band < bandCount; band += 1) {
    const top = band * bandHeight;
    const height = Math.min(bandHeight, heightPx - top);
    if (height < 120) {
      continue;
    }

    progress(90, "omr", `${page}페이지 ${band + 1}/${bandCount}구간을 분석하고 있습니다.`);
    const bandDir = await mkdtemp(join(segmentedDir, `page-${page}-band-${band + 1}-`));
    const imagePath = await renderPdfPageBand(pdfPath, page, widthPx, top, height, dpi, bandDir, `page-${page}-band-${band + 1}`);
    const run = await runAudiveris(audiverisPath, imagePath, bandDir, originalSourcePath, progress, {
      label: `page-${page}-band-${band + 1}`
    });
    if (run.exitCode !== 0) {
      diagnostics.push(`${page}페이지 ${band + 1}구간 MusicXML 변환 실패`);
      continue;
    }

    const output = await findMusicXml(bandDir);
    if (!output) {
      diagnostics.push(`${page}페이지 ${band + 1}구간 MusicXML 결과 파일 없음`);
      continue;
    }

    const musicXml = await readMusicXmlExport(output, bandDir);
    const score = parseMusicXmlToScore(musicXml, `${basename(originalSourcePath)} ${page}페이지 ${band + 1}구간`);
    await attachAudiverisLayoutFromOmr(bandDir, score, diagnostics);
    remapSourceBounds(score, page, widthPx, heightPx, top);
    if (!score.tracks.some((track) => track.notes.length > 0)) {
      diagnostics.push(`${page}페이지 ${band + 1}구간은 음표가 없어 제외`);
      continue;
    }
    scores.push(score);
    diagnostics.push(`${page}페이지 ${band + 1}구간 MusicXML 변환 성공`);
  }

  return scores;
}

async function attachPdfLayoutPagesIfPossible(
  pdfPath: string,
  workDir: string,
  score: ScoreModel,
  diagnostics: string[]
): Promise<void> {
  if (extname(pdfPath).toLowerCase() !== ".pdf") {
    return;
  }

  try {
    const pdfInfo = await readPdfInfo(pdfPath);
    const layoutPages = await buildPdfLayoutPages(pdfPath, pdfInfo, workDir, diagnostics);
    if (!layoutPages.length) {
      return;
    }
    score.layoutPages = layoutPages;
    fillSourcePageDimensions(score, layoutPages);
  } catch (error) {
    diagnostics.push(`원본 PDF 페이지 미리보기 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function buildPdfLayoutPages(
  pdfPath: string,
  pdfInfo: PdfInfo,
  outputDir: string,
  diagnostics: string[]
): Promise<ScoreLayoutPage[]> {
  const pageDir = await mkdtemp(join(outputDir, "layout-pages-"));
  const width = pdfPageWidthPx(pdfInfo);
  const height = pdfPageHeightPx(pdfInfo);
  const pages: ScoreLayoutPage[] = [];

  for (let page = 1; page <= pdfInfo.pages; page += 1) {
    try {
      const imagePath = await renderPdfPageImage(pdfPath, page, PDF_RENDER_DPI, pageDir, `layout-page-${page}`);
      const image = await readFile(imagePath);
      pages.push({
        page,
        width,
        height,
        dataUrl: `data:image/png;base64,${image.toString("base64")}`
      });
    } catch (error) {
      diagnostics.push(`${page}페이지 원본 이미지 렌더링 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (pages.length) {
    diagnostics.push(`원본 PDF 페이지 이미지 연결: ${pages.length}/${pdfInfo.pages}페이지`);
  }

  return pages;
}

function remapSourceBounds(score: ScoreModel, page: number, pageWidth: number, pageHeight: number, offsetY = 0): void {
  for (const note of score.tracks.flatMap((track) => track.notes)) {
    if (!note.originalSource) {
      continue;
    }

    note.originalSource = {
      ...note.originalSource,
      page,
      pageWidth,
      pageHeight,
      y: note.originalSource.y + offsetY
    };
  }
}

function fillSourcePageDimensions(score: ScoreModel, pages: ScoreLayoutPage[]): void {
  const pageMap = new Map(pages.map((page) => [page.page, page]));
  for (const note of score.tracks.flatMap((track) => track.notes)) {
    if (!note.originalSource) {
      continue;
    }
    const page = pageMap.get(note.originalSource.page);
    if (!page) {
      continue;
    }
    note.originalSource = {
      ...note.originalSource,
      pageWidth: page.width,
      pageHeight: page.height
    };
  }
}

function pdfPageWidthPx(pdfInfo: PdfInfo): number {
  return Math.ceil((pdfInfo.widthPt / 72) * PDF_RENDER_DPI);
}

function pdfPageHeightPx(pdfInfo: PdfInfo): number {
  return Math.ceil((pdfInfo.heightPt / 72) * PDF_RENDER_DPI);
}

function readPdfInfo(pdfPath: string): Promise<PdfInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdfinfo", [pdfPath], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pdfinfo exited with code ${code}`));
        return;
      }
      const pages = Number.parseInt(/Pages:\s+(\d+)/i.exec(stdout)?.[1] ?? "0", 10);
      const pageSizeMatch = /Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/i.exec(stdout);
      const widthPt = Number.parseFloat(pageSizeMatch?.[1] ?? "0");
      const heightPt = Number.parseFloat(pageSizeMatch?.[2] ?? "0");
      if (!pages || !widthPt || !heightPt) {
        reject(new Error("pdfinfo output did not include page count and page size"));
        return;
      }
      resolve({ pages, widthPt, heightPt });
    });
  });
}

function renderPdfPageImage(
  pdfPath: string,
  page: number,
  dpi: number,
  outputDir: string,
  label: string
): Promise<string> {
  const prefix = join(outputDir, label);
  const args = ["-f", String(page), "-l", String(page), "-png", "-r", String(dpi), pdfPath, prefix];

  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pdftoppm exited with code ${code}`));
        return;
      }
      const files = await readdir(outputDir, { withFileTypes: true });
      const image = files.find((entry) => entry.isFile() && entry.name.startsWith(label) && entry.name.endsWith(".png"));
      if (!image) {
        reject(new Error("pdftoppm did not create a PNG page"));
        return;
      }
      resolve(join(outputDir, image.name));
    });
  });
}

function renderPdfPageBand(
  pdfPath: string,
  page: number,
  width: number,
  top: number,
  height: number,
  dpi: number,
  outputDir: string,
  label: string
): Promise<string> {
  const prefix = join(outputDir, label);
  const args = [
    "-f",
    String(page),
    "-l",
    String(page),
    "-png",
    "-r",
    String(dpi),
    "-x",
    "0",
    "-y",
    String(top),
    "-W",
    String(width),
    "-H",
    String(height),
    pdfPath,
    prefix
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pdftoppm exited with code ${code}`));
        return;
      }
      const files = await readdir(outputDir, { withFileTypes: true });
      const image = files.find((entry) => entry.isFile() && entry.name.startsWith(label) && entry.name.endsWith(".png"));
      if (!image) {
        reject(new Error("pdftoppm did not create a PNG crop"));
        return;
      }
      resolve(join(outputDir, image.name));
    });
  });
}

function mergeScoreParts(parts: ScoreModel[], title: string, layoutPages?: ScoreLayoutPage[]): ScoreModel {
  const notes: NoteEvent[] = [];
  let measureOffset = 0;
  let noteIndex = 1;

  for (const part of parts) {
    const partNotes = part.tracks.flatMap((track) => track.notes);
    if (!partNotes.length) {
      continue;
    }
    const minMeasure = Math.min(...partNotes.map((note) => note.measure));
    const maxMeasure = Math.max(...partNotes.map((note) => note.measure));
    for (const note of partNotes) {
      notes.push({
        ...note,
        id: `segmented-${noteIndex++}`,
        measure: measureOffset + (note.measure - minMeasure + 1),
        tab: note.tab ? { ...note.tab } : undefined,
        originalSource: note.originalSource ? { ...note.originalSource } : undefined
      });
    }
    measureOffset += Math.max(1, maxMeasure - minMeasure + 1);
  }

  return {
    id: "segmented-omr-score",
    title,
    tempo: parts.find((part) => part.tempo)?.tempo ?? 92,
    timeSignature: parts.find((part) => part.timeSignature)?.timeSignature ?? [4, 4],
    layoutPages: layoutPages?.map((page) => ({ ...page })),
    tracks: [
      {
        id: "segmented-omr-track-1",
        name: "페이지별 OMR 악보",
        instrumentPresetId: "guitar-standard-6",
        notes
      }
    ]
  };
}

function scoreToMusicXml(score: ScoreModel): string {
  const notesByMeasure = new Map<number, NoteEvent[]>();
  for (const note of score.tracks.flatMap((track) => track.notes)) {
    const notes = notesByMeasure.get(note.measure) ?? [];
    notes.push(note);
    notesByMeasure.set(note.measure, notes);
  }

  const measures = Array.from(notesByMeasure.entries())
    .sort(([a], [b]) => a - b)
    .map(([measure, notes]) => {
      const body = notes
        .sort((a, b) => a.beat - b.beat || a.midi - b.midi)
        .map((note) => {
          const pitch = midiToMusicXmlPitch(note.midi);
          return `      <note>
        <pitch>
          <step>${pitch.step}</step>${pitch.alter ? `\n          <alter>${pitch.alter}</alter>` : ""}
          <octave>${pitch.octave}</octave>
        </pitch>
        <duration>${Math.max(1, Math.round(note.durationBeats))}</duration>
        <type>quarter</type>
      </note>`;
        })
        .join("\n");
      const attributes =
        measure === 1
          ? `      <attributes>
        <divisions>1</divisions>
        <time>
          <beats>${score.timeSignature[0]}</beats>
          <beat-type>${score.timeSignature[1]}</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>\n`
          : "";
      return `    <measure number="${measure}">
${attributes}${body}
    </measure>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <movement-title>${escapeXml(score.title)}</movement-title>
  <part-list>
    <score-part id="P1">
      <part-name>${escapeXml(score.tracks[0]?.name ?? "OMR")}</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures}
  </part>
</score-partwise>`;
}

function midiToMusicXmlPitch(midi: number): { step: string; alter: number; octave: number } {
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = ((midi % 12) + 12) % 12;
  const pitches = [
    { step: "C", alter: 0 },
    { step: "C", alter: 1 },
    { step: "D", alter: 0 },
    { step: "D", alter: 1 },
    { step: "E", alter: 0 },
    { step: "F", alter: 0 },
    { step: "F", alter: 1 },
    { step: "G", alter: 0 },
    { step: "G", alter: 1 },
    { step: "A", alter: 0 },
    { step: "A", alter: 1 },
    { step: "B", alter: 0 }
  ];
  return { ...pitches[pitchClass], octave };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function buildFallbackScoreFromOmr(
  workDir: string,
  title: string,
  diagnostics: string[]
): Promise<OmrFallbackScore | undefined> {
  const omrPath = await findOmrFile(workDir);
  if (!omrPath) {
    diagnostics.push("Audiveris 내부 OMR 파일을 찾지 못해 fallback 복구를 건너뜁니다.");
    return undefined;
  }

  const extractDir = await mkdtemp(join(workDir, "omr-fallback-"));
  const zipPath = join(extractDir, "book.zip");
  await copyFile(omrPath, zipPath);
  await expandZip(zipPath, extractDir);

  const sheetXmlFiles = await findAudiverisSheetXmlFiles(extractDir);
  const notes: NoteEvent[] = [];
  let noteIndex = 1;

  for (const sheetXmlFile of sheetXmlFiles) {
    const xml = await readFile(sheetXmlFile.path, "utf8");
    const parsed = parseAudiverisSheetHeadsToNotes(xml, sheetXmlFile.sheetNumber, noteIndex);
    notes.push(...parsed);
    noteIndex += parsed.length;
  }

  if (!notes.length) {
    diagnostics.push(`Audiveris 내부 OMR 파일은 찾았지만 note-head 데이터를 읽지 못했습니다: ${omrPath}`);
    return undefined;
  }

  diagnostics.push(`Audiveris 내부 OMR fallback 음표 수: ${notes.length}`);

  return {
    omrPath,
    score: {
      id: "omr-fallback-score",
      title,
      tempo: 92,
      timeSignature: [4, 4],
      tracks: [
        {
          id: "omr-fallback-track-1",
          name: "OMR 임시 악보",
          instrumentPresetId: "guitar-standard-6",
          notes
        }
      ]
    }
  };
}

async function attachAudiverisLayoutFromOmr(
  workDir: string,
  score: ScoreModel,
  diagnostics: string[]
): Promise<void> {
  const fallback = await buildFallbackScoreFromOmr(workDir, score.title, diagnostics);
  if (!fallback) {
    diagnostics.push("정식 변환은 성공했지만 원본 좌표 데이터를 찾지 못했습니다.");
    return;
  }

  const layoutNotes = fallback.score.tracks.flatMap((track) => track.notes).filter(hasOriginalSource);
  const scoreNotes = score.tracks.flatMap((track) => track.notes);
  const count = Math.min(scoreNotes.length, layoutNotes.length);
  for (let index = 0; index < count; index += 1) {
    scoreNotes[index].originalSource = { ...layoutNotes[index].originalSource };
  }

  diagnostics.push(`원본 레이아웃 좌표 연결: ${count}/${scoreNotes.length}개 음표`);
  if (layoutNotes.length !== scoreNotes.length) {
    diagnostics.push(`주의: MusicXML 음표 수(${scoreNotes.length})와 Audiveris 좌표 수(${layoutNotes.length})가 달라 순서 기준으로 가능한 만큼만 연결했습니다.`);
  }
}

function hasOriginalSource(note: NoteEvent): note is NoteEvent & { originalSource: SourceBounds } {
  return Boolean(note.originalSource);
}

async function findOmrFile(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findOmrFile(filePath);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === ".omr") {
      return filePath;
    }
  }

  return undefined;
}

async function findAudiverisSheetXmlFiles(
  directory: string
): Promise<Array<{ path: string; sheetNumber: number }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: Array<{ path: string; sheetNumber: number }> = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...(await findAudiverisSheetXmlFiles(filePath)));
      continue;
    }

    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".xml") {
      continue;
    }

    const sheetMatch = /sheet#(\d+)\.xml$/i.exec(entry.name);
    if (sheetMatch) {
      candidates.push({ path: filePath, sheetNumber: Number.parseInt(sheetMatch[1], 10) || 1 });
    }
  }

  return candidates.sort((a, b) => a.sheetNumber - b.sheetNumber || a.path.localeCompare(b.path));
}

export function parseAudiverisSheetHeadsToNotes(
  sheetXml: string,
  sheetNumber = 1,
  startIndex = 1
): NoteEvent[] {
  const clefs = parseAudiverisClefs(sheetXml);
  const keyFifths = parseAudiverisKeyFifths(sheetXml);
  const heads: AudiverisHeadCandidate[] = [];
  const headRegex = /<head\b([^>]*)>([\s\S]*?)<\/head>/gi;
  let headMatch: RegExpExecArray | null;

  while ((headMatch = headRegex.exec(sheetXml))) {
    const attributes = headMatch[1];
    const body = headMatch[2];
    const shape = readXmlAttribute(attributes, "shape");
    if (shape && !shape.includes("NOTEHEAD")) {
      continue;
    }

    const pitch = readNumberAttribute(attributes, "pitch");
    const staff = readIntegerAttribute(attributes, "staff") ?? 1;
    const boundsMatch =
      /<bounds\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*w="([^"]+)"[^>]*h="([^"]+)"/i.exec(body);
    if (pitch === undefined || !boundsMatch) {
      continue;
    }

    const x = Number.parseFloat(boundsMatch[1]);
    const y = Number.parseFloat(boundsMatch[2]);
    const width = Number.parseFloat(boundsMatch[3]);
    const height = Number.parseFloat(boundsMatch[4]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
      continue;
    }

    const clefKind = clefs.get(staff) ?? "TREBLE";
    const midi = audiverisPitchToMidi(pitch, clefKind, keyFifths);
    if (midi < 0 || midi > 127) {
      continue;
    }

    const grade = readNumberAttribute(attributes, "grade");
    const contextGrade = readNumberAttribute(attributes, "ctx-grade");
    const rawConfidence = Math.min(...[grade, contextGrade].filter((value): value is number => value !== undefined));
    const confidence = Number.isFinite(rawConfidence) ? Math.max(0.15, Math.min(0.55, rawConfidence)) : 0.3;

    heads.push({
      id: readXmlAttribute(attributes, "id") ?? `${sheetNumber}-${heads.length + 1}`,
      sheetNumber,
      staff,
      x,
      y,
      width,
      height,
      midi,
      confidence
    });
  }

  heads.sort(compareAudiverisHeads);

  const notes: NoteEvent[] = [];
  let onsetIndex = 0;
  let previous: AudiverisHeadCandidate | undefined;

  for (const head of heads) {
    const sameOnset =
      previous &&
      head.sheetNumber === previous.sheetNumber &&
      head.staff === previous.staff &&
      Math.abs(head.x - previous.x) <= 8 &&
      Math.abs(head.y - previous.y) <= 48;

    if (!sameOnset) {
      onsetIndex += 1;
    }

    const zeroBased = Math.max(0, onsetIndex - 1);
    notes.push({
      id: `omr-fallback-${startIndex + notes.length}-${head.id}`,
      measure: Math.floor(zeroBased / 4) + 1,
      beat: (zeroBased % 4) + 1,
      durationBeats: 1,
      midi: head.midi,
      source: "omr",
      confidence: head.confidence,
      originalSource: {
        page: head.sheetNumber,
        x: head.x,
        y: head.y,
        width: head.width,
        height: head.height,
        staff: head.staff
      }
    });

    previous = head;
  }

  return notes;
}

function parseAudiverisClefs(sheetXml: string): Map<number, string> {
  const clefs = new Map<number, string>();
  const clefRegex = /<clef\b([^>]*)>/gi;
  let clefMatch: RegExpExecArray | null;

  while ((clefMatch = clefRegex.exec(sheetXml))) {
    const attributes = clefMatch[1];
    const staff = readIntegerAttribute(attributes, "staff") ?? 1;
    const kind = readXmlAttribute(attributes, "kind") ?? "TREBLE";
    if (!clefs.has(staff)) {
      clefs.set(staff, kind.toUpperCase());
    }
  }

  return clefs;
}

function parseAudiverisKeyFifths(sheetXml: string): number {
  const attributeValue = /<key\b[^>]*fifths="([^"]+)"/i.exec(sheetXml)?.[1];
  const elementValue = /<fifths>(-?\d+)<\/fifths>/i.exec(sheetXml)?.[1];
  const parsed = Number.parseInt(attributeValue ?? elementValue ?? "0", 10);
  return Number.isFinite(parsed) ? Math.max(-7, Math.min(7, parsed)) : 0;
}

function compareAudiverisHeads(a: AudiverisHeadCandidate, b: AudiverisHeadCandidate): number {
  const rowA = Math.round(a.y / 32);
  const rowB = Math.round(b.y / 32);
  return a.sheetNumber - b.sheetNumber || rowA - rowB || a.x - b.x || a.staff - b.staff || a.y - b.y;
}

function audiverisPitchToMidi(pitch: number, clefKind: string, keyFifths: number): number {
  const normalizedClef = clefKind.toUpperCase();
  const base =
    normalizedClef.includes("BASS") || normalizedClef.includes("F_CLEF")
      ? { letter: "D", octave: 3 }
      : normalizedClef.includes("ALTO") || normalizedClef.includes("C_CLEF")
        ? { letter: "C", octave: 4 }
        : { letter: "B", octave: 4 };
  const diatonicIndex = noteToDiatonicIndex(base.letter, base.octave) - Math.round(pitch);
  const note = diatonicIndexToNote(diatonicIndex);
  return naturalNoteToMidi(note.letter, note.octave) + keySignatureAlter(note.letter, keyFifths);
}

function noteToDiatonicIndex(letter: string, octave: number): number {
  const index = ["C", "D", "E", "F", "G", "A", "B"].indexOf(letter);
  return octave * 7 + Math.max(0, index);
}

function diatonicIndexToNote(index: number): { letter: string; octave: number } {
  const letters = ["C", "D", "E", "F", "G", "A", "B"];
  const octave = Math.floor(index / 7);
  const letterIndex = ((index % 7) + 7) % 7;
  return { letter: letters[letterIndex], octave };
}

function naturalNoteToMidi(letter: string, octave: number): number {
  const pitchClass: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return 12 * (octave + 1) + pitchClass[letter];
}

function keySignatureAlter(letter: string, fifths: number): number {
  const sharps = ["F", "C", "G", "D", "A", "E", "B"];
  const flats = ["B", "E", "A", "D", "G", "C", "F"];
  if (fifths > 0 && sharps.slice(0, fifths).includes(letter)) {
    return 1;
  }
  if (fifths < 0 && flats.slice(0, Math.abs(fifths)).includes(letter)) {
    return -1;
  }
  return 0;
}

function readXmlAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`, "i").exec(attributes)?.[1];
}

function readNumberAttribute(attributes: string, name: string): number | undefined {
  const value = readXmlAttribute(attributes, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readIntegerAttribute(attributes: string, name: string): number | undefined {
  const value = readXmlAttribute(attributes, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function prepareAudiverisInput(sourcePath: string, workDir: string): Promise<string> {
  const extension = extname(sourcePath) || ".score";
  const safeName = basename(sourcePath, extension).replace(/[^a-zA-Z0-9가-힣._-]+/g, "_") || "score";
  const safePath = join(workDir, `${safeName.slice(0, 80)}${extension}`);
  await copyFile(sourcePath, safePath);
  return safePath;
}

async function runAudiveris(
  audiverisPath: string,
  sourcePath: string,
  outputDir: string,
  originalSourcePath: string,
  progress: ProgressReporter,
  options: AudiverisRunOptions = {}
): Promise<AudiverisRunResult> {
  const args = ["-batch", "-export", ...(options.beforeOutputArgs ?? []), "-output", outputDir, sourcePath];
  const logPath = await createRunLogFile("omr", options.label ? `${options.label}-${basename(originalSourcePath)}` : basename(originalSourcePath));
  await appendLogFile(
    logPath,
    [
      `[${new Date().toISOString()}] Audiveris OMR run`,
      `Original source: ${originalSourcePath}`,
      `Audiveris input: ${sourcePath}`,
      `Output directory: ${outputDir}`,
      `Executable: ${audiverisPath}`,
      `Arguments: ${args.join(" ")}`,
      ""
    ].join("\n")
  );

  return new Promise((resolve, reject) => {
    const writes: Promise<void>[] = [];
    const writeRunLog = (text: string) => {
      writes.push(appendLogFile(logPath, text));
    };
    const child = spawn(audiverisPath, args, {
      windowsHide: true,
      shell: audiverisPath.endsWith(".bat")
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      writeRunLog("\n[TIMEOUT] Audiveris 변환 시간이 초과되었습니다.\n");
    }, AUDIVERIS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      writeRunLog(text);
      reportAudiverisProgress(text, progress);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      writeRunLog(text);
      reportAudiverisProgress(text, progress);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      writeRunLog(`\n[EXIT] code=${code}\n`);
      Promise.allSettled(writes).then(() => {
        resolve({ exitCode: code, stdout, stderr, logPath, timedOut });
      });
    });
  });
}

function createProgressReporter(onProgress?: ProgressSink): ProgressReporter {
  let lastPercent = 0;
  let lastMessage = "";
  return (percentInput, phase, message, detail) => {
    const percent = Math.max(lastPercent, Math.min(100, Math.round(percentInput)));
    const next = { percent, phase, message, detail };
    if (percent === lastPercent && message === lastMessage) {
      return;
    }
    lastPercent = percent;
    lastMessage = message;
    onProgress?.(next);
  };
}

function reportAudiverisProgress(text: string, progress: ProgressReporter): void {
  for (const line of text.split(/\r?\n/)) {
    const stepMatch = /StepMonitoring\s+\d+\s+\|\s+([A-Z_]+)/.exec(line);
    if (stepMatch) {
      const step = stepMatch[1];
      progress(stepPercent(step), "omr", `${stepLabel(step)} 단계 처리 중`, compactLogLine(line));
      continue;
    }

    const sheetMatch = /\[([^\]]+#\d+)\]/.exec(line);
    if (sheetMatch && /Loaded image|Book stored|End of Stub/.test(line)) {
      progress(18, "omr", `${sheetMatch[1]} 페이지를 분석하고 있습니다.`, compactLogLine(line));
      continue;
    }

    if (/Exporting sheet|exported to/i.test(line)) {
      progress(84, "omr", "MusicXML로 내보내고 있습니다.", compactLogLine(line));
      continue;
    }

    if (/Could not export|Exception|Exit forced|No target duration|please check time signatures/i.test(line)) {
      progress(98, "omr", "Audiveris가 오류를 보고했습니다.", compactLogLine(line));
    }
  }
}

function stepPercent(step: string): number {
  const index = AUDIVERIS_STEPS.indexOf(step);
  if (index < 0) {
    return 20;
  }
  return 14 + Math.round((index / Math.max(1, AUDIVERIS_STEPS.length - 1)) * 66);
}

function stepLabel(step: string): string {
  return AUDIVERIS_STEP_LABELS[step] ?? step;
}

function compactLogLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function summarizeAudiverisFailure(run: AudiverisRunResult): string {
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.timedOut) {
    return "Audiveris 변환 시간이 초과되었습니다. 로그 파일에서 마지막 처리 단계를 확인하세요.";
  }
  if (/Could not find file/i.test(output)) {
    return "Audiveris가 입력 파일을 찾지 못했습니다. 파일 경로 처리 또는 접근 권한을 확인해야 합니다.";
  }
  if (/Could not export since transcription did not complete successfully/i.test(output)) {
    return "Audiveris가 악보 인식은 시도했지만 리듬/박자 인식을 완료하지 못해 MusicXML 내보내기에 실패했습니다.";
  }
  if (/No target duration|Time value not yet available|please check time signatures/i.test(output)) {
    return "Audiveris가 박자표 또는 마디 길이를 확정하지 못해 변환에 실패했습니다.";
  }
  return `Audiveris가 코드 ${run.exitCode}로 종료되었습니다. 자세한 내용은 로그 파일을 확인하세요.`;
}

function extractImportantAudiverisLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => /WARN|ERROR|Exception|Could not|No target duration|Time value not yet available|please check time signatures/i.test(line))
    .slice(-16);
}

async function findMusicXml(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });
  let mxlCandidate: string | undefined;

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findMusicXml(filePath);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (extension === ".xml" || extension === ".musicxml") {
      return filePath;
    }
    if (extension === ".mxl") {
      mxlCandidate = mxlCandidate ?? filePath;
    }
  }

  return mxlCandidate;
}

async function readMusicXmlExport(outputPath: string, workDir: string): Promise<string> {
  const extension = extname(outputPath).toLowerCase();
  if (extension !== ".mxl") {
    return readFile(outputPath, "utf8");
  }

  const extractDir = await mkdtemp(join(workDir, "mxl-"));
  const zipPath = join(extractDir, "score.zip");
  await copyFile(outputPath, zipPath);
  await expandZip(zipPath, extractDir);

  const xmlPath = await findExtractedMusicXml(extractDir);
  if (!xmlPath) {
    throw new Error("Audiveris MXL 파일 안에서 MusicXML 본문을 찾지 못했습니다.");
  }

  return readFile(xmlPath, "utf8");
}

function expandZip(zipPath: string, extractDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar.exe", ["-xf", zipPath, "-C", extractDir], { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `MXL 압축 해제가 코드 ${code}로 실패했습니다.`));
    });
  });
}

async function findExtractedMusicXml(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: string[] = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toUpperCase() === "META-INF") {
        continue;
      }
      const nested = await findExtractedMusicXml(filePath);
      if (nested) {
        candidates.push(nested);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (extension === ".xml" || extension === ".musicxml") {
      candidates.push(filePath);
    }
  }

  return candidates[0];
}

export function parseMusicXmlToScore(musicXml: string, title = "변환된 악보"): ScoreModel {
  const notes: NoteEvent[] = [];
  const measureRegex = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/gi;
  let measureMatch: RegExpExecArray | null;
  let noteIndex = 1;
  let divisions = 1;
  const timeSignature = parseTimeSignature(musicXml);
  const parsedTitle = parseTextElement(musicXml, "movement-title") ?? parseTextElement(musicXml, "work-title") ?? title;
  const tempo = parseTempo(musicXml);

  while ((measureMatch = measureRegex.exec(musicXml))) {
    const measureAttributes = measureMatch[1];
    const measureBody = measureMatch[2];
    const numberMatch = /number="([^"]+)"/.exec(measureAttributes);
    const parsedMeasure = numberMatch ? Number.parseInt(numberMatch[1], 10) : Number.NaN;
    const measure = Number.isFinite(parsedMeasure) && parsedMeasure > 0 ? parsedMeasure : (notes.at(-1)?.measure ?? 1);
    const divisionsMatch = /<divisions>(\d+)<\/divisions>/.exec(measureBody);
    if (divisionsMatch) {
      divisions = Number.parseInt(divisionsMatch[1], 10) || divisions;
    }
    let beat = 1;
    let lastOnset = 1;

    const noteRegex = /<note\b[^>]*>([\s\S]*?)<\/note>/gi;
    let noteMatch: RegExpExecArray | null;
    while ((noteMatch = noteRegex.exec(measureBody))) {
      const body = noteMatch[1];
      const durationMatch = /<duration>(\d+)<\/duration>/.exec(body);
      const durationBeats = durationMatch ? Math.max(0.25, Number.parseInt(durationMatch[1], 10) / divisions) : 1;
      const isChord = /<chord\s*\/?>/.test(body);

      if (/<rest\b/.test(body)) {
        if (!isChord) {
          beat += durationBeats;
        }
        continue;
      }

      const step = /<step>([A-G])<\/step>/.exec(body)?.[1];
      const octave = /<octave>(-?\d+)<\/octave>/.exec(body)?.[1];
      const alter = /<alter>(-?\d+)<\/alter>/.exec(body)?.[1];

      if (!step || octave === undefined) {
        if (!isChord) {
          beat += durationBeats;
        }
        continue;
      }

      const alterValue = alter ? Number.parseInt(alter, 10) || 0 : 0;
      const midi = noteNameToMidi(`${step}${octave}`) + alterValue;
      if (midi < 0 || midi > 127) {
        if (!isChord) {
          beat += durationBeats;
        }
        continue;
      }
      const noteBeat = isChord ? lastOnset : beat;

      notes.push({
        id: `omr-${noteIndex++}`,
        measure,
        beat: noteBeat,
        durationBeats,
        midi,
        source: "omr",
        confidence: 0.8
      });
      if (!isChord) {
        lastOnset = beat;
        beat += durationBeats;
      }
    }
  }

  return {
    id: "omr-score",
    title: parsedTitle,
    tempo,
    timeSignature,
    tracks: [
      {
        id: "omr-track-1",
        name: "OMR 악보",
        instrumentPresetId: "guitar-standard-6",
        notes
      }
    ]
  };
}

function parseTimeSignature(musicXml: string): [number, number] {
  const timeMatch = /<time\b[^>]*>[\s\S]*?<beats>(\d+)<\/beats>[\s\S]*?<beat-type>(\d+)<\/beat-type>[\s\S]*?<\/time>/i.exec(
    musicXml
  );
  if (!timeMatch) {
    return [4, 4];
  }

  const beats = Number.parseInt(timeMatch[1], 10);
  const beatType = Number.parseInt(timeMatch[2], 10);
  return [beats || 4, beatType || 4];
}

function parseTempo(musicXml: string): number {
  const soundTempo = /<sound\b[^>]*tempo="([^"]+)"/i.exec(musicXml)?.[1];
  const metronomeTempo = /<per-minute>(\d+)<\/per-minute>/i.exec(musicXml)?.[1];
  const tempo = Number.parseFloat(soundTempo ?? metronomeTempo ?? "");
  return Number.isFinite(tempo) && tempo > 0 ? tempo : 92;
}

function parseTextElement(musicXml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(musicXml);
  const value = match?.[1]?.replace(/<[^>]+>/g, "").trim();
  return value ? decodeXmlText(value) : undefined;
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
