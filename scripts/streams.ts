#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface HealthConfig {
  url?: string;
  tcpPort?: number;
  command?: string;
  timeoutSec?: number;
}

interface ServiceConfig {
  cwd: string;
  cmd: string;
  health: HealthConfig;
  dependsOn?: string[];
  env?: Record<string, string>;
  shared?: boolean;
}

interface ReviewTarget {
  name: string;
  url: string;
}

interface StreamConfig {
  services: Record<string, ServiceConfig>;
  review?: ReviewTarget[];
}

interface Registry {
  streams: Record<string, StreamConfig>;
}

const root = resolve(import.meta.dir, "..");
const registryPath = resolve(root, "services.yml");
const registry = Bun.YAML.parse(await Bun.file(registryPath).text()) as Registry;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    "usage: streams.ts up <stream|all> [--dry] | down <stream> | status [stream] | review <stream> [--no-open] | logs <stream> [service] | attach <stream>",
  );
  process.exit(2);
}

function streamNamed(name: string): StreamConfig {
  const stream = registry.streams[name];
  if (!stream) usage(`unknown stream: ${name}`);
  return stream;
}

function topoOrder(streamName: string, stream: StreamConfig): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`${streamName}: dependency cycle at ${name}`);
    const service = stream.services[name];
    if (!service) throw new Error(`${streamName}: unknown dependency ${name}`);
    visiting.add(name);
    for (const dependency of service.dependsOn ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };
  for (const name of Object.keys(stream.services)) visit(name);
  return order;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function run(command: string[]): Bun.SpawnSyncReturns<Uint8Array> {
  return Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
}

function tmuxOk(args: string[]): boolean {
  return run(["tmux", ...args]).exitCode === 0;
}

async function healthy(health: HealthConfig): Promise<boolean> {
  if (health.url) {
    try {
      const response = await fetch(health.url, { signal: AbortSignal.timeout(2_000) });
      await response.body?.cancel();
      return response.status === 200;
    } catch {
      return false;
    }
  }
  if (health.tcpPort !== undefined) {
    return run(["nc", "-z", "127.0.0.1", String(health.tcpPort)]).exitCode === 0;
  }
  if (health.command) return run(["bash", "-c", health.command]).exitCode === 0;
  throw new Error("health must define url, tcpPort, or command");
}

