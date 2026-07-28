#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const PROOF_TIMEOUT_MS = 45_000;
const EXIT_TIMEOUT_MS = 15_000;

interface Revision {
	readonly label: "A" | "B";
	readonly specifier: string;
	readonly cacheKey: string;
}

interface Marker {
	readonly revision: "A" | "B";
	readonly pid: number;
	readonly sessionId: string;
	readonly viewId: string;
	readonly epoch: number;
}
type PipedSubprocess = Bun.Subprocess<"pipe", "pipe", "pipe">;

function revisionSource(label: Revision["label"]): string {
	const encodedLabel = JSON.stringify(label);
	return `const revision = ${encodedLabel};
let active = false;
let pending = false;
let input = "";

function emit(text) {
\tprocess.stdout.write(text + "\\r\\n");
}

function marker() {
\tconst snapshot = controller.snapshot();
\temit("OMP_PTY_PROOF " + JSON.stringify({
\t\trevision,
\t\tpid: process.pid,
\t\tsessionId: snapshot.session.sessionId,
\t\tviewId: controller.viewId,
\t\tepoch: callbacks.epoch,
\t}));
}

function fail(error) {
\temit("OMP_PTY_PROOF_ERROR " + JSON.stringify({ revision, message: String(error && error.message || error) }));
}

function stop() {
\tif (!active || pending) return;
\tpending = true;
\tvoid callbacks.requestStop().catch(error => {
\t\tpending = false;
\t\tfail(error);
\t});
}

function reload() {
\tif (!active || pending) return;
\tpending = true;
\tvoid callbacks.requestReload().catch(error => {
\t\tpending = false;
\t\tfail(error);
\t});
}

function submitLine(line) {
\tif (line === "/reload-tui") {
\t\treload();
\t\treturn;
\t}
\tif (line.startsWith("/")) {
\t\temit("OMP_PTY_PROOF_REJECTED " + JSON.stringify({ revision, command: line }));
\t}
}

function onData(chunk) {
\tconst text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
\tfor (const character of text) {
\t\tif (character === "\\u0004") {
\t\t\tstop();
\t\t\tcontinue;
\t\t}
\t\tinput += character;
\t\tif (character !== "\\r" && character !== "\\n") continue;
\t\tconst line = input.replace(/[\\r\\n]+$/g, "");
\t\tinput = "";
\t\tif (line.length > 0) submitLine(line);
\t}
}

let controller;
let callbacks;

export function createDisposableTerminalView(nextController, nextCallbacks) {
\tcontroller = nextController;
\tcallbacks = nextCallbacks;
\treturn {
\t\tasync run() {
\t\t\tif (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
\t\t\t\tthrow new Error("PTY proof revision did not receive a TTY stdin");
\t\t\t}
\t\t\tprocess.stdin.setEncoding("utf8");
\t\t\tprocess.stdin.setRawMode(true);
\t\t\tprocess.stdin.on("data", onData);
\t\t\tprocess.stdin.resume();
\t\t\tactive = true;
\t\t\tpending = false;
\t\t\tmarker();
\t\t},
\t\tasync quiesce() {
\t\t\tif (!active) return;
\t\t\tactive = false;
\t\t\tprocess.stdin.off("data", onData);
\t\t\tprocess.stdin.pause();
\t\t\tprocess.stdin.setRawMode(false);
\t\t\temit("OMP_PTY_PROOF_QUIESCED " + JSON.stringify({ revision }));
\t\t},
\t\tasync dispose() {
\t\t\tif (active) {
\t\t\t\tactive = false;
\t\t\t\tprocess.stdin.off("data", onData);
\t\t\t\tprocess.stdin.pause();
\t\t\t\tprocess.stdin.setRawMode(false);
\t\t\t}
\t\t},
\t};
}
`;
}

async function buildRevision(root: string, label: Revision["label"]): Promise<Revision> {
	const sourcePath = path.join(root, `revision-${label}.ts`);
	await Bun.write(sourcePath, revisionSource(label));
	const build = await Bun.build({
		entrypoints: [sourcePath],
		external: ["*"],
		format: "esm",
		target: "bun",
	});
	if (!build.success) {
		const details = build.logs.map(log => String(log)).join("\n");
		throw new Error(`Failed to build revision ${label}${details ? `:\n${details}` : ""}`);
	}
	if (build.outputs.length !== 1) {
		throw new Error(`Expected one output for revision ${label}, received ${build.outputs.length}`);
	}
	const contents = new Uint8Array(await build.outputs[0]!.arrayBuffer());
	const cacheKey = new Bun.CryptoHasher("sha256").update(contents).digest("hex");
	const artifactPath = path.join(root, `revision-${label}.${cacheKey}.js`);
	await Bun.write(artifactPath, contents);
	await fs.chmod(artifactPath, 0o444);
	return { label, specifier: artifactPath, cacheKey };
}

