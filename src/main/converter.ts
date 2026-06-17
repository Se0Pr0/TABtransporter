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
      message: "No local Audiveris executable was found. The app kept a clearly marked demo score so the workflow can be tested.",
      score: createDemoScore(),
      diagnostics: [
        "Set AUDIVERIS_BIN to an Audiveris executable or install a supported local converter.",
        "No OMR result was treated as final score data."
      ]
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), "tabtransporter-omr-"));

  try {
    diagnostics.push(`Using Audiveris executable: ${audiverisPath}`);
    diagnostics.push(`Working directory: ${workDir}`);

    await runAudiveris(audiverisPath, sourcePath, workDir);
    const output = await findMusicXml(workDir);

    if (!output) {
      return {
        status: "failed",
        sourcePath,
        message: "Audiveris finished but no MusicXML output was found.",
        diagnostics
      };
    }

    return {
      status: "converted",
      sourcePath,
      musicXmlPath: output,
      message: `Converted ${basename(sourcePath)} to MusicXML.`,
      diagnostics
    };
  } catch (error) {
    return {
      status: "failed",
      sourcePath,
      message: error instanceof Error ? error.message : "Unknown OMR failure.",
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
      reject(new Error("Audiveris conversion timed out."));
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
      reject(new Error(stderr.trim() || `Audiveris exited with code ${code}.`));
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
