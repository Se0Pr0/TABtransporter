import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { OpenedScoreFile } from "../shared/types";

export async function readScoreFile(path: string): Promise<OpenedScoreFile> {
  const extension = extname(path).toLowerCase();
  const data = await readFile(path);
  const mime = extension === ".pdf" ? "application/pdf" : imageMime(extension);

  return {
    path,
    name: path.split(/[\\/]/).pop() ?? "악보",
    kind: extension === ".pdf" ? "pdf" : "image",
    dataUrl: `data:${mime};base64,${data.toString("base64")}`
  };
}

export function imageMime(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

export function ensureExtension(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
}
