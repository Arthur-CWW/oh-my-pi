#!/usr/bin/env bun

const HOST = process.env.GPU_QUEUE_HOST ?? "desktop";
const REMOTE_QUEUE = "~/projects/model-bench/queue";

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(`usage:
  bun scripts/gpu-queue.ts submit --kind gpu-pose-batch --input-dir PATH --output-dir PATH [--limit N] [--overwrite]
  bun scripts/gpu-queue.ts submit --kind wilor-3d --frames-dir PATH --output-dir PATH
  bun scripts/gpu-queue.ts submit --kind gvhmr-mesh --video PATH --output-dir PATH
  bun scripts/gpu-queue.ts submit --kind generic -- COMMAND [ARG ...]
  bun scripts/gpu-queue.ts status
  bun scripts/gpu-queue.ts logs JOB_ID [--follow]
  bun scripts/gpu-queue.ts fetch JOB_ID [dest]
  bun scripts/gpu-queue.ts cancel JOB_ID [--force]`);
  process.exit(2);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function remote(script: string, args: string[], inherit = false): Promise<number> {
  const invocation = `exec ${REMOTE_QUEUE}/${script} ${args.map(shellQuote).join(" ")}`;
  const remoteCommand = `bash -lc ${shellQuote(invocation)}`;
  const proc = Bun.spawn(["ssh", "-x", "-o", "BatchMode=yes", "--", HOST, remoteCommand], {
    stdin: inherit ? "inherit" : "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

const [command, ...args] = Bun.argv.slice(2);
let exitCode: number;
switch (command) {
  case "submit": {
    const kindIndex = args.indexOf("--kind");
    if (kindIndex !== 0 || !args[1]) usage("submit requires --kind KIND");
    const kind = args[1];
    if (kind !== "gpu-pose-batch" && kind !== "wilor-3d" && kind !== "gvhmr-mesh" && kind !== "generic") usage(`unsupported kind: ${kind}`);
    const kindArgs = args.slice(2);
    if (kind === "gpu-pose-batch") {
      if (!kindArgs.includes("--input-dir") || !kindArgs.includes("--output-dir")) {
        usage("gpu-pose-batch requires --input-dir and --output-dir");
      }
    } else if (kind === "wilor-3d") {
      if (!kindArgs.includes("--frames-dir") || !kindArgs.includes("--output-dir")) {
        usage("wilor-3d requires --frames-dir and --output-dir");
      }
    } else if (kind === "gvhmr-mesh") {
      if (!kindArgs.includes("--video") || !kindArgs.includes("--output-dir")) {
        usage("gvhmr-mesh requires --video and --output-dir");
      }
    } else if (kindArgs[0] !== "--" || kindArgs.length < 2) {
      usage("generic requires argv after --");
    }
    exitCode = await remote("submit.sh", ["--kind", kind, ...kindArgs]);
    break;
  }
  case "status":
    if (args.length) usage("status takes no arguments");
    exitCode = await remote("control.sh", ["status"]);
    break;
  case "logs":
    if (!args[0] || args.length > 2 || (args[1] && args[1] !== "--follow")) usage("logs requires JOB_ID [--follow]");
    exitCode = await remote("control.sh", ["logs", ...args], args[1] === "--follow");
    break;
  case "fetch": {
    if (!args[0] || args.length > 2) usage("fetch requires JOB_ID [dest]");
    const jobId = args[0];
    if (!/^[A-Za-z0-9._-]+$/.test(jobId)) usage("fetch requires a valid JOB_ID");
    const dest = args[1] ?? `./gpu-queue-fetch/${jobId}/`;
    const findManifest = `set -euo pipefail
manifest=
for state in done failed; do
  candidate=${REMOTE_QUEUE}/$state/${shellQuote(jobId)}.json
  if [[ -f $candidate ]]; then manifest=$candidate; break; fi
done
[[ -n $manifest ]] || { printf 'job not found: %s\\n' ${shellQuote(jobId)} >&2; exit 1; }
python3 -c ${shellQuote(`import json, os, sys
job = json.load(open(sys.argv[1]))
command = job.get("command", [])
paths = []
for index, arg in enumerate(command[:-1]):
    if arg == "--output-dir":
        paths.append(os.path.expanduser(command[index + 1]))
if not paths:
    paths.append(os.path.expanduser(job["logFile"]))
for path in dict.fromkeys(paths):
    sys.stdout.buffer.write(os.fsencode(path) + b"\\0")`)} "$manifest"`;
    const lookup = Bun.spawn(["ssh", "-x", "-o", "BatchMode=yes", "--", HOST, `bash -lc ${shellQuote(findManifest)}`], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const sources = new TextDecoder().decode(await new Response(lookup.stdout).arrayBuffer()).split("\0").filter(Boolean);
    if (await lookup.exited !== 0) {
      exitCode = 1;
      break;
    }
    const mkdir = Bun.spawn(["mkdir", "-p", "--", dest], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
    if (await mkdir.exited !== 0) {
      exitCode = 1;
      break;
    }
    exitCode = 0;
    for (const source of sources) {
      const pull = Bun.spawn(["rsync", "-a", `${HOST}:${shellQuote(source)}`, `${dest}/`], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await pull.exited;
      if (code !== 0) {
        exitCode = code;
        break;
      }
    }
    break;
  }
  case "cancel":
    if (!args[0] || args.length > 2 || (args[1] && args[1] !== "--force")) usage("cancel requires JOB_ID [--force]");
    exitCode = await remote("control.sh", ["cancel", ...args]);
    break;
  default:
    usage(command ? `unknown command: ${command}` : undefined);
}
process.exit(exitCode);
