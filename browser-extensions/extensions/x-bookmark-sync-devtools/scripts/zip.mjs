import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const artifactsDir = path.join(root, "artifacts");
mkdirSync(artifactsDir, { recursive: true });

const out = path.join(artifactsDir, "x-bookmark-sync-devtools.zip");
rmSync(out, { force: true });

const result = spawnSync("zip", ["-r", out, "."], {
  cwd: dist,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(out);
