import { type JimengSessionBundle } from "./capture"

export interface JimengBrowserSessionOptions {
  cdpUrl: string
  targetUrl?: string
}

interface CdpCookie {
  name?: string
  value?: string
  domain?: string
}

export async function loadJimengSessionFromBrowser(options: JimengBrowserSessionOptions): Promise<JimengSessionBundle> {
  const puppeteer = await import("puppeteer-core")
  const browser = await puppeteer.connect({ browserURL: options.cdpUrl })

  try {
    const pages = await browser.pages()
    const targetNeedle = options.targetUrl ?? "jimeng.jianying.com"
    const page = pages.find((candidate) => candidate.url().includes(targetNeedle))
      ?? pages.find((candidate) => candidate.url().includes("jimeng.jianying.com"))

    if (!page) {
      throw new Error(`No Jimeng page found in browser at ${options.cdpUrl}. Open the dedicated Jimeng profile first.`)
    }

    const client = await page.target().createCDPSession()
    await client.send("Network.enable")
    const cookieResult = await client.send("Network.getAllCookies") as { cookies?: CdpCookie[] }
    const cookies = cookieResult.cookies ?? []
    const cookie = cookies
      .filter((entry) => typeof entry.name === "string" && typeof entry.value === "string" && typeof entry.domain === "string")
      .filter((entry) => entry.domain!.includes("jianying.com") || entry.domain!.includes("dreamina") || entry.domain!.includes("bytedance"))
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ")

    if (!cookie) {
      throw new Error(`No Jimeng cookies found in browser at ${options.cdpUrl}. Refresh/login in the dedicated profile first.`)
    }

    const userAgent = await page.evaluate(() => navigator.userAgent)
    const referer = page.url()
    return {
      cookie,
      userAgent,
      origin: "https://jimeng.jianying.com",
      referer,
      capturedAtIso: new Date().toISOString(),
    }
  } finally {
    await browser.disconnect()
  }
}
