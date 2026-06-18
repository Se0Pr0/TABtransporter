import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportRequest, ExportResult, OpenedScoreFile } from "../shared/types";
import { convertWithLocalOmr } from "./converter";
import { ensureExtension, readScoreFile } from "./fileAccess";

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
      preload: join(__dirname, "../preload/index.mjs"),
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
      title: "악보 PDF 또는 이미지 열기",
      properties: ["openFile"],
      filters: [
        { name: "PDF 및 이미지", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "bmp"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }
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
      return { status: "failed", message: "내보낼 활성 창이 없습니다." };
    }

    const extension = request.format === "pdf" ? "pdf" : "png";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `${request.format.toUpperCase()}로 내보내기`,
      defaultPath: join(app.getPath("desktop"), ensureExtension(request.defaultFileName, extension)),
      filters: [{ name: request.format.toUpperCase(), extensions: [extension] }]
    });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled", message: "내보내기를 취소했습니다." };
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

      return { status: "saved", path: result.filePath, message: `${result.filePath}에 저장했습니다.` };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : "알 수 없는 내보내기 오류입니다."
      };
    }
  });
}
