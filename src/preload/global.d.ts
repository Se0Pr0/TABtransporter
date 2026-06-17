import type { TabTransporterApi } from "./index";

declare global {
  interface Window {
    tabTransporter: TabTransporterApi;
  }
}

export {};
