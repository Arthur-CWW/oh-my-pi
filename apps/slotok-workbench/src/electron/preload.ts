import { contextBridge, ipcRenderer } from "electron"
import type { SlotokAppInfo, SlotokPreloadApi } from "../shared/preload-api.js"

const api: SlotokPreloadApi = {
  getAppInfo: (): Promise<SlotokAppInfo> => ipcRenderer.invoke("slotok:get-app-info") as Promise<SlotokAppInfo>,
  openExternal: (target: string): Promise<{ ok: true }> => ipcRenderer.invoke("slotok:open-external", target) as Promise<{ ok: true }>,
}

contextBridge.exposeInMainWorld("slotok", api)