async function waitHealthy(streamName: string, serviceName: string, service: ServiceConfig): Promise<void> {
  const timeoutSec = service.health.timeoutSec ?? 30;
  console.log(`${streamName}/${serviceName}: waiting for health (timeout ${timeoutSec}s)`);
  const deadline = Date.now() + timeoutSec * 1_000;
  while (Date.now() < deadline) {
    if (await healthy(service.health)) {
      console.log(`${streamName}/${serviceName}: healthy`);
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${streamName}/${serviceName}: health timeout after ${timeoutSec}s`);
}

async function ensurePortless(service: ServiceConfig, dry: boolean): Promise<void> {
  if (await healthy(service.health)) {
    console.log("portless-proxy: already up");
    return;
  }
  if (dry) {
    console.log("portless-proxy: unavailable (dry run)");
    return;
  }
  console.warn("portless-proxy: unavailable; run: bunx portless proxy start");
}

function tmuxCommand(streamName: string, serviceName: string, service: ServiceConfig): string {
  const log = resolve(root, "local/services", streamName, `${serviceName}.log`);
  const env = Object.entries(service.env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  const command = env ? `${env} ${service.cmd}` : service.cmd;
  return `set -o pipefail; ${command} 2>&1 | tee -a ${shellQuote(log)}`;
}

function decodeCreatedWindowId(stdout: Uint8Array): string {
  const windowId = new TextDecoder().decode(stdout).trim();
  if (!windowId) throw new Error("tmux created a window but returned no window ID");
  return windowId;
}

function managedServiceWindows(session: string): Map<string, string> {
  const result = run(["tmux", "list-windows", "-t", session, "-F", "#{window_id}\t#{@agents_service}"]);
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  const windows = new Map<string, string>();
  for (const window of new TextDecoder().decode(result.stdout).split("\n")) {
    const separator = window.indexOf("\t");
    if (separator <= 0) continue;
    const serviceName = window.slice(separator + 1);
    if (serviceName) windows.set(serviceName, window.slice(0, separator));
  }
  return windows;
}

function startWindow(streamName: string, serviceName: string, service: ServiceConfig): void {
  const session = `svc-${streamName}`;
  const cwd = resolve(root, service.cwd);
  mkdirSync(resolve(root, "local/services", streamName), { recursive: true });
  const shellCommand = tmuxCommand(streamName, serviceName, service);
  const hasSession = tmuxOk(["has-session", "-t", session]);
  let windowId = hasSession ? managedServiceWindows(session).get(serviceName) : undefined;

  let result: Bun.SpawnSyncReturns<Uint8Array>;
  if (!hasSession) {
    result = run([
      "tmux",
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-s",
      session,
      "-n",
      serviceName,
      "-c",
      cwd,
      "bash",
      "-c",
      shellCommand,
    ]);
    if (result.exitCode === 0) {
      run(["tmux", "set-option", "-t", session, "remain-on-exit", "on"]);
      windowId = decodeCreatedWindowId(result.stdout);
    }
  } else if (windowId) {
    result = run(["tmux", "respawn-window", "-k", "-t", windowId, "-c", cwd, "bash", "-c", shellCommand]);
  } else {
    result = run([
      "tmux",
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      session,
      "-n",
      serviceName,
      "-c",
      cwd,
      "bash",
      "-c",
      shellCommand,
    ]);
    if (result.exitCode === 0) windowId = decodeCreatedWindowId(result.stdout);
  }
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  const tagResult = run(["tmux", "set-option", "-w", "-t", windowId!, "@agents_service", serviceName]);
  if (tagResult.exitCode !== 0) throw new Error(new TextDecoder().decode(tagResult.stderr).trim());
}

async function upOne(streamName: string, dry: boolean): Promise<void> {
  const stream = streamNamed(streamName);
  const order = topoOrder(streamName, stream);
  if (dry) console.log(`${streamName}: plan ${order.join(" -> ")}`);
  for (const serviceName of order) {
    const service = stream.services[serviceName];
    if (service.shared) {
      await ensurePortless(service, dry);
      continue;
    }
    if (await healthy(service.health)) {
      console.log(`${streamName}/${serviceName}: already up`);
      continue;
    }
    if (dry) {
      console.log(`${streamName}/${serviceName}: would start`);
      continue;
    }
    console.log(`${streamName}/${serviceName}: starting in tmux svc-${streamName}:${serviceName}`);
    startWindow(streamName, serviceName, service);
    await waitHealthy(streamName, serviceName, service);
  }
}

async function status(streamFilter?: string): Promise<void> {
  const names = streamFilter ? [streamFilter] : Object.keys(registry.streams);
  for (const streamName of names) {
    const stream = streamNamed(streamName);
    console.log(`${streamName}:`);
    const session = `svc-${streamName}`;
    const managedWindows = tmuxOk(["has-session", "-t", session])
      ? managedServiceWindows(session)
      : new Map<string, string>();
    for (const serviceName of topoOrder(streamName, stream)) {
      const service = stream.services[serviceName];
      const ok = await healthy(service.health);
      const ownership = service.shared ? "shared" : managedWindows.has(serviceName) ? "tmux" : "external/down";
      console.log(`  ${serviceName.padEnd(20)} ${ok ? "healthy" : "down"} (${ownership})`);
    }
  }
}

async function probeReviewUrl(streamName: string, target: ReviewTarget): Promise<void> {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new Error(`${streamName}: invalid review URL for ${target.name}: ${target.url}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${streamName}: review URL for ${target.name} must use HTTP or HTTPS: ${target.url}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      tls:
        url.protocol === "https:" && url.hostname.endsWith(".localhost")
          ? { rejectUnauthorized: false }
          : undefined,
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`${streamName}: review URL unavailable for ${target.name}: ${target.url}${detail}`);
  }
  await response.body?.cancel();
  if (response.status !== 200) {
    throw new Error(`${streamName}: review URL returned HTTP ${response.status} for ${target.name}: ${target.url}`);
  }
}

