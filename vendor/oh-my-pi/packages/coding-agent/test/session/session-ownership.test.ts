import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireSessionOwnership,
	decodeCmuxOwnerView,
	decodeSessionLeaseV1,
	ExternalSessionOwnerUnverifiable,
	inspectLiveSessionOwnerView,
	inspectSessionOwnership,
	resolveAgentMuxRoot,
	type CmuxOwnerView,
} from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; session: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-owner-"));
	roots.push(root);
	const session = path.join(root, "parent.jsonl");
	await fs.writeFile(session, `${JSON.stringify({ type: "session", id: "parent" })}\n`);
	return { root, session };
}

const workspaceId = "11111111-1111-1111-1111-111111111111";
const surfaceId = "22222222-2222-2222-2222-222222222222";

async function claimPath(root: string): Promise<string> {
	const [key] = await fs.readdir(path.join(root, "owners-v1"));
	return path.join(root, "owners-v1", key, "claim");
}

async function startOwnerServer(socketPath: string, ownerEpoch: string): Promise<net.Server> {
	const server = net.createServer(socket => {
		socket.on("data", data => {
			const request = JSON.parse(data.toString()) as { nonce: string };
			socket.end(
				`${JSON.stringify({
					t: "ownerProof",
					nonce: request.nonce,
					ownerEpoch,
					sessionMatch: true,
					phase: "running",
				})}\n`,
			);
		});
	});
	const result = Promise.withResolvers<void>();
	server.once("error", result.reject);
	server.listen(socketPath, () => result.resolve());
	await result.promise;
	return server;
}

async function closeServer(server: net.Server): Promise<void> {
	const result = Promise.withResolvers<void>();
	server.close(error => (error ? result.reject(error) : result.resolve()));
	await result.promise;
}

