import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { focusCmuxOwner } from "../../../src/modes/utils/cmux-owner-navigation";
import {
	acquireSessionOwnership,
	inspectLiveSessionOwnerView,
	inspectSessionOwnership,
	type SessionOwnershipHandle,
} from "../../../src/session/session-ownership";

const cleanups: Array<() => Promise<void>> = [];
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "cmux-owner-navigation-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000003",
	startedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function unixServer(
	socketPath: string,
	onLine: (line: string, socket: net.Socket) => void,
): Promise<net.Server> {
	const server = net.createServer(socket => {
		socket.setEncoding("utf8");
		let buffered = "";
		socket.on("data", chunk => {
			buffered += String(chunk);
			for (;;) {
				const newline = buffered.indexOf("\n");
				if (newline < 0) break;
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				onLine(line, socket);
			}
		});
	});
	const listening = Promise.withResolvers<void>();
	server.once("error", listening.reject);
	server.listen(socketPath, listening.resolve);
	await listening.promise;
	return server;
}
async function closeServer(server: net.Server): Promise<void> {
	const closed = Promise.withResolvers<void>();
	server.close(error => {
		if (error) closed.reject(error);
		else closed.resolve();
	});
	await closed.promise;
}


async function liveOwner(
	cmuxSocketPath: string,
): Promise<{ handle: SessionOwnershipHandle; root: string; sessionFile: string }> {
	const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cmux-owner-navigation-"));
	const root = path.join(temp, "owners");
	const sessionFile = path.join(temp, "session.jsonl");
	await fs.writeFile(sessionFile, "");
	const handle = await acquireSessionOwnership(sessionFile, "session-1", {
		root,
		buildRevision: TEST_BUILD_REVISION,
		runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
	});
	const canonical = await fs.realpath(sessionFile);
	const key = createHash("sha256").update(`${canonical}\0session-1`).digest("hex");
	await fs.writeFile(
		path.join(root, "owners-v1", key, "claim", "view.json"),
		JSON.stringify({
			version: 1,
			ownerEpoch: handle.ownerEpoch,
			cmux: {
				workspaceId: "11111111-1111-1111-1111-111111111111",
				surfaceId: "22222222-2222-2222-2222-222222222222",
				socketPath: cmuxSocketPath,
			},
		}),
	);
	cleanups.push(async () => {
		await handle.release();
		await fs.rm(temp, { recursive: true, force: true });
	});
	return { handle, root, sessionFile };
}

describe("focusCmuxOwner", () => {
	test("revalidates then sends workspace and surface RPCs sequentially with current socket auth", async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cmux-rpc-"));
		const socketPath = path.join(temp, "cmux.sock");
		const lines: string[] = [];
		const server = await unixServer(socketPath, (line, socket) => {
			lines.push(line);
			if (line.startsWith("auth ")) {
				socket.write("ERROR: Unknown command 'auth'\n");
				return;
			}
			const request = JSON.parse(line) as { id: string };
			socket.write(`${JSON.stringify({ id: request.id, ok: true, result: {} })}\n`);
		});
		cleanups.push(async () => {
			await closeServer(server);
			await fs.rm(temp, { recursive: true, force: true });
		});
		const owner = await liveOwner(socketPath);

		expect(await inspectSessionOwnership(owner.sessionFile, "session-1", { root: owner.root })).toMatchObject({ status: "live" });
		expect(await inspectLiveSessionOwnerView(owner.sessionFile, "session-1", { root: owner.root })).toBeDefined();
		const result = await focusCmuxOwner(
			{
				kind: "focus_cmux_owner",
				sessionFile: owner.sessionFile,
				sessionId: "session-1",
				lostOwnerEpoch: "epoch-old",
			},
			{
				ownershipRoot: owner.root,
				env: { CMUX_SOCKET_PATH: socketPath, CMUX_SOCKET_PASSWORD: "secret" },
			},
		);

		expect(result).toEqual({ kind: "focused" });
		expect(lines[0]).toBe("auth secret");
		expect(lines.slice(1).map(line => {
			const request = JSON.parse(line) as { method: string; params: Record<string, unknown> };
			return { method: request.method, params: request.params };
		})).toEqual([
			{ method: "workspace.select", params: { workspace_id: "11111111-1111-1111-1111-111111111111" } },
			{ method: "surface.focus", params: { surface_id: "22222222-2222-2222-2222-222222222222" } },
		]);
	});

	test("does not connect when the owner is absent or still has the lost epoch", async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cmux-unavailable-"));
		const socketPath = path.join(temp, "never.sock");
		cleanups.push(async () => {
			await fs.rm(temp, { recursive: true, force: true });
		});
		const owner = await liveOwner(socketPath);
		const action = {
			kind: "focus_cmux_owner" as const,
			sessionFile: owner.sessionFile,
			sessionId: "session-1",
			lostOwnerEpoch: owner.handle.ownerEpoch,
		};
		expect(await focusCmuxOwner(action, { ownershipRoot: owner.root })).toEqual({ kind: "unavailable" });
		await owner.handle.release();
		expect(await focusCmuxOwner({ ...action, lostOwnerEpoch: "epoch-old" }, { ownershipRoot: owner.root })).toEqual({
			kind: "unavailable",
		});
	});

	test("reports an RPC failure without attempting surface focus", async () => {
		const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cmux-rpc-failure-"));
		const socketPath = path.join(temp, "cmux.sock");
		const methods: string[] = [];
		const server = await unixServer(socketPath, (line, socket) => {
			const request = JSON.parse(line) as { method: string };
			methods.push(request.method);
			socket.write(`${JSON.stringify({ ok: false, error: { code: "denied", message: "not allowed" } })}\n`);
		});
		cleanups.push(async () => {
			await closeServer(server);
			await fs.rm(temp, { recursive: true, force: true });
		});
		const owner = await liveOwner(socketPath);

		const result = await focusCmuxOwner(
			{
				kind: "focus_cmux_owner",
				sessionFile: owner.sessionFile,
				sessionId: "session-1",
				lostOwnerEpoch: "epoch-old",
			},
			{ ownershipRoot: owner.root, env: {} },
		);
		expect(result).toEqual({ kind: "failed", reason: "denied: not allowed" });
		expect(methods).toEqual(["workspace.select"]);
	});
});