async function review(streamName: string, noOpen: boolean): Promise<void> {
  const stream = streamNamed(streamName);
  const targets = stream.review;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(
      `${streamName}: no review URLs configured; add an ordered review list of {name, url} entries to services.yml`,
    );
  }
  for (const target of targets) {
    if (!target || typeof target.name !== "string" || !target.name || typeof target.url !== "string" || !target.url) {
      throw new Error(`${streamName}: each services.yml review entry must define non-empty name and url strings`);
    }
  }

  await upOne(streamName, false);
  for (const target of targets) await probeReviewUrl(streamName, target);
  for (const target of targets) console.log(`${target.name}: ${target.url}`);

  if (process.platform !== "darwin" || noOpen || "CI" in process.env) return;
  const primary = targets[0];
  const result = Bun.spawnSync(["open", primary.url], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const detail = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${streamName}: failed to open primary review URL${detail ? `: ${detail}` : ""}`);
  }
}

async function down(streamName: string): Promise<void> {
  const stream = streamNamed(streamName);
  const session = `svc-${streamName}`;
  if (!tmuxOk(["has-session", "-t", session])) {
    console.log(`${streamName}: already down (shared services left running)`);
    return;
  }

  const managedWindows = managedServiceWindows(session);
  const ownedWindows = [...topoOrder(streamName, stream)].reverse().flatMap((serviceName) => {
    if (stream.services[serviceName].shared) return [];
    const windowId = managedWindows.get(serviceName);
    return windowId ? ([[serviceName, windowId]] as const) : [];
  });
  const ownedServices = ownedWindows.map(([serviceName]) => serviceName);

  for (const [, windowId] of ownedWindows) {
    run(["tmux", "send-keys", "-t", windowId, "C-c"]);
  }

  const deadline = Date.now() + 5_000;
  const pollIntervalMs = 250;
  const requiredDownSamples = 3;
  const consecutiveDownSamples = new Map(ownedServices.map((serviceName) => [serviceName, 0] as const));
  let stillHealthy = ownedServices;
  while (stillHealthy.length > 0) {
    const checks = await Promise.all(
      stillHealthy.map(async (serviceName) => [serviceName, await healthy(stream.services[serviceName].health)] as const),
    );
    stillHealthy = checks.flatMap(([serviceName, isHealthy]) => {
      if (isHealthy) {
        consecutiveDownSamples.set(serviceName, 0);
        return [serviceName];
      }
      const downSamples = (consecutiveDownSamples.get(serviceName) ?? 0) + 1;
      consecutiveDownSamples.set(serviceName, downSamples);
      return downSamples >= requiredDownSamples ? [] : [serviceName];
    });
    const remainingMs = deadline - Date.now();
    if (stillHealthy.length === 0 || remainingMs <= 0) break;
    await Bun.sleep(Math.min(pollIntervalMs, remainingMs));
  }

  const result = run(["tmux", "kill-session", "-t", session]);
  if (stillHealthy.length > 0) {
    const cleanupError =
      result.exitCode === 0 ? "" : `; tmux cleanup failed: ${new TextDecoder().decode(result.stderr).trim()}`;
    throw new Error(`${streamName}: still healthy after shutdown grace: ${stillHealthy.join(", ")}${cleanupError}`);
  }
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
  console.log(`${streamName}: stopped tmux session ${session} (shared services left running)`);
}

function logs(streamName: string, serviceName?: string): never {
  const stream = streamNamed(streamName);
  const selected = serviceName ?? [...topoOrder(streamName, stream)].reverse().find((name) => !stream.services[name].shared);
  if (!selected || !stream.services[selected]) usage(`unknown service: ${serviceName ?? ""}`);
  const path = resolve(root, "local/services", streamName, `${selected}.log`);
  console.log(`${streamName}/${selected}: following ${path} (Ctrl-C to stop)`);
  const child = Bun.spawnSync(["tail", "-f", path], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(child.exitCode);
}

function attach(streamName: string): never {
  streamNamed(streamName);
  const session = `svc-${streamName}`;
  if (!tmuxOk(["has-session", "-t", session])) usage(`${streamName}: tmux session is not running`);
  const child = Bun.spawnSync(["tmux", "attach-session", "-t", session], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(child.exitCode);
}

const [command, name, extra] = process.argv.slice(2);
try {
  switch (command) {
    case "up": {
      if (!name) usage();
      const dry = process.argv.slice(3).includes("--dry");
      const names = name === "all" ? Object.keys(registry.streams) : [name];
      for (const streamName of names) await upOne(streamName, dry);
      break;
    }
    case "down":
      if (!name) usage();
      await down(name);
      break;
    case "status":
      await status(name);
      break;
    case "review":
      if (!name) usage();
      await review(name, process.argv.slice(3).includes("--no-open"));
      break;
    case "logs":
      if (!name) usage();
      logs(name, extra);
      break;
    case "attach":
      if (!name) usage();
      attach(name);
      break;
    default:
      usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
