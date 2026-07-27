import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireSessionOwnership,
	decodeCmuxOwnerView,
	decodeSessionLeaseV1,
	ExternalSessionOwner,
	ExternalSessionOwnerUnverifiable,
	inspectLiveSessionOwnerDetails,
	inspectLiveSessionOwnerView,
	inspectSessionOwnership,
	resolveAgentMuxRoot,
	type CmuxOwnerView,
} from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import {
	type ReadonlySessionManager,
	SessionManager,
} from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { UnixSocketTerminalSessionTransport } from "../../src/runner/wire/client";

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
const buildRevision = { digest: "a".repeat(64), version: "ownership-process-test" };
const runnerInstanceIdentity = {
	runnerInstanceId: "33333333-3333-4333-8333-333333333333",
	startedAt: "2026-07-12T00:00:00.000Z",
};

async function acquireFixtureOwnership(
	sessionFile: string,
	sessionId: string,
	options: Omit<
		NonNullable<Parameters<typeof acquireSessionOwnership>[2]>,
		"buildRevision" | "runnerInstanceIdentity"
	> = {},
) {
	return acquireSessionOwnership(sessionFile, sessionId, { ...options, buildRevision, runnerInstanceIdentity });
}

async function managerFixture(): Promise<{ root: string; manager: SessionManager; sessionFile: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-manager-owner-"));
	roots.push(root);
	const manager = SessionManager.create(root, path.join(root, "sessions"));
	await manager.ensureOnDisk();
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("missing durable session file");
	return { root, manager, sessionFile };
}

describe("ReadonlySessionManager ownership view", () => {
	it("is absent until the live session binds ownership", async () => {
		const { manager } = await managerFixture();
		const readonlyManager: ReadonlySessionManager = manager;
		try {
			expect(readonlyManager.getSessionOwnershipView()).toBeUndefined();
		} finally {
			await manager.close();
		}
	});

	it("exposes immutable current ownership identity without release or mutation", async () => {
		const { root, manager, sessionFile } = await managerFixture();
		const ownership = await acquireFixtureOwnership(sessionFile, manager.getSessionId(), { root });
		const readonlyManager: ReadonlySessionManager = manager;
		manager.bindSessionOwnership(ownership);
		try {
			const view = readonlyManager.getSessionOwnershipView();
			if (!view) throw new Error("missing ownership view");
			expect(view.sessionFile).toBe(ownership.sessionFile);
			expect(view.sessionId).toBe(ownership.sessionId);
			expect(view.ownerEpoch).toBe(ownership.ownerEpoch);
			expect(view.ownerKind).toBe(ownership.ownerKind);
			expect(view.buildRevision).toEqual(buildRevision);
			expect(view.runnerInstanceIdentity).toEqual(runnerInstanceIdentity);
			expect(view.ownershipSocketPath).toBe(ownership.socketPath);
			expect(await view.isCurrent()).toBe(true);
			expect(view.isFenced()).toBe(false);
			expect(Object.isFrozen(view)).toBe(true);
			expect(Object.isFrozen(view.buildRevision)).toBe(true);
			expect(Object.isFrozen(view.runnerInstanceIdentity)).toBe(true);
			expect("release" in view).toBe(false);
			expect(Reflect.set(view, "ownerEpoch", "mutated")).toBe(false);
			expect(Reflect.set(view.buildRevision, "digest", "mutated")).toBe(false);
		} finally {
			await manager.close();
			await ownership.release();
		}
	});

	it("fences an issued view when ownership is replaced and exposes the replacement epoch", async () => {
		const { root, manager, sessionFile } = await managerFixture();
		const first = await acquireFixtureOwnership(sessionFile, manager.getSessionId(), { root });
		const readonlyManager: ReadonlySessionManager = manager;
		let replacement: Awaited<ReturnType<typeof acquireFixtureOwnership>> | undefined;
		manager.bindSessionOwnership(first);
		try {
			const firstView = readonlyManager.getSessionOwnershipView();
			if (!firstView) throw new Error("missing initial ownership view");
			await first.release();
			replacement = await acquireFixtureOwnership(sessionFile, manager.getSessionId(), { root });
			manager.bindSessionOwnership(replacement);

			const replacementView = readonlyManager.getSessionOwnershipView();
			if (!replacementView) throw new Error("missing replacement ownership view");
			expect(replacementView.ownerEpoch).not.toBe(firstView.ownerEpoch);
			expect(await firstView.isCurrent()).toBe(false);
			expect(firstView.isFenced()).toBe(true);
			expect(await replacementView.isCurrent()).toBe(true);
			expect(replacementView.isFenced()).toBe(false);
		} finally {
			await manager.close();
			await first.release();
			await replacement?.release();
		}
	});
});