async function publishManifest(manifestPath: string, revision: Revision): Promise<void> {
	const temporaryPath = `${manifestPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
	try {
		await Bun.write(
			temporaryPath,
			`${JSON.stringify({ specifier: revision.specifier, cacheKey: revision.cacheKey }, null, "\t")}\n`,
		);
		await fs.rename(temporaryPath, manifestPath);
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}


async function writeWrapper(wrapperPath: string): Promise<void> {
	const wrapper = `#!/bin/sh
set -u
if ! before="$(stty -g)"; then
	printf 'OMP_PTY_PROOF_TERMios_ERROR=before\\r\\n'
	exit 70
fi
printf 'OMP_PTY_PROOF_TERMios_BEFORE=%s\\r\\n' "$before"
"$OMP_BUN" "$OMP_CLI" \\
	--tui-bundle-manifest "$OMP_MANIFEST" \\
	--session-dir "$OMP_SESSION_DIR" \\
	--config "$OMP_CONFIG" \\
	--no-extensions \\
	--no-skills \\
	--no-rules \\
	--no-lsp \\
	--no-title
cli_status=$?
if ! after="$(stty -g)"; then
	printf 'OMP_PTY_PROOF_TERMios_ERROR=after\\r\\n'
	exit 71
fi
printf 'OMP_PTY_PROOF_CLI_EXIT=%s\\r\\n' "$cli_status"
printf 'OMP_PTY_PROOF_TERMios_AFTER=%s\\r\\n' "$after"
exit "$cli_status"
`;
	await Bun.write(wrapperPath, wrapper);
	await fs.chmod(wrapperPath, 0o755);
}

async function writePythonBridge(bridgePath: string): Promise<void> {
	const bridge = `#!/usr/bin/env python3
import errno
import os
import pty
import select
import signal
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: pty-bridge.py WRAPPER")

child_pid, master_fd = pty.fork()
if child_pid == 0:
    os.execv("/bin/sh", ["/bin/sh", sys.argv[1]])

def forward(signum, _frame):
    try:
        os.killpg(child_pid, signum)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, forward)
signal.signal(signal.SIGINT, forward)

def write_all(fd, data):
    while data:
        try:
            count = os.write(fd, data)
        except BrokenPipeError:
            return
        data = data[count:]

