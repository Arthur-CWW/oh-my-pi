import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("Missing dist/manifest.json. Run pnpm build first.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredFiles = [manifest.devtools_page, manifest.background?.service_worker, "panel.html"].filter(Boolean);
const missing = requiredFiles.filter((file) => !existsSync(path.join(dist, file)));

if (manifest.manifest_version !== 3) {
  throw new Error(`Expected manifest_version 3, got ${manifest.manifest_version}`);
}

if (missing.length > 0) {
  throw new Error(`Missing files referenced by built extension: ${missing.join(", ")}`);
}

const panelHtml = await readFile(path.join(dist, "panel.html"), "utf8");
const devtoolsHtml = await readFile(path.join(dist, manifest.devtools_page), "utf8");
if (!panelHtml.includes("assets/") || !devtoolsHtml.includes("assets/")) {
  throw new Error("Built HTML does not reference Vite assets as expected.");
}

console.log(`OK ${manifest.name} ${manifest.version} (${path.relative(root, dist)})`);
