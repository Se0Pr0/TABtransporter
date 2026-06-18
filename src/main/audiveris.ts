import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { request } from "node:https";
import type { AudiverisStatus } from "../shared/types";

export interface AudiverisInstallResult extends AudiverisStatus {
  releaseUrl?: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

const AUDIVERIS_RELEASE_API = "https://api.github.com/repos/Audiveris/audiveris/releases/latest";
const USER_AGENT = "TABtransporter-audiveris-setup";

export function resolveAudiverisPath(): string | undefined {
  const explicit = process.env.AUDIVERIS_BIN;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const pathExecutable = resolveFromPath("audiveris");
  if (pathExecutable) {
    return pathExecutable;
  }

  const candidates = [
    "C:\\Program Files\\Audiveris\\bin\\Audiveris.bat",
    "C:\\Program Files\\Audiveris\\Audiveris.exe",
    "C:\\Program Files\\Audiveris\\Audiveris.bat",
    "C:\\Program Files (x86)\\Audiveris\\bin\\Audiveris.bat",
    "C:\\Program Files (x86)\\Audiveris\\Audiveris.exe",
    "C:\\Program Files (x86)\\Audiveris\\Audiveris.bat"
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

export function getAudiverisStatus(): AudiverisStatus {
  const audiverisPath = resolveAudiverisPath();
  if (!audiverisPath) {
    return {
      installed: false,
      message: "Audiveris가 설치되어 있지 않습니다. PDF/이미지 악보 분석에는 Audiveris 설치가 필요합니다."
    };
  }

  return {
    installed: true,
    path: audiverisPath,
    version: readAudiverisVersion(audiverisPath),
    message: "Audiveris가 설치되어 있습니다."
  };
}

export async function installAudiveris(): Promise<AudiverisInstallResult> {
  const current = getAudiverisStatus();
  if (current.installed) {
    return current;
  }

  const release = await fetchJson<GitHubRelease>(AUDIVERIS_RELEASE_API);
  const asset = release.assets.find((item) => /windowsConsole-x86_64\.msi$/i.test(item.name));
  if (!asset) {
    return {
      installed: false,
      releaseUrl: release.html_url,
      message: "최신 Audiveris 릴리스에서 Windows Console MSI를 찾지 못했습니다."
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), "tabtransporter-audiveris-"));
  const installerPath = join(workDir, basename(asset.name));
  const installer = await fetchBuffer(asset.browser_download_url);
  await writeFile(installerPath, installer);

  const exitCode = await runInstaller(installerPath);
  if (exitCode !== 0) {
    return {
      installed: false,
      releaseUrl: release.html_url,
      message: `Audiveris 설치가 코드 ${exitCode}로 끝났습니다. 설치 창을 취소했거나 관리자 권한이 필요할 수 있습니다.`
    };
  }

  const next = getAudiverisStatus();
  if (!next.installed) {
    return {
      installed: false,
      releaseUrl: release.html_url,
      message: "설치 프로그램은 끝났지만 Audiveris 실행 파일을 찾지 못했습니다. AUDIVERIS_BIN 환경 변수를 확인하세요."
    };
  }
  saveAudiverisEnvironment(next.path);

  return {
    ...next,
    releaseUrl: release.html_url,
    message: `Audiveris ${release.tag_name} 설치를 확인했습니다.`
  };
}

function saveAudiverisEnvironment(audiverisPath: string | undefined): void {
  if (!audiverisPath) {
    return;
  }
  process.env.AUDIVERIS_BIN = audiverisPath;
  spawnSync("setx.exe", ["AUDIVERIS_BIN", audiverisPath], {
    windowsHide: true,
    encoding: "utf8"
  });
}

function resolveFromPath(command: string): string | undefined {
  const result = spawnSync("where.exe", [command], {
    windowsHide: true,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return undefined;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && existsSync(item));
}

function readAudiverisVersion(audiverisPath: string): string | undefined {
  const result = spawnSync(audiverisPath, ["-version"], {
    windowsHide: true,
    shell: audiverisPath.toLowerCase().endsWith(".bat"),
    encoding: "utf8",
    timeout: 10_000
  });
  if (result.status !== 0) {
    return undefined;
  }

  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.split(/\r?\n/).find((line) => /\d+\.\d+/.test(line))?.trim();
}

function runInstaller(installerPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("msiexec.exe", ["/i", installerPath, "/passive", "/norestart"], {
      windowsHide: false
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return fetchBuffer(url).then((buffer) => JSON.parse(buffer.toString("utf8")) as T);
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = request(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github+json"
        }
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          resolve(fetchBuffer(response.headers.location));
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
    req.end();
  });
}
