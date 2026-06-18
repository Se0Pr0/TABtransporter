import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import type { ConversionResult } from "../shared/types";
import { createDemoScore } from "../shared/score";

const AUDIVERIS_TIMEOUT_MS = 180_000;

export async function convertWithLocalOmr(sourcePath: string): Promise<ConversionResult> {
  const audiverisPath = resolveAudiverisPath();
  const diagnostics: string[] = [];

  if (!audiverisPath) {
    return {
      status: "needs_converter",
      sourcePath,
      message: "로컬 Audiveris 실행 파일을 찾지 못했습니다. 흐름을 확인할 수 있도록 예제 악보를 표시했습니다.",
      score: createDemoScore(),
      diagnostics: [
        "AUDIVERIS_BIN 환경 변수를 Audiveris 실행 파일로 지정하거나 지원되는 로컬 변환기를 설치하세요.",
        "현재 표시된 예제는 실제 OMR 변환 결과가 아닙니다."
      ]
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), "tabtransporter-omr-"));

  try {
    diagnostics.push(`사용 중인 Audiveris 실행 파일: ${audiverisPath}`);
    diagnostics.push(`임시 작업 폴더: ${workDir}`);

    await runAudiveris(audiverisPath, sourcePath, workDir);
    const output = await findMusicXml(workDir);

    if (!output) {
      return {
        status: "failed",
        sourcePath,
        message: "Audiveris 실행은 끝났지만 MusicXML 결과 파일을 찾지 못했습니다.",
        diagnostics
      };
    }

    return {
      status: "converted",
      sourcePath,
      musicXmlPath: output,
      message: `${basename(sourcePath)} 파일을 MusicXML로 변환했습니다.`,
      diagnostics
    };
  } catch (error) {
    return {
      status: "failed",
      sourcePath,
      message: error instanceof Error ? error.message : "알 수 없는 OMR 변환 오류입니다.",
      diagnostics
    };
  } finally {
    if (process.env.TABTRANSPORTER_KEEP_OMR_TMP !== "1") {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function resolveAudiverisPath(): string | undefined {
  const explicit = process.env.AUDIVERIS_BIN;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    "C:\\Program Files\\Audiveris\\bin\\Audiveris.bat",
    "C:\\Program Files\\Audiveris\\Audiveris.exe",
    "C:\\Program Files (x86)\\Audiveris\\bin\\Audiveris.bat",
    "C:\\Program Files (x86)\\Audiveris\\Audiveris.exe"
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function runAudiveris(audiverisPath: string, sourcePath: string, outputDir: string): Promise<void> {
  const args = ["-batch", "-export", "-output", outputDir, sourcePath];

  return new Promise((resolve, reject) => {
    const child = spawn(audiverisPath, args, {
      windowsHide: true,
      shell: audiverisPath.endsWith(".bat")
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Audiveris 변환 시간이 초과되었습니다."));
    }, AUDIVERIS_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Audiveris가 코드 ${code}로 종료되었습니다.`));
    });
  });
}

async function findMusicXml(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (extension === ".xml" || extension === ".musicxml" || extension === ".mxl") {
      return join(entry.parentPath, entry.name);
    }
  }
  return undefined;
}
