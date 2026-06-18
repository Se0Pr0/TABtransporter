import { contextBridge, ipcRenderer } from "electron";
import type {
  AudiverisStatus,
  ConversionResult,
  ExportRequest,
  ExportResult,
  LogInfo,
  OmrProgress,
  OpenedScoreFile
} from "../shared/types";

export interface TabTransporterApi {
  openScoreFile(): Promise<OpenedScoreFile | undefined>;
  convertScoreFile(sourcePath: string): Promise<ConversionResult>;
  getAudiverisStatus(): Promise<AudiverisStatus>;
  installAudiveris(): Promise<AudiverisStatus>;
  getLogInfo(): Promise<LogInfo>;
  openLogFolder(): Promise<{ status: "opened" | "failed"; message: string }>;
  onOmrProgress(callback: (progress: OmrProgress) => void): () => void;
  exportCurrentView(request: ExportRequest): Promise<ExportResult>;
}

const api: TabTransporterApi = {
  openScoreFile: () => ipcRenderer.invoke("score:open"),
  convertScoreFile: (sourcePath) => ipcRenderer.invoke("score:convert", sourcePath),
  getAudiverisStatus: () => ipcRenderer.invoke("audiveris:status"),
  installAudiveris: () => ipcRenderer.invoke("audiveris:install"),
  getLogInfo: () => ipcRenderer.invoke("logs:info"),
  openLogFolder: () => ipcRenderer.invoke("logs:openFolder"),
  onOmrProgress: (callback) => {
    const listener = (_event: unknown, progress: OmrProgress) => callback(progress);
    ipcRenderer.on("omr:progress", listener);
    return () => ipcRenderer.off("omr:progress", listener);
  },
  exportCurrentView: (request) => ipcRenderer.invoke("export:save", request)
};

contextBridge.exposeInMainWorld("tabTransporter", api);