function setCmuxEnvironment(name: "CMUX_WORKSPACE_ID" | "CMUX_SURFACE_ID" | "CMUX_SOCKET_PATH", value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

async function withCmuxEnvironment(
	callback: () => Promise<void>,
	values: { workspaceId?: string; surfaceId?: string; socketPath?: string },
): Promise<void> {
	const original = {
		workspaceId: process.env.CMUX_WORKSPACE_ID,
		surfaceId: process.env.CMUX_SURFACE_ID,
		socketPath: process.env.CMUX_SOCKET_PATH,
	};
	try {
		setCmuxEnvironment("CMUX_WORKSPACE_ID", values.workspaceId);
		setCmuxEnvironment("CMUX_SURFACE_ID", values.surfaceId);
		setCmuxEnvironment("CMUX_SOCKET_PATH", values.socketPath);
		await callback();
	} finally {
		setCmuxEnvironment("CMUX_WORKSPACE_ID", original.workspaceId);
		setCmuxEnvironment("CMUX_SURFACE_ID", original.surfaceId);
		setCmuxEnvironment("CMUX_SOCKET_PATH", original.socketPath);
	}
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("owners-v1 OMP guard", () => {
	it("uses the closed v1 decoder", () => {
		expect(decodeSessionLeaseV1({ version: 1 })).toBeNull();
	});

	it("strictly decodes valid cmux owner views", () => {
		const view = {
			version: 1,
			ownerEpoch: "owner-epoch",
			cmux: { workspaceId, surfaceId, socketPath: "/tmp/cmux.sock" },
		} satisfies CmuxOwnerView;
		expect(decodeCmuxOwnerView(view)).toEqual(view);
		expect(decodeCmuxOwnerView({ ...view, extra: true })).toBeUndefined();
		expect(decodeCmuxOwnerView({ ...view, cmux: { workspaceId, surfaceId } })).toBeUndefined();
		expect(decodeCmuxOwnerView({ ...view, cmux: { workspaceId: "invalid", surfaceId, socketPath: "/tmp/cmux.sock" } })).toBeUndefined();
		expect(decodeCmuxOwnerView({ ...view, cmux: { workspaceId, surfaceId, socketPath: "relative.sock" } })).toBeUndefined();
	});

	it("resolves explicit, environment, and default agent-mux roots", () => {
		const original = process.env.AGENT_MUX_DIR;
		try {
			process.env.AGENT_MUX_DIR = path.join(".", "environment-root");
			expect(resolveAgentMuxRoot(path.join(".", "explicit-root"))).toBe(path.resolve("explicit-root"));
			expect(resolveAgentMuxRoot()).toBe(path.resolve("environment-root"));
			process.env.AGENT_MUX_DIR = "";
			expect(resolveAgentMuxRoot()).toBe(path.join(os.homedir(), ".agent-mux"));
		} finally {
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});

	it("uses an explicit ownership root instead of AGENT_MUX_DIR", async () => {
		const { root, session } = await fixture();
		const environmentRoot = path.join(root, "environment");
		const explicitRoot = path.join(root, "explicit");
		const original = process.env.AGENT_MUX_DIR;
		let ownership: Awaited<ReturnType<typeof acquireSessionOwnership>> | undefined;
		try {
			process.env.AGENT_MUX_DIR = environmentRoot;
			ownership = await acquireSessionOwnership(session, "parent", { root: explicitRoot });
			expect((await fs.stat(await claimPath(explicitRoot))).isDirectory()).toBe(true);
			await expect(fs.stat(environmentRoot)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await ownership?.release();
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});

	it("round-trips a live owner and cmux view through AGENT_MUX_DIR", async () => {
		const { root, session } = await fixture();
		const cmuxSocket = path.join(root, "cmux.sock");
		const original = process.env.AGENT_MUX_DIR;
		try {
			process.env.AGENT_MUX_DIR = root;
			await withCmuxEnvironment(async () => {
				const ownership = await acquireSessionOwnership(session, "parent");
				const claim = await claimPath(root);
				const server = await startOwnerServer(path.join(claim, "owner.sock"), ownership.ownerEpoch);
				try {
					expect(await inspectLiveSessionOwnerView(session, "parent")).toEqual({
						version: 1,
						ownerEpoch: ownership.ownerEpoch,
						cmux: { workspaceId, surfaceId, socketPath: cmuxSocket },
					});
				} finally {
					await closeServer(server);
					await ownership.release();
				}
			}, { workspaceId, surfaceId, socketPath: cmuxSocket });
		} finally {
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});

	it("falls back for absent, malformed, or partial legacy sidecars", async () => {
		const { root, session } = await fixture();
		await withCmuxEnvironment(async () => {
			const ownership = await acquireSessionOwnership(session, "parent", { root });
			const claim = await claimPath(root);
			const server = await startOwnerServer(path.join(claim, "owner.sock"), ownership.ownerEpoch);
			try {
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
				await fs.writeFile(path.join(claim, "view.json"), JSON.stringify({ version: 1, ownerEpoch: ownership.ownerEpoch }));
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
				await fs.writeFile(path.join(claim, "view.json"), "{");
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
			} finally {
				await closeServer(server);
				await ownership.release();
			}
		}, {});
	});

	it("rejects an epoch-mismatched view after takeover", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireSessionOwnership(session, "parent", { root });
		const claim = await claimPath(root);
		const leaseFile = path.join(claim, "lease.json");
		const lease = JSON.parse(await fs.readFile(leaseFile, "utf8")) as { ownerEpoch: string };
		const takeoverEpoch = "takeover-epoch";
		await fs.writeFile(leaseFile, JSON.stringify({ ...lease, ownerEpoch: takeoverEpoch }));
		await fs.writeFile(
			path.join(claim, "view.json"),
			JSON.stringify({
				version: 1,
				ownerEpoch: ownership.ownerEpoch,
				cmux: { workspaceId, surfaceId, socketPath: path.join(root, "cmux.sock") },
			}),
		);
		const server = await startOwnerServer(path.join(claim, "owner.sock"), takeoverEpoch);
		try {
			expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
		} finally {
			await closeServer(server);
			await ownership.release();
		}
	});

	it("ignores unavailable sidecar metadata without fencing ownership", async () => {
		const { root, session } = await fixture();
		await withCmuxEnvironment(async () => {
			const ownership = await acquireSessionOwnership(session, "parent", { root });
			const claim = await claimPath(root);
			await fs.mkdir(path.join(claim, "view.json"));
			const server = await startOwnerServer(path.join(claim, "owner.sock"), ownership.ownerEpoch);
			try {
				expect(await ownership.isCurrent()).toBe(true);
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
			} finally {
				await closeServer(server);
				await ownership.release();
			}
		}, { workspaceId: "invalid", surfaceId, socketPath: path.join(root, "cmux.sock") });
	});

	it("acquires and releases only its own epoch", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireSessionOwnership(session, "parent", { root });
		expect(await ownership.isCurrent()).toBe(true);
		await ownership.release();
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("treats a final-component symlink as the same owned journal", async () => {
		const { root, session } = await fixture();
		const symlink = path.join(root, "parent-link.jsonl");
		await fs.symlink(session, symlink);
		const ownership = await acquireSessionOwnership(symlink, "parent", { root });
		expect((await inspectSessionOwnership(session, "parent", { root })).status).toBe("suspect");
		await expect(acquireSessionOwnership(session, "parent", { root })).rejects.toBeInstanceOf(
			ExternalSessionOwnerUnverifiable,
		);
		await ownership.release();
	});

	it("rejects a missing mux-supplied epoch before a direct fallback", async () => {
		const { root, session } = await fixture();
		await expect(
			acquireSessionOwnership(session, "parent", {
				root,
				suppliedEpoch: "mux-epoch",
				suppliedSocket: path.join(root, "sock"),
			}),
		).rejects.toBeInstanceOf(ExternalSessionOwnerUnverifiable);
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("lets a child find its mux lease, view, and queue through inherited AGENT_MUX_DIR", async () => {
		const { root, session } = await fixture();
		const isolatedHome = path.join(root, "home");
		const original = process.env.AGENT_MUX_DIR;
		let direct: Awaited<ReturnType<typeof acquireSessionOwnership>> | undefined;
		let server: net.Server | undefined;
		try {
			process.env.AGENT_MUX_DIR = root;
			direct = await acquireSessionOwnership(session, "parent");
			const claim = await claimPath(root);
			const leaseFile = path.join(claim, "lease.json");
			const lease = JSON.parse(await fs.readFile(leaseFile, "utf8")) as Record<string, unknown>;
			const suppliedEpoch = "mux-epoch";
			const suppliedSocket = path.join(claim, "owner.sock");
			await fs.writeFile(
				leaseFile,
				JSON.stringify({ ...lease, ownerKind: "agent-mux", ownerEpoch: suppliedEpoch, socketPath: suppliedSocket }),
			);
			await fs.writeFile(
				path.join(claim, "view.json"),
				JSON.stringify({
					version: 1,
					ownerEpoch: suppliedEpoch,
					cmux: { workspaceId, surfaceId, socketPath: path.join(root, "cmux.sock") },
				}),
			);
			server = await startOwnerServer(suppliedSocket, suppliedEpoch);
			const childSource = [
				'import { acquireSessionOwnership, inspectLiveSessionOwnerView } from "@oh-my-pi/pi-coding-agent/session/session-ownership";',
				'import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";',
				"const sessionFile = process.env.SESSION_FILE;",
				"const suppliedEpoch = process.env.OWNER_EPOCH;",
				"const suppliedSocket = process.env.OWNER_SOCKET;",
				'if (!sessionFile || !suppliedEpoch || !suppliedSocket) throw new Error("missing child environment");',
				'const ownership = await acquireSessionOwnership(sessionFile, "parent", { suppliedEpoch, suppliedSocket });',
				"await DurableInputQueue.open(ownership);",
				'console.log(JSON.stringify({ ownerKind: ownership.ownerKind, current: await ownership.isCurrent(), view: await inspectLiveSessionOwnerView(sessionFile, "parent") }));',
			].join("\n");
			const child = Bun.spawn({
				cmd: [process.execPath, "-e", childSource],
				cwd: path.resolve(import.meta.dir, "../.."),
				env: {
					...process.env,
					HOME: isolatedHome,
					SESSION_FILE: session,
					OWNER_EPOCH: suppliedEpoch,
					OWNER_SOCKET: suppliedSocket,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (exitCode !== 0) throw new Error(`ownership child failed (${exitCode}): ${stderr}`);
			const result = JSON.parse(stdout.trim()) as { ownerKind: string; current: boolean; view?: CmuxOwnerView };
			expect(result.ownerKind).toBe("agent-mux");
			expect(result.current).toBe(true);
			expect(result.view?.ownerEpoch).toBe(suppliedEpoch);
			expect((await fs.stat(path.join(path.dirname(claim), "queue-v2"))).isDirectory()).toBe(true);
			await expect(fs.stat(path.join(isolatedHome, ".agent-mux"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			if (server) await closeServer(server);
			await direct?.release();
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});
});
