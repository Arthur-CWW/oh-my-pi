import { app, BrowserWindow, ipcMain, shell } from "electron"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const currentFile = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFile)

function rendererUrl(): string | undefined {
  const value = process.env.SLOTOK_RENDERER_URL?.trim()
  return value ? value : undefined
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#080807",
    title: "Slotok Workbench",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDir, "preload.js"),
    },
  })

  const devUrl = rendererUrl()
  if (devUrl) {
    await window.loadURL(devUrl)
  } else {
    await window.loadFile(join(currentDir, "..", "renderer", "index.html"))
  }

  return window
}

ipcMain.handle("slotok:get-app-info", () => ({
  name: "Slotok Workbench",
  version: app.getVersion(),
  platform: process.platform,
  cwd: process.cwd(),
}))

ipcMain.handle("slotok:open-external", async (_event, target: string) => {
  if (!target.startsWith("http://") && !target.startsWith("https://") && !target.startsWith("file://")) {
    throw new Error("Only http(s) and file URLs can be opened externally")
  }
  await shell.openExternal(target)
  return { ok: true }
})

app.whenReady().then(async () => {
  await createMainWindow()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
}).catch((error: Error) => {
  console.error(error)
  app.exit(1)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
