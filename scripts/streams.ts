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

interface StreamConfig {
  services: Record<string, ServiceConfig>;
}

interface Registry {
  streams: Record<string, StreamConfig>;
}

const root = resolve(import.meta.dir, "..");
const registryPath = resolve(root, "services.yml");
const registry = Bun.YAML.parse(await Bun.file(registryPath).text()) as Registry;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("usage: streams.ts up <stream|all> [--dry] | down <stream> | status [stream] | logs <stream> [service] | attach <stream>");
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

function startWindow(streamName: string, serviceName: string, service: ServiceConfig): void {
  const session = `svc-${streamName}`;
  const cwd = resolve(root, service.cwd);
  mkdirSync(resolve(root, "local/services", streamName), { recursive: true });
  const shellCommand = tmuxCommand(streamName, serviceName, service);
  const hasSession = tmuxOk(["has-session", "-t", session]);
  const windows = hasSession ? new TextDecoder().decode(run(["tmux", "list-windows", "-t", session, "-F", "#{window_name}"]).stdout).split("\n") : [];
  const hasWindow = windows.includes(serviceName);
  let result: Bun.SpawnSyncReturns<Uint8Array>;
  if (!hasSession) {
    result = run(["tmux", "new-session", "-d", "-s", session, "-n", serviceName, "-c", cwd, "bash", "-lc", shellCommand]);
    if (result.exitCode === 0) run(["tmux", "set-option", "-t", session, "remain-on-exit", "on"]);
  } else if (hasWindow) {
    result = run(["tmux", "respawn-window", "-k", "-t", `${session}:${serviceName}`, "-c", cwd, "bash", "-lc", shellCommand]);
  } else {
    result = run(["tmux", "new-window", "-d", "-t", session, "-n", serviceName, "-c", cwd, "bash", "-lc", shellCommand]);
  }
  // Login shells auto-rename windows (to the hostname), breaking the
  // has-session -t session:window ownership probe. Pin the name.
  if (result.exitCode === 0) {
    run(["tmux", "set-option", "-w", "-t", `${session}:${serviceName}`, "automatic-rename", "off"]);
    run(["tmux", "set-option", "-w", "-t", `${session}:${serviceName}`, "allow-rename", "off"]);
    run(["tmux", "rename-window", "-t", `${session}:${serviceName}`, serviceName]);
  }
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim());
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
    for (const serviceName of topoOrder(streamName, stream)) {
      const service = stream.services[serviceName];
      const ok = await healthy(service.health);
      const ownership = service.shared ? "shared" : tmuxOk(["has-session", "-t", `svc-${streamName}:${serviceName}`]) ? "tmux" : "external/down";
      console.log(`  ${serviceName.padEnd(20)} ${ok ? "healthy" : "down"} (${ownership})`);
    }
  }
}

function down(streamName: string): void {
  streamNamed(streamName);
  const session = `svc-${streamName}`;
  if (!tmuxOk(["has-session", "-t", session])) {
    console.log(`${streamName}: already down (shared services left running)`);
    return;
  }
  const result = run(["tmux", "kill-session", "-t", session]);
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
      down(name);
      break;
    case "status":
      await status(name);
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
