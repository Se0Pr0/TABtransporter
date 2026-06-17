import { contextBridge, ipcRenderer } from "electron";
import type { ConversionResult, ExportRequest, ExportResult, OpenedScoreFile } from "../shared/types";

export interface TabTransporterApi {
  openScoreFile(): Promise<OpenedScoreFile | undefined>;
  convertScoreFile(sourcePath: string): Promise<ConversionResult>;
  exportCurrentView(request: ExportRequest): Promise<ExportResult>;
}

const api: TabTransporterApi = {
  openScoreFile: () => ipcRenderer.invoke("score:open"),
  convertScoreFile: (sourcePath) => ipcRenderer.invoke("score:convert", sourcePath),
  exportCurrentView: (request) => ipcRenderer.invoke("export:save", request)
};

contextBridge.exposeInMainWorld("tabTransporter", api);
