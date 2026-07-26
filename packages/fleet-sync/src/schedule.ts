import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Policy, Schedule } from "./core";

export type TimerArtifacts = {
  schedule: Schedule;
  launchd: { path: string; contents: string };
  systemdService: { path: string; contents: string };
  systemdTimer: { path: string; contents: string };
};

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderTimerArtifacts(policy: Policy, executable: string, entrypoint: string, manifestPath: string): TimerArtifacts {
  const args = [
    executable,
    entrypoint,
    "push",
    "--all",
    "--pull",
    "--scheduled",
    "--manifest",
    manifestPath,
    "--host",
    policy.hostId,
  ];
  const launchdArgs = [...args, "--jitter-seconds", String(policy.schedule.jitterSeconds)];
  const plistArguments = launchdArgs.map((arg) => `      <string>${xml(arg)}</string>`).join("\n");
  const launchd = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wirebabel.fleet-sync</string>
  <key>ProgramArguments</key>
  <array>
${plistArguments}
  </array>
  <key>StartInterval</key><integer>${policy.schedule.intervalSeconds}</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xml(join(policy.stateRoot, "timer.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(policy.stateRoot, "timer.log"))}</string>
</dict>
</plist>
`;
  const quotedArgs = args.map((arg) => JSON.stringify(arg)).join(" ");
  const service = `[Unit]
Description=Immutable fleet state replication

[Service]
Type=oneshot
ExecStart=${quotedArgs}
Nice=10
IOSchedulingClass=idle
`;
  const timer = `[Unit]
Description=Run immutable fleet replication every ${policy.schedule.intervalSeconds} seconds

[Timer]
OnBootSec=${policy.schedule.intervalSeconds}s
OnUnitActiveSec=${policy.schedule.intervalSeconds}s
RandomizedDelaySec=${policy.schedule.jitterSeconds}s
Persistent=true
Unit=fleet-sync.service

[Install]
WantedBy=timers.target
`;
  return {
    schedule: policy.schedule,
    launchd: { path: "com.wirebabel.fleet-sync.plist", contents: launchd },
    systemdService: { path: "fleet-sync.service", contents: service },
    systemdTimer: { path: "fleet-sync.timer", contents: timer },
  };
}

async function run(command: string, args: string[]): Promise<void> {
  const processHandle = Bun.spawn([command, ...args], { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(processHandle.stderr).text();
  const code = await processHandle.exited;
  if (code !== 0) throw new Error(`${command} failed (${code}): ${stderr.trim()}`);
}

export async function installUserTimer(
  policy: Policy,
  executable: string,
  entrypoint: string,
  manifestPath: string,
  options: { dryRun: boolean; outDir?: string },
): Promise<{ platform: "launchd" | "systemd-user"; files: string[]; dryRun: boolean }> {
  const artifacts = renderTimerArtifacts(policy, executable, entrypoint, manifestPath);
  if (process.platform === "darwin") {
    const root = options.outDir ?? join(process.env.HOME ?? "", "Library", "LaunchAgents");
    const path = join(root, artifacts.launchd.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, artifacts.launchd.contents);
    if (!options.dryRun) {
      const domain = `gui/${process.getuid?.() ?? 0}`;
      await run("launchctl", ["bootout", domain, path]).catch(() => undefined);
      await run("launchctl", ["bootstrap", domain, path]);
    }
    return { platform: "launchd", files: [path], dryRun: options.dryRun };
  }
  const root = options.outDir ?? join(process.env.HOME ?? "", ".config", "systemd", "user");
  const servicePath = join(root, artifacts.systemdService.path);
  const timerPath = join(root, artifacts.systemdTimer.path);
  await mkdir(root, { recursive: true });
  await writeFile(servicePath, artifacts.systemdService.contents);
  await writeFile(timerPath, artifacts.systemdTimer.contents);
  if (!options.dryRun) {
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "enable", "--now", "fleet-sync.timer"]);
  }
  return { platform: "systemd-user", files: [servicePath, timerPath], dryRun: options.dryRun };
}

export async function uninstallUserTimer(options: { dryRun: boolean; outDir?: string }): Promise<{ platform: "launchd" | "systemd-user"; files: string[]; dryRun: boolean }> {
  if (process.platform === "darwin") {
    const root = options.outDir ?? join(process.env.HOME ?? "", "Library", "LaunchAgents");
    const path = join(root, "com.wirebabel.fleet-sync.plist");
    if (!options.dryRun) {
      await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, path]).catch(() => undefined);
      await rm(path, { force: true });
    }
    return { platform: "launchd", files: [path], dryRun: options.dryRun };
  }
  const root = options.outDir ?? join(process.env.HOME ?? "", ".config", "systemd", "user");
  const files = [join(root, "fleet-sync.service"), join(root, "fleet-sync.timer")];
  if (!options.dryRun) {
    await run("systemctl", ["--user", "disable", "--now", "fleet-sync.timer"]).catch(() => undefined);
    await Promise.all(files.map((path) => rm(path, { force: true })));
    await run("systemctl", ["--user", "daemon-reload"]);
  }
  return { platform: "systemd-user", files, dryRun: options.dryRun };
}
