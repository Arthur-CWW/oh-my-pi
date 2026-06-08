export interface SlotokAppInfo {
  name: string
  version: string
  platform: string
  cwd: string
}

export interface SlotokPreloadApi {
  getAppInfo: () => Promise<SlotokAppInfo>
  openExternal: (target: string) => Promise<{ ok: true }>
}
