import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ExportRequest, ExportResult, OpenedScoreFile } from "../shared/types";
import { convertWithLocalOmr } from "./converter";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "TABtransporter",
    backgroundColor: "#f4f1ec",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle("score:open", async (): Promise<OpenedScoreFile | undefined> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Open score PDF or image",
      properties: ["openFile"],
      filters: [
        { name: "PDF and Images", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "bmp"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return readScoreFile(result.filePaths[0]);
  });

  ipcMain.handle("score:convert", async (_event, sourcePath: string) => {
    return convertWithLocalOmr(sourcePath);
  });

  ipcMain.handle("export:save", async (_event, request: ExportRequest): Promise<ExportResult> => {
    if (!mainWindow) {
      return { status: "failed", message: "No active window to export." };
    }

    const extension = request.format === "pdf" ? "pdf" : "png";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Export ${request.format.toUpperCase()}`,
      defaultPath: join(app.getPath("desktop"), ensureExtension(request.defaultFileName, extension)),
      filters: [{ name: request.format.toUpperCase(), extensions: [extension] }]
    });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled", message: "Export cancelled." };
    }

    try {
      if (request.format === "pdf") {
        const data = await mainWindow.webContents.printToPDF({
          landscape: true,
          printBackground: true,
          pageSize: "A4"
        });
        await writeFile(result.filePath, data);
      } else {
        const image = await mainWindow.webContents.capturePage();
        await writeFile(result.filePath, image.toPNG());
      }

      return { status: "saved", path: result.filePath, message: `Saved ${result.filePath}` };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown export failure."
      };
    }
  });
}

async function readScoreFile(path: string): Promise<OpenedScoreFile> {
  const extension = extname(path).toLowerCase();
  const data = await readFile(path);
  const mime = extension === ".pdf" ? "application/pdf" : imageMime(extension);

  return {
    path,
    name: path.split(/[\\/]/).pop() ?? "score",
    kind: extension === ".pdf" ? "pdf" : "image",
    dataUrl: `data:${mime};base64,${data.toString("base64")}`
  };
}

function imageMime(extension: string): string {
  switch (extension) {
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

function ensureExtension(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
}
