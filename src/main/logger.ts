import { appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LogInfo {
  directory: string;
  appLogFile: string;
}

let logDirectory = join(tmpdir(), "TABtransporter", "logs");

export function setLogDirectory(directory: string): void {
  logDirectory = directory;
}

export function getLogInfo(): LogInfo {
  return {
    directory: logDirectory,
    appLogFile: join(logDirectory, `tabtransporter-${dateStamp()}.log`)
  };
}

export async function writeAppLog(scope: string, message: string, data?: unknown): Promise<void> {
  const { appLogFile } = getLogInfo();
  const line = formatLogLine(scope, message, data);
  await appendLogFile(appLogFile, line);
}

export async function createRunLogFile(prefix: string, label: string): Promise<string> {
  await mkdir(logDirectory, { recursive: true });
  return join(logDirectory, `${prefix}-${fileStamp()}-${sanitizeFileLabel(label)}.log`);
}

export async function appendLogFile(filePath: string, text: string): Promise<void> {
  await mkdir(logDirectory, { recursive: true });
  await appendFile(filePath, text, "utf8");
}

export async function readLogTail(filePath: string, maxLines = 80): Promise<string[]> {
  const text = await readFile(filePath, "utf8");
  return tailLines(text, maxLines);
}

export function tailLines(text: string, maxLines: number): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines);
}

function formatLogLine(scope: string, message: string, data?: unknown): string {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  return `[${new Date().toISOString()}] [${scope}] ${message}${suffix}\n`;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileStamp(): string {
  return new Date().toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeFileLabel(label: string): string {
  const sanitized = label.replace(/[^a-zA-Z0-9가-힣._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.slice(0, 80) || "run";
}
