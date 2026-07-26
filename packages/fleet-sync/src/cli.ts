#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import {
  backoffActive,
  type FleetCatalog,
  FleetSyncError,
  pull,
  push,
  recordError,
  recordSuccess,
  resolvePolicy,
  scan,
  status,
  verify,
  withHostLock,
} from "./core";
import { installUserTimer, uninstallUserTimer } from "./schedule";

const COMMANDS = new Set(["scan", "push", "pull", "status", "verify", "install-user-timer", "uninstall-user-timer"]);

type Arguments = {
  command: string;
  manifest: string;
  host: string;
  peer?: string;
  all: boolean;
  pullAfter: boolean;
  scheduled: boolean;
  loop: boolean;
  dryRun: boolean;
  outDir?: string;
  jitterSeconds: number;
};

function parseArguments(argv: string[]): Arguments {
  const command = argv[0] ?? "status";
  if (!COMMANDS.has(command)) throw new FleetSyncError(`Unknown command: ${command}`, "USAGE");
  const result: Arguments = {
    command,
    manifest: process.env.FLEET_SYNC_MANIFEST ?? resolve(import.meta.dir, "../../../catalog/fleet-sync.json"),
    host: process.env.FLEET_SYNC_HOST ?? (process.platform === "darwin" ? "mac" : hostname().toLowerCase().includes("h11") ? "h11dsi" : "desktop"),
    all: false,
    pullAfter: false,
    scheduled: false,
    loop: false,
    dryRun: false,
    jitterSeconds: 0,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") result.all = true;
    else if (arg === "--pull") result.pullAfter = true;
    else if (arg === "--scheduled") result.scheduled = true;
    else if (arg === "--loop") result.loop = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--manifest") result.manifest = argv[++index] ?? "";
    else if (arg === "--host") result.host = argv[++index] ?? "";
    else if (arg === "--peer") result.peer = argv[++index];
    else if (arg === "--out-dir") result.outDir = argv[++index];
    else if (arg === "--jitter-seconds") result.jitterSeconds = Number(argv[++index] ?? "0");
    else throw new FleetSyncError(`Unknown option: ${arg}`, "USAGE");
  }
  if (!result.manifest || !result.host || !Number.isFinite(result.jitterSeconds) || result.jitterSeconds < 0) {
    throw new FleetSyncError("Invalid command arguments", "USAGE");
  }
  return result;
}

async function executeOnce(args: Arguments): Promise<unknown> {
  const catalog = JSON.parse(await readFile(args.manifest, "utf8")) as FleetCatalog;
  const policy = resolvePolicy(catalog, args.host);
  if (args.command === "install-user-timer") {
    return installUserTimer(policy, process.execPath, import.meta.path, args.manifest, { dryRun: args.dryRun, outDir: args.outDir });
  }
  if (args.command === "uninstall-user-timer") return uninstallUserTimer({ dryRun: args.dryRun, outDir: args.outDir });
  if (args.command === "scan") return scan(policy);
  if (args.command === "status") return status(policy);
  if (args.command === "verify") return verify(policy);
  if (args.scheduled) {
    const backoff = await backoffActive(policy);
    if (backoff.active) return { skipped: "backoff", nextAttemptAt: backoff.nextAttemptAt };
  }
  if (args.jitterSeconds > 0) await Bun.sleep(Math.floor(Math.random() * (args.jitterSeconds + 1)) * 1000);
  return withHostLock(policy, async () => {
    try {
      let result: unknown;
      if (args.command === "pull") result = await pull(policy);
      else {
        const peerIds = args.all ? policy.peers.map((peer) => peer.id) : [args.peer ?? policy.peers[0]?.id].filter((value): value is string => Boolean(value));
        if (peerIds.length === 0) throw new FleetSyncError("Push requires --peer or at least one configured peer", "PEER");
        const pushes = [];
        for (const peerId of peerIds) pushes.push(await push(policy, peerId));
        const pulled = args.pullAfter ? await pull(policy) : null;
        result = { pushes, pulled };
      }
      await recordSuccess(policy);
      return result;
    } catch (error) {
      await recordError(policy, args.command, error);
      throw error;
    }
  });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  do {
    const result = await executeOnce(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!args.loop) break;
    const catalog = JSON.parse(await readFile(args.manifest, "utf8")) as FleetCatalog;
    const policy = resolvePolicy(catalog, args.host);
    await Bun.sleep(policy.schedule.intervalSeconds * 1000);
  } while (true);
}

await main().catch((error: unknown) => {
  const code = error instanceof FleetSyncError ? error.code : "UNEXPECTED";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: code, message })}\n`);
  process.exitCode = 1;
});
