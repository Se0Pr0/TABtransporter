import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import type { ConversionResult } from "../shared/types";
import { noteNameToMidi } from "../shared/pitch";
import type { NoteEvent, ScoreModel } from "../shared/types";
import { resolveAudiverisPath } from "./audiveris";
import { appendLogFile, createRunLogFile, readLogTail, tailLines, writeAppLog } from "./logger";

const AUDIVERIS_TIMEOUT_MS = 180_000;

interface AudiverisRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logPath: string;
  timedOut: boolean;
}

export async function convertWithLocalOmr(sourcePath: string): Promise<ConversionResult> {
  const audiverisPath = resolveAudiverisPath();
  const diagnostics: string[] = [];
  await writeAppLog("omr", "conversion requested", { sourcePath });

  if (!audiverisPath) {
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
    const audiverisInputPath = await prepareAudiverisInput(sourcePath, workDir);
    diagnostics.push(`사용 중인 Audiveris 실행 파일: ${audiverisPath}`);
    diagnostics.push(`임시 작업 폴더: ${workDir}`);
    diagnostics.push(`Audiveris 입력 복사본: ${audiverisInputPath}`);

    const run = await runAudiveris(audiverisPath, audiverisInputPath, workDir, sourcePath);
    logPath = run.logPath;
    const importantLines = extractImportantAudiverisLines(`${run.stdout}\n${run.stderr}`);
    diagnostics.push(`Audiveris 로그 파일: ${run.logPath}`);

    if (run.exitCode !== 0) {
      const message = summarizeAudiverisFailure(run);
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

    const musicXml = await readMusicXmlExport(output, workDir);
    const score = parseMusicXmlToScore(musicXml, basename(sourcePath));

    if (!score.tracks.some((track) => track.notes.length > 0)) {
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
  originalSourcePath: string
): Promise<AudiverisRunResult> {
  const args = ["-batch", "-export", "-output", outputDir, sourcePath];
  const logPath = await createRunLogFile("omr", basename(originalSourcePath));
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
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      writeRunLog(text);
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
