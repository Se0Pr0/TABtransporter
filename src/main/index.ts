import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportRequest, ExportResult, OpenedScoreFile } from "../shared/types";
import { getAudiverisStatus, installAudiveris } from "./audiveris";
import { convertWithLocalOmr } from "./converter";
import { ensureExtension, readScoreFile } from "./fileAccess";
import { getLogInfo, setLogDirectory, writeAppLog } from "./logger";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  void writeAppLog("app", "creating main window");
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

app.whenReady().then(async () => {
  setLogDirectory(join(app.getPath("userData"), "logs"));
  await writeAppLog("app", "ready", { version: app.getVersion(), packaged: app.isPackaged });
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
    await writeAppLog("file", "open dialog requested");
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
      await writeAppLog("file", "open dialog cancelled");
      return undefined;
    }

    await writeAppLog("file", "file selected", { path: result.filePaths[0] });
    return readScoreFile(result.filePaths[0]);
  });

  ipcMain.handle("score:convert", async (_event, sourcePath: string) => {
    await writeAppLog("omr", "ipc convert requested", { sourcePath });
    return convertWithLocalOmr(sourcePath, (progress) => {
      _event.sender.send("omr:progress", progress);
    });
  });

  ipcMain.handle("audiveris:status", async () => {
    await writeAppLog("audiveris", "status requested");
    return getAudiverisStatus();
  });

  ipcMain.handle("audiveris:install", async () => {
    await writeAppLog("audiveris", "install requested");
    return installAudiveris();
  });

  ipcMain.handle("logs:info", async () => {
    return getLogInfo();
  });

  ipcMain.handle("logs:openFolder", async () => {
    const info = getLogInfo();
    await writeAppLog("logs", "open folder requested", { directory: info.directory });
    const error = await shell.openPath(info.directory);
    return error ? { status: "failed", message: error } : { status: "opened", message: "로그 폴더를 열었습니다." };
  });

  ipcMain.handle("export:save", async (_event, request: ExportRequest): Promise<ExportResult> => {
    if (!mainWindow) {
      await writeAppLog("export", "save failed because main window missing", { format: request.format });
      return { status: "failed", message: "내보낼 활성 창이 없습니다." };
    }

    const extension = request.format === "pdf" ? "pdf" : "png";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `${request.format.toUpperCase()}로 내보내기`,
      defaultPath: join(app.getPath("desktop"), ensureExtension(request.defaultFileName, extension)),
      filters: [{ name: request.format.toUpperCase(), extensions: [extension] }]
    });

    if (result.canceled || !result.filePath) {
      await writeAppLog("export", "save cancelled", { format: request.format });
      return { status: "cancelled", message: "내보내기를 취소했습니다." };
    }

    let exportWindow: BrowserWindow | undefined;

    try {
      exportWindow = new BrowserWindow({
        show: false,
        width: 1200,
        height: 1600,
        backgroundColor: "#fffdf8",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(request.html)}`);

      if (request.format === "pdf") {
        const data = await exportWindow.webContents.printToPDF({
          landscape: false,
          printBackground: true,
          pageSize: "A4"
        });
        await writeFile(result.filePath, data);
      } else {
        const pageSize = (await exportWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              const body = document.body;
              const html = document.documentElement;
              resolve({
                width: Math.ceil(Math.max(body.scrollWidth, html.scrollWidth, body.offsetWidth, html.offsetWidth)),
                height: Math.ceil(Math.max(body.scrollHeight, html.scrollHeight, body.offsetHeight, html.offsetHeight))
              });
            });
          })
        `)) as { width: number; height: number };
        const width = Math.max(800, Math.min(2400, pageSize.width || 1200));
        const height = Math.max(800, Math.min(12000, pageSize.height || 1600));
        exportWindow.setContentSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const image = await exportWindow.webContents.capturePage({ x: 0, y: 0, width, height });
        await writeFile(result.filePath, image.toPNG());
      }

      await writeAppLog("export", "save completed", { format: request.format, path: result.filePath });
      return { status: "saved", path: result.filePath, message: `${result.filePath}에 저장했습니다.` };
    } catch (error) {
      await writeAppLog("export", "save failed", {
        format: request.format,
        message: error instanceof Error ? error.message : "unknown"
      });
      return {
        status: "failed",
        message: error instanceof Error ? error.message : "알 수 없는 내보내기 오류입니다."
      };
    } finally {
      exportWindow?.close();
    }
  });
}
