import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface ReadyReceipt {
	readonly kind: "headless-owner-ready";
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly socketPath: string;
	readonly pid: number;
}

interface ControllerReceipt {
	readonly sessionId: string;
	readonly transcript: string;
	readonly imageError?: { readonly name: string; readonly mimeType: string; readonly message: string };
	readonly typedInputRevision?: number;
}

const processes: Bun.Subprocess[] = [];
const roots: string[] = [];

afterEach(async () => {
	for (const processHandle of processes.splice(0)) {
		if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
		await processHandle.exited;
	}
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function readJsonLine<T>(stream: ReadableStream<Uint8Array>, timeoutMs = 20_000): Promise<T> {
	const reader = stream.getReader();
	const result = Promise.withResolvers<T>();
	const timeout = setTimeout(() => result.reject(new Error("Timed out waiting for child receipt")), timeoutMs);
	let text = "";
	void (async () => {
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) throw new Error(`Child exited before receipt: ${text}`);
				text += new TextDecoder().decode(chunk.value, { stream: true });
				const newline = text.indexOf("\n");
				if (newline >= 0) {
					result.resolve(JSON.parse(text.slice(0, newline)) as T);
					return;
				}
			}
		} catch (error) {
			result.reject(error);
		}
	})();
	try {
		return await result.promise;
	} finally {
		clearTimeout(timeout);
		try {
			reader.releaseLock();
		} catch {
			// The stream may already be closed by process exit.
		}
	}
}


const CONTROLLER_SOURCE = `
import { AttachedTerminalImageUnsupportedError } from "./src/modes/disposable-chat-view";
import { connectAttachedTerminalController } from "./src/modes/attached-terminal-mode";
const connection = await connectAttachedTerminalController(process.env.OMP_TEST_SOCKET);
let imageError;
let typedInputRevision;
if (process.env.OMP_TEST_ACTION === "write") {
  await connection.controller.submitCustomMessage({ payload: { kind: "custom", message: { customType: "remote-view-test", content: "prompt: first pasted line\\nsecond pasted line\\noutput: continuity kept", display: true, attribution: "user" }, deliverAs: "followUp", triggerTurn: false } });
  await connection.controller.refresh();
  const typed = await connection.controller.submit({ text: "prompt: first pasted line\\nsecond pasted line", deliveryClass: "followUp" });
  typedInputRevision = typed.revision;
  await connection.controller.refresh();
  const refusal = new AttachedTerminalImageUnsupportedError("image/png");
  imageError = { name: refusal.name, mimeType: refusal.mimeType, message: refusal.message };
}
const transcript = await connection.controller.formatSessionAsText({ compact: false });
console.log(JSON.stringify({ sessionId: connection.manifest.sessionId, transcript, imageError, typedInputRevision }));
if (process.env.OMP_TEST_ACTION === "write") await Promise.withResolvers().promise;
await connection.controller.close();
`;

describe("headless owner and local controller process lifecycle", () => {
	it("survives controller death and preserves continuity across reattach", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-remote-view-"));
		roots.push(root);
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		await Promise.all([fs.mkdir(home), fs.mkdir(cwd)]);
		const isolatedEnv = {
			...process.env,
			HOME: home,
			OMP_CONFIG_ROOT: path.join(root, "config"),
			OMP_SESSION_CONTROL_DB: path.join(root, "session-control.sqlite"),
			OMP_FLEET_REGISTER: "0",
			PI_NO_TITLE: "1",
			NO_COLOR: "1",
		};
		const owner = Bun.spawn(
			[
				process.execPath,
				"src/cli.ts",
				"--headless-owner",
				"--cwd",
				cwd,
				"--no-tools",
				"--no-lsp",
				"--no-extensions",
				"--no-skills",
				"--no-rules",
				"--no-title",
			],
			{ cwd: path.resolve(import.meta.dir, ".."), env: isolatedEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		processes.push(owner);
		const ownerErrors = new Response(owner.stderr).text();
		const ready = await readJsonLine<ReadyReceipt>(owner.stdout);
		expect(ready).toMatchObject({ kind: "headless-owner-ready", pid: owner.pid });

		const controllerB = Bun.spawn([process.execPath, "-e", CONTROLLER_SOURCE], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...isolatedEnv, OMP_TEST_SOCKET: ready.socketPath, OMP_TEST_ACTION: "write" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		processes.push(controllerB);
		const controllerBErrors = new Response(controllerB.stderr).text();
		const first = await readJsonLine<ControllerReceipt>(controllerB.stdout);
		expect(first.sessionId).toBe(ready.sessionId);
		expect(first.typedInputRevision).toBeGreaterThan(0);
		expect(first.transcript).toContain("prompt: first pasted line");
		expect(first.transcript).toContain("second pasted line");
		expect(first.transcript).toContain("output: continuity kept");
		expect(first.imageError).toMatchObject({
			name: "AttachedTerminalImageUnsupportedError",
			mimeType: "image/png",
		});
		expect(first.imageError?.message).toContain("content-addressed side channel");
		controllerB.kill("SIGKILL");
		await controllerB.exited;
		expect(owner.exitCode).toBeNull();

		const controllerC = Bun.spawn([process.execPath, "-e", CONTROLLER_SOURCE], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...isolatedEnv, OMP_TEST_SOCKET: ready.socketPath, OMP_TEST_ACTION: "read" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		processes.push(controllerC);
		const [continuity, controllerCExit] = await Promise.all([
			readJsonLine<ControllerReceipt>(controllerC.stdout),
			controllerC.exited,
		]);
		expect(controllerCExit).toBe(0);
		expect(continuity.sessionId).toBe(ready.sessionId);
		expect(continuity.transcript).toContain("prompt: first pasted line");
		expect(continuity.transcript).toContain("second pasted line");
		expect(continuity.transcript).toContain("output: continuity kept");
		expect(owner.exitCode).toBeNull();

		owner.kill("SIGTERM");
		expect(await owner.exited).toBe(0);
		expect(await controllerBErrors).toBe("");
		expect(await new Response(controllerC.stderr).text()).toBe("");
		expect(await ownerErrors).toBe("");
	});
});