it("surfaces epoch-bound owner identity for takeover diagnostics", async () => {
	const { root, session } = await fixture();
	const ownership = await acquireFixtureOwnership(session, "parent", { root });

	const details = await inspectLiveSessionOwnerDetails(session, "parent", { root });
	expect(details).toEqual({
		ownerEpoch: ownership.ownerEpoch,
		pid: process.pid,
		cwd: process.cwd(),
		startedAt: runnerInstanceIdentity.startedAt,
		muxHint: process.env.CMUX_SURFACE_ID ?? process.env.TMUX_PANE ?? null,
	});

	await ownership.release();
});

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

async function requestOwner(socketPath: string, request: string): Promise<string> {
	const result = Promise.withResolvers<string>();
	const socket = net.createConnection(socketPath);
	let response = "";
	let settled = false;
	const finish = (): void => {
		if (settled) return;
		settled = true;
		socket.destroy();
		result.resolve(response);
	};
	socket.setTimeout(500, finish);
	socket.once("error", finish);
	socket.once("close", finish);
	socket.on("data", chunk => {
		response += chunk.toString();
	});
	socket.once("connect", () => socket.write(request));
	return result.promise;
}

function setCmuxEnvironment(
	name: "CMUX_WORKSPACE_ID" | "CMUX_SURFACE_ID" | "CMUX_SOCKET_PATH",
	value: string | undefined,
): void {
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
		expect(
			decodeCmuxOwnerView({ ...view, cmux: { workspaceId: "invalid", surfaceId, socketPath: "/tmp/cmux.sock" } }),
		).toBeUndefined();
		expect(
			decodeCmuxOwnerView({ ...view, cmux: { workspaceId, surfaceId, socketPath: "relative.sock" } }),
		).toBeUndefined();
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
			ownership = await acquireFixtureOwnership(session, "parent", { root: explicitRoot });
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
			await withCmuxEnvironment(
				async () => {
					const ownership = await acquireFixtureOwnership(session, "parent");
					try {
						expect(await inspectLiveSessionOwnerView(session, "parent")).toEqual({
							version: 1,
							ownerEpoch: ownership.ownerEpoch,
							cmux: { workspaceId, surfaceId, socketPath: cmuxSocket },
						});
					} finally {
						await ownership.release();
					}
				},
				{ workspaceId, surfaceId, socketPath: cmuxSocket },
			);
		} finally {
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});

	it("falls back for absent, malformed, or partial legacy sidecars", async () => {
		const { root, session } = await fixture();
		await withCmuxEnvironment(async () => {
			const ownership = await acquireFixtureOwnership(session, "parent", { root });
			const claim = await claimPath(root);
			try {
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
				await fs.writeFile(
					path.join(claim, "view.json"),
					JSON.stringify({ version: 1, ownerEpoch: ownership.ownerEpoch }),
				);
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
				await fs.writeFile(path.join(claim, "view.json"), "{");
				expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
			} finally {
				await ownership.release();
			}
		}, {});
	});

	it("rejects an epoch-mismatched view after takeover", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireFixtureOwnership(session, "parent", { root });
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
		try {
			expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
		} finally {
			await ownership.release();
		}
	});

	it("ignores unavailable sidecar metadata without fencing ownership", async () => {
		const { root, session } = await fixture();
		await withCmuxEnvironment(
			async () => {
				const ownership = await acquireFixtureOwnership(session, "parent", { root });
				const claim = await claimPath(root);
				await fs.mkdir(path.join(claim, "view.json"));
				try {
					expect(await ownership.isCurrent()).toBe(true);
					expect(await inspectLiveSessionOwnerView(session, "parent", { root })).toBeUndefined();
				} finally {
					await ownership.release();
				}
			},
			{ workspaceId: "invalid", surfaceId, socketPath: path.join(root, "cmux.sock") },
		);
	});

	it("acquires and releases only its own epoch", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireFixtureOwnership(session, "parent", { root });
		expect(await ownership.isCurrent()).toBe(true);
		await ownership.release();
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("serves owner proof on the framed ownership endpoint and refuses identity mismatch", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireFixtureOwnership(session, "parent", { root });
		const claim = await claimPath(root);
		const lease = decodeSessionLeaseV1(JSON.parse(await fs.readFile(path.join(claim, "lease.json"), "utf8")));
		if (!lease) throw new Error("missing direct lease");
		const identity = JSON.parse(await fs.readFile(path.join(claim, `identity-v1-${lease.ownerEpoch}.json`), "utf8"));
		expect(lease.buildRevision).toBeUndefined();
		expect(lease.runnerInstanceId).toBeUndefined();
		expect(identity).toEqual({
			version: 1,
			ownerEpoch: ownership.ownerEpoch,
			buildRevision,
			runnerInstanceId: runnerInstanceIdentity.runnerInstanceId,
			pid: process.pid,
			cwd: process.cwd(),
			startedAt: runnerInstanceIdentity.startedAt,
			muxHint: process.env.CMUX_SURFACE_ID ?? process.env.TMUX_PANE ?? null,
		});
		const hello = {
			protocol: { minMajor: 1, maxMajor: 1, maxMinor: 0 },
			sessionId: "parent",
			ownerEpoch: ownership.ownerEpoch,
			runnerInstanceId: runnerInstanceIdentity.runnerInstanceId,
			build: buildRevision,
			authority: {
				uid: typeof process.getuid === "function" ? process.getuid() : 0,
				canonicalSessionPath: lease.sessionFile,
				namespaceDigest: path.basename(path.dirname(path.dirname(lease.socketPath))),
			},
			requestedCapability: "observer" as const,
			features: ["event-resync"],
		};
		const client = new UnixSocketTerminalSessionTransport({ socketPath: lease.socketPath, hello });
		const challenge = {
			nonce: "proof-nonce",
			sessionId: lease.sessionId,
			ownerEpoch: ownership.ownerEpoch,
			runnerInstanceId: runnerInstanceIdentity.runnerInstanceId,
			buildDigest: buildRevision.digest,
			ownerPid: lease.controllerProcess.pid,
			ownershipSocketPath: lease.socketPath,
		};
		const expectedProof = {
			t: "ownerProof",
			nonce: "proof-nonce",
			sessionId: lease.sessionId,
			ownerEpoch: ownership.ownerEpoch,
			buildRevision,
			runnerInstanceId: runnerInstanceIdentity.runnerInstanceId,
			sessionMatch: true,
			phase: "running",
			ownerPid: lease.controllerProcess.pid,
			ownershipSocketPath: lease.socketPath,
		};
		expect(await client.ownerProof<typeof expectedProof>(challenge)).toEqual(expectedProof);
		await client.close();
		const mismatched = new UnixSocketTerminalSessionTransport({
			socketPath: lease.socketPath,
			hello,
			requestTimeoutMs: 250,
		});
		await expect(
			mismatched.ownerProof({ ...challenge, runnerInstanceId: "44444444-4444-4444-8444-444444444444" }),
		).rejects.toBeInstanceOf(Error);
		await mismatched.close().catch(() => {});
		await ownership.release();
		await expect(fs.stat(lease.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("lets another process verify a live direct owner", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireFixtureOwnership(session, "parent", { root });
		try {
			const child = Bun.spawn({
				cmd: [
					process.execPath,
					"-e",
					'import { inspectSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership"; const result = await inspectSessionOwnership(process.env.SESSION_FILE!, "parent", { root: process.env.OWNER_ROOT! }); console.log(JSON.stringify(result));',
				],
				cwd: path.resolve(import.meta.dir, "../.."),
				env: { ...process.env, SESSION_FILE: session, OWNER_ROOT: root },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (exitCode !== 0) throw new Error(`direct ownership child failed (${exitCode}): ${stderr}`);
			const result = JSON.parse(stdout.trim()) as {
				status: string;
				lease?: { ownerEpoch: string; buildRevision?: unknown; runnerInstanceId?: string };
			};
			expect(result.status).toBe("live");
			expect(result.lease).toMatchObject({ ownerEpoch: ownership.ownerEpoch });
			expect(result.lease?.buildRevision).toBeUndefined();
			expect(result.lease?.runnerInstanceId).toBeUndefined();
		} finally {
			await ownership.release();
		}
	});

	it("self-fences and closes its probe socket after runner identity ownership loss", async () => {
		const { root, session } = await fixture();
		const ownership = await acquireFixtureOwnership(session, "parent", { root });
		const claim = await claimPath(root);
		const lease = decodeSessionLeaseV1(JSON.parse(await fs.readFile(path.join(claim, "lease.json"), "utf8")));
		if (!lease) throw new Error("missing direct lease");
		const identityFile = path.join(claim, `identity-v1-${lease.ownerEpoch}.json`);
		const identity = JSON.parse(await fs.readFile(identityFile, "utf8"));
		await fs.writeFile(
			identityFile,
			JSON.stringify({ ...identity, runnerInstanceId: "66666666-6666-4666-8666-666666666666" }),
		);
		const deadline = Date.now() + 4_000;
		while (!ownership.isFenced?.() && Date.now() < deadline) await Bun.sleep(25);
		expect(ownership.isFenced?.()).toBe(true);
		await expect(fs.stat(lease.socketPath)).rejects.toMatchObject({ code: "ENOENT" });
		await ownership.release();
	});

	it("treats a final-component symlink as the same owned journal", async () => {
		const { root, session } = await fixture();
		const symlink = path.join(root, "parent-link.jsonl");
		await fs.symlink(session, symlink);
		const ownership = await acquireFixtureOwnership(symlink, "parent", { root });
		expect((await inspectSessionOwnership(session, "parent", { root })).status).toBe("live");
		await expect(acquireFixtureOwnership(session, "parent", { root })).rejects.toBeInstanceOf(ExternalSessionOwner);
		await ownership.release();
	});

	it("rejects a missing mux-supplied epoch before a direct fallback", async () => {
		const { root, session } = await fixture();
		await expect(
			acquireFixtureOwnership(session, "parent", {
				root,
				suppliedEpoch: "mux-epoch",
				suppliedSocket: path.join(root, "sock"),
			}),
		).rejects.toBeInstanceOf(ExternalSessionOwnerUnverifiable);
		expect(await inspectSessionOwnership(session, "parent", { root })).toEqual({ status: "none" });
	});

	it("does not publish a mux identity after its claim epoch is replaced", async () => {
		const { root, session } = await fixture();
		const direct = await acquireFixtureOwnership(session, "parent", { root });
		const claim = await claimPath(root);
		const leaseFile = path.join(claim, "lease.json");
		const identityFile = path.join(claim, "identity-v1-77777777-7777-4777-8777-777777777777.json");
		const lease = JSON.parse(await fs.readFile(leaseFile, "utf8")) as Record<string, unknown>;
		await direct.release();
		await fs.mkdir(claim);
		const suppliedEpoch = "55555555-5555-4555-8555-555555555555";
		const replacementEpoch = "77777777-7777-4777-8777-777777777777";
		const suppliedSocket = path.join(root, "mux-race.sock");
		await fs.writeFile(
			leaseFile,
			JSON.stringify({
				...lease,
				ownerKind: "agent-mux",
				ownerEpoch: suppliedEpoch,
				socketPath: suppliedSocket,
				phase: "running",
			}),
		);
		const replacementIdentity = {
			version: 1,
			ownerEpoch: replacementEpoch,
			buildRevision: { digest: "b".repeat(64), version: "replacement" },
			runnerInstanceId: "99999999-9999-4999-8999-999999999999",
		};
		const originalRename = fs.rename;
		const rename = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
			if (String(source).endsWith(`.identity-${suppliedEpoch}.tmp`)) {
				await fs.writeFile(
					leaseFile,
					JSON.stringify({
						...lease,
						ownerKind: "agent-mux",
						ownerEpoch: replacementEpoch,
						socketPath: suppliedSocket,
						phase: "running",
					}),
				);
				await fs.writeFile(identityFile, JSON.stringify(replacementIdentity));
			}
			return originalRename(source, destination);
		});
		try {
			await expect(
				acquireFixtureOwnership(session, "parent", { root, suppliedEpoch, suppliedSocket }),
			).rejects.toBeInstanceOf(ExternalSessionOwnerUnverifiable);
			expect(JSON.parse(await fs.readFile(identityFile, "utf8"))).toEqual(replacementIdentity);
		} finally {
			rename.mockRestore();
		}
	});

	it("lets a child attach to a legacy identity-free mux lease through inherited AGENT_MUX_DIR", async () => {
		const { root, session } = await fixture();
		const isolatedHome = path.join(root, "home");
		const original = process.env.AGENT_MUX_DIR;
		let direct: Awaited<ReturnType<typeof acquireSessionOwnership>> | undefined;
		let server: net.Server | undefined;
		try {
			process.env.AGENT_MUX_DIR = root;
			direct = await acquireFixtureOwnership(session, "parent");
			const claim = await claimPath(root);
			const leaseFile = path.join(claim, "lease.json");
			const lease = JSON.parse(await fs.readFile(leaseFile, "utf8")) as Record<string, unknown>;
			expect(lease.buildRevision).toBeUndefined();
			expect(lease.runnerInstanceId).toBeUndefined();
			const suppliedEpoch = "55555555-5555-4555-8555-555555555555";
			const suppliedSocket = path.join(root, "mux-owner.sock");
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
				'const ownership = await acquireSessionOwnership(sessionFile, "parent", { suppliedEpoch, suppliedSocket, buildRevision: { digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", version: "ownership-process-test" }, runnerInstanceIdentity: { runnerInstanceId: "33333333-3333-4333-8333-333333333333", startedAt: "2026-07-12T00:00:00.000Z" } });',
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
			expect((await fs.stat(path.join(path.dirname(claim), "queue-v3"))).isDirectory()).toBe(true);
			await expect(fs.stat(path.join(isolatedHome, ".agent-mux"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			if (server) await closeServer(server);
			await direct?.release();
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});
});
