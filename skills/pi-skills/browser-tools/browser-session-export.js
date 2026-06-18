#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : "output/jimeng-lab/raw/browser-session-export.json");

const browser = await puppeteer.connect({
  browserURL: "http://localhost:9222",
  defaultViewport: null,
});

const page = (await browser.pages()).at(-1);
if (!page) {
  console.error("No active tab");
  process.exit(1);
}

const cookies = await page.cookies();
const pageData = await page.evaluate(() => {
  const storageToObject = (storage) => {
    const out = {};
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      out[key] = storage.getItem(key);
    }
    return out;
  };

  return {
    href: location.href,
    origin: location.origin,
    title: document.title,
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localStorage: storageToObject(localStorage),
    sessionStorage: storageToObject(sessionStorage),
  };
});

const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

const exported = {
  captured_at: new Date().toISOString(),
  page: pageData,
  cookie_count: cookies.length,
  cookies,
  derived: {
    cookie_header: cookieHeader,
    env_hint: {
      JIMENG_COOKIE: "<cookie_header>",
      JIMENG_USER_AGENT: pageData.userAgent,
      JIMENG_ORIGIN: pageData.origin,
      JIMENG_REFERER: pageData.href,
      JIMENG_ACCEPT_LANGUAGE: pageData.language,
    },
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
console.log(`Saved session export to ${outPath}`);

await browser.disconnect();
