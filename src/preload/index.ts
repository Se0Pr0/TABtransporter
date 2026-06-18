import { contextBridge, ipcRenderer } from "electron";
import type { AudiverisStatus, ConversionResult, ExportRequest, ExportResult, OpenedScoreFile } from "../shared/types";

export interface TabTransporterApi {
  openScoreFile(): Promise<OpenedScoreFile | undefined>;
  convertScoreFile(sourcePath: string): Promise<ConversionResult>;
  getAudiverisStatus(): Promise<AudiverisStatus>;
  installAudiveris(): Promise<AudiverisStatus>;
  exportCurrentView(request: ExportRequest): Promise<ExportResult>;
}

const api: TabTransporterApi = {
  openScoreFile: () => ipcRenderer.invoke("score:open"),
  convertScoreFile: (sourcePath) => ipcRenderer.invoke("score:convert", sourcePath),
  getAudiverisStatus: () => ipcRenderer.invoke("audiveris:status"),
  installAudiveris: () => ipcRenderer.invoke("audiveris:install"),
  exportCurrentView: (request) => ipcRenderer.invoke("export:save", request)
};

contextBridge.exposeInMainWorld("tabTransporter", api);