stdin_open = True
master_open = True
child_status = None
while master_open:
    readers = [master_fd]
    if stdin_open:
        readers.append(0)
    ready, _, _ = select.select(readers, [], [], 0.1)
    if stdin_open and 0 in ready:
        data = os.read(0, 65536)
        if data:
            write_all(master_fd, data)
        else:
            stdin_open = False
    if master_fd in ready:
        try:
            data = os.read(master_fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                master_open = False
            else:
                raise
        else:
            if data:
                write_all(1, data)
            else:
                master_open = False
    if child_status is None:
        waited_pid, status = os.waitpid(child_pid, os.WNOHANG)
        if waited_pid == child_pid:
            child_status = status

if child_status is None:
    _, child_status = os.waitpid(child_pid, 0)
os.close(master_fd)
if os.WIFEXITED(child_status):
    raise SystemExit(os.WEXITSTATUS(child_status))
if os.WIFSIGNALED(child_status):
    raise SystemExit(128 + os.WTERMSIG(child_status))
raise SystemExit(1)
`;
	await Bun.write(bridgePath, bridge);
	await fs.chmod(bridgePath, 0o755);
}

async function waitForOutput(
	readOutput: () => string,
	wake: Set<() => void>,
	pattern: RegExp,
	label: string,
	timeoutMs: number,
): Promise<RegExpMatchArray> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const match = readOutput().match(pattern);
		if (match) return match;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
		const gate = Promise.withResolvers<void>();
		const timer = setTimeout(gate.resolve, Math.min(remaining, 250));
		wake.add(gate.resolve);
		try {
			await gate.promise;
		} finally {
			clearTimeout(timer);
			wake.delete(gate.resolve);
		}
	}
}


async function drain(
	stream: ReadableStream<Uint8Array>,
	append: (text: string) => void,
	wake: Set<() => void>,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			append(decoder.decode(next.value, { stream: true }));
			for (const resolve of wake) resolve();
		}
		const tail = decoder.decode();
		if (tail.length > 0) append(tail);
	} finally {
		reader.releaseLock();
		for (const resolve of wake) resolve();
	}
}

function decodeMarker(match: RegExpMatchArray, label: string): Marker {
	let value: unknown;
	try {
		value = JSON.parse(match[1] ?? "");
	} catch (error) {
		throw new Error(`Invalid ${label} marker JSON: ${String(error)}`);
	}
	if (typeof value !== "object" || value === null) throw new Error(`${label} marker was not an object`);
	const marker = value as Record<string, unknown>;
	if (
		(marker.revision !== "A" && marker.revision !== "B") ||
		typeof marker.pid !== "number" ||
		typeof marker.sessionId !== "string" ||
		typeof marker.viewId !== "string" ||
		typeof marker.epoch !== "number"
	) {
		throw new Error(`${label} marker had unexpected fields: ${JSON.stringify(value)}`);
	}
	return marker as unknown as Marker;
}

async function waitForExit(child: PipedSubprocess, timeoutMs: number): Promise<number> {
	const timeout = Symbol("exit-timeout");
	const gate = Promise.withResolvers<typeof timeout>();
	const timer = setTimeout(gate.resolve, timeoutMs);
	try {
		const result = await Promise.race([child.exited, gate.promise]);
		if (result === timeout) throw new Error(`Timed out waiting for PTY wrapper exit after ${timeoutMs}ms`);
		return result;
	} finally {
		clearTimeout(timer);
	}
}
async function waitForDrains(drains: readonly Promise<void>[], timeoutMs: number): Promise<void> {
	const timeout = Symbol("drain-timeout");
	const gate = Promise.withResolvers<typeof timeout>();
	const timer = setTimeout(gate.resolve, timeoutMs);
	try {
		await Promise.race([Promise.allSettled(drains), gate.promise]);
	} finally {
		clearTimeout(timer);
	}
}

async function main(): Promise<void> {
	const packageRoot = path.resolve(import.meta.dir, "../..");
	const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-disposable-pty-proof-"));
	let child: PipedSubprocess | undefined;
	let drains: Promise<void>[] = [];
	let stdout = "";
	let stderr = "";
	const wake = new Set<() => void>();
	const appendStdout = (text: string): void => {
		stdout += text;
	};
	const appendStderr = (text: string): void => {
		stderr += text;
	};
	const transcript = (): string => `${stdout}\n[stderr]\n${stderr}`;

	try {
		const revisionsRoot = path.join(temporaryRoot, "revisions");
		const sessionDir = path.join(temporaryRoot, "sessions");
		const homeDir = path.join(temporaryRoot, "home");
		const manifestPath = path.join(temporaryRoot, "tui-manifest.json");
		const configPath = path.join(temporaryRoot, "config.yml");
		const wrapperPath = path.join(temporaryRoot, "pty-wrapper.sh");
		const bridgePath = path.join(temporaryRoot, "pty-bridge.py");
		await fs.mkdir(revisionsRoot, { recursive: true });
		await fs.mkdir(homeDir, { recursive: true });
		await fs.mkdir(sessionDir, { recursive: true });
		await Bun.write(configPath, "startup:\n  checkUpdate: false\n  quiet: true\n");

		const revisionA = await buildRevision(revisionsRoot, "A");
		const revisionB = await buildRevision(revisionsRoot, "B");
		await publishManifest(manifestPath, revisionA);
		await writeWrapper(wrapperPath);
		await writePythonBridge(bridgePath);

		const env = {
			...process.env,
			COLORTERM: "",
			HOME: homeDir,
			NO_COLOR: "1",
			OMP_BUN: process.execPath,
			OMP_CLI: path.join(packageRoot, "src", "cli.ts"),
			OMP_CONFIG: configPath,
			OMP_MANIFEST: manifestPath,
			OMP_SESSION_DIR: sessionDir,
			PI_CODING_AGENT_DIR: path.join(temporaryRoot, "agent"),
			PI_NO_TITLE: "1",
			TERM: "xterm-256color",
			XDG_CONFIG_HOME: path.join(temporaryRoot, "xdg-config"),
		};
		child = Bun.spawn(["python3", bridgePath, wrapperPath], {
			cwd: packageRoot,
			env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		drains = [
			drain(child.stdout, appendStdout, wake),
			drain(child.stderr, appendStderr, wake),
		];

		const markerPatternA = /OMP_PTY_PROOF (\{"revision":"A".*\})/;
		const markerPatternB = /OMP_PTY_PROOF (\{"revision":"B".*\})/;
		const aMarker = decodeMarker(
			await waitForOutput(() => stdout, wake, markerPatternA, "revision A marker", PROOF_TIMEOUT_MS),
			"revision A",
		);
		if (aMarker.revision !== "A") throw new Error(`Expected revision A marker, got ${aMarker.revision}`);

		await child.stdin.write("/unsupported-command\n");
		await child.stdin.flush();
		const rejectedMatch = await waitForOutput(
			() => stdout,
			wake,
			/OMP_PTY_PROOF_REJECTED (\{[^\r\n]+\})/,
			"unsupported command rejection",
			PROOF_TIMEOUT_MS,
		);
		const rejected = JSON.parse(rejectedMatch[1] ?? "") as { command?: unknown };
		if (rejected.command !== "/unsupported-command") {
			throw new Error(`Unexpected rejected command marker: ${JSON.stringify(rejected)}`);
		}

		await publishManifest(manifestPath, revisionB);
		await child.stdin.write("/reload-tui\n");
		await child.stdin.flush();
		const bMarker = decodeMarker(
			await waitForOutput(() => stdout, wake, markerPatternB, "revision B marker", PROOF_TIMEOUT_MS),
			"revision B",
		);
		if (bMarker.revision !== "B") throw new Error(`Expected revision B marker, got ${bMarker.revision}`);
		if (bMarker.pid !== aMarker.pid) {
			throw new Error(`Reload changed process authority: A pid=${aMarker.pid}, B pid=${bMarker.pid}`);
		}
		if (bMarker.sessionId !== aMarker.sessionId) {
			throw new Error(`Reload changed session authority: A session=${aMarker.sessionId}, B session=${bMarker.sessionId}`);
		}
		if (bMarker.epoch <= aMarker.epoch) {
			throw new Error(`Reload did not advance view epoch: A epoch=${aMarker.epoch}, B epoch=${bMarker.epoch}`);
		}

		await child.stdin.write(new Uint8Array([4]));
		await child.stdin.flush();
		const exitCode = await waitForExit(child, EXIT_TIMEOUT_MS);
		await Promise.all(drains);
		if (exitCode !== 0) throw new Error(`PTY wrapper exited with ${exitCode}`);

		const beforeMatch = stdout.match(/OMP_PTY_PROOF_TERMios_BEFORE=([^\r\n]+)/);
		const afterMatch = stdout.match(/OMP_PTY_PROOF_TERMios_AFTER=([^\r\n]+)/);
		const cliExitMatch = stdout.match(/OMP_PTY_PROOF_CLI_EXIT=(\d+)/);
		if (!beforeMatch || !afterMatch || !cliExitMatch) {
			throw new Error("PTY wrapper did not report termios and CLI exit markers");
		}
		if (cliExitMatch[1] !== "0") throw new Error(`CLI reported exit ${cliExitMatch[1]}`);
		if (beforeMatch[1] !== afterMatch[1]) {
			throw new Error(`PTY termios were not restored exactly: before=${beforeMatch[1]} after=${afterMatch[1]}`);
		}
		process.stdout.write(
			`disposable PTY proof passed: pid=${aMarker.pid} session=${aMarker.sessionId} termios=${beforeMatch[1]}\n`,
		);
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nPTY transcript:\n${transcript().slice(-20_000)}`, {
			cause: error,
		});
	} finally {
		if (child && child.exitCode === null) {
			child.kill("SIGTERM");
			try {
				await waitForExit(child, 1_000);
			} catch {
				child.kill("SIGKILL");
			}
		}
		await waitForDrains(drains, 2_000);
		await fs.rm(temporaryRoot, { recursive: true, force: true });
	}
}

try {
	await main();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
	process.exitCode = 1;
}
