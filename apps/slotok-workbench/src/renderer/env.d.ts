import type { SlotokPreloadApi } from "../shared/preload-api"

declare global {
  interface Window {
    slotok?: SlotokPreloadApi
  }
}
