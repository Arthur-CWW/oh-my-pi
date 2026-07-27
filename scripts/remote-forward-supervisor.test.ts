import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AliasLeaseStore,
	BackendAbsent,
	DEFAULT_STATIC_BOUNDS,
	ForwardSupervisor,
	HostUnreachable,
	LeaseHeldByAnotherOwner,
	PortCollision,
	PortlessRoutePublisher,
	SshTargetResolver,
	SshTunnelTransport,
	StaticArtifactRejected,
	StaleSupervisor,
	assertLoopbackPortFree,
	decodeTunnelChildRecord,
	buildCmuxBrowserCommands,
	buildSshForwardArguments,
	ensureStaticDaemon,
	parsePortlessRoutes,
	readProcessIdentity,
	signalProcessIdentity,
	resolveStaticArtifact,
	startStaticServer,
	validateForwardConfig,
	type ForwardConfig,
	type ForwardState,
	type ForwardTargetConfig,
	type ResolvedForwardTarget,
	type RoutePublisher,
	type StaticServerBounds,
	type TargetResolver,
	type ReadyTunnel,
	type TunnelTransport,
	type PendingTunnel,
	type TunnelBounds,
	type TunnelChildRecord,
	type TunnelProbe,
} from "./remote-forward-supervisor";

interface MutableResolverState {
	ports: Map<string, number>;
	online: boolean;
}

class MutableLoopbackResolver implements TargetResolver {
	readonly state: MutableResolverState;

	constructor(targets: ForwardTargetConfig[]) {
		this.state = {
			ports: new Map(targets.map((target) => [target.name, 30_000 + Math.floor(Math.random() * 10_000)])),
			online: true,
		};
	}

	async resolveTargets(config: ForwardConfig) {
		if (!this.state.online) {
			throw new HostUnreachable(config.host, config.user, 255, "fixture transport is down");
		}
		return {
			available: config.targets.map((target) => ({
				...target,
				remotePort: this.state.ports.get(target.name) ?? 0,
				url: `https://${target.alias}.localhost${target.path}`,
			})),
			degradations: [],
		};
	}
}

interface LoopbackSession {
	alive: boolean;
	servers: Bun.Server<undefined>[];
	pid: number;
}

class LoopbackHttpTunnelTransport implements TunnelTransport {
	readonly backends: Map<number, string>;
	readonly sessions: LoopbackSession[] = [];
	starts = 0;

	constructor(backends: Map<number, string>) {
		this.backends = backends;
	}

	async cleanupStale(_config: ForwardConfig): Promise<void> {}

	/** In-process sessions have no separate child to signal, so closing the listeners is the whole reap. */
	async reap(_config: ForwardConfig, _record: TunnelChildRecord): Promise<void> {
		for (const session of this.sessions) this.close(session);
	}

	async spawn(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<PendingTunnel> {
		for (const target of targets) await assertLoopbackPortFree(target.alias, target.localPort);
		const session: LoopbackSession = { alive: true, servers: [], pid: process.pid };
		for (const target of targets) {
			const body = this.backends.get(target.remotePort);
			if (body === undefined) throw new BackendAbsent(target.name, target.kind, `fixture backend missing: ${target.remotePort}`);
			session.servers.push(
				Bun.serve({ hostname: "127.0.0.1", port: target.localPort, fetch: () => new Response(body) }),
			);
		}
		this.sessions.push(session);
		this.starts += 1;
		const close = (): void => this.close(session);
		return {
			record: {
				version: 1,
				pid: session.pid,
				bootId: "fixture-boot",
				startFingerprint: "fixture-start",
				controlSocket: join(config.stateDir, "ssh.sock"),
				localPorts: targets.map((target) => target.localPort),
			},
			async ready(): Promise<ReadyTunnel> {
				return {
					handle: {
						pid: session.pid,
						async probe(): Promise<TunnelProbe> {
							return session.alive
								? { transport: true, live: targets, dead: [] }
								: { transport: false, live: [], dead: [] };
						},
						async stop(): Promise<void> {
							close();
						},
					},
					live: targets,
					dead: [],
				};
			},
			async abort(): Promise<void> {
				close();
			},
		};
	}

	private close(session: LoopbackSession): void {
		if (!session.alive) return;
		session.alive = false;
		for (const server of session.servers) server.stop(true);
	}

	drop(): void {
		const session = this.sessions.at(-1);
		if (session) this.close(session);
	}
}

class LeaseBackedRoutes implements RoutePublisher {
	readonly store: AliasLeaseStore;
	readonly configPath: string;
	published: ResolvedForwardTarget[] = [];

	constructor(directory: string) {
		this.store = new AliasLeaseStore(directory);
		this.configPath = join(directory, "fixture-config.json");
	}

	async cleanupStale(_config: ForwardConfig): Promise<void> {}

	async publish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void> {
		for (const target of targets) {
			this.store.acquire({
				version: 1,
				forwardId: config.id,
				pid: process.pid,
				alias: target.alias,
				localPort: target.localPort,
				configPath: this.configPath,
			});
		}
		this.published = [...this.published, ...targets];
	}

	async reconcileHealthy(_config: ForwardConfig, _targets: ResolvedForwardTarget[]): Promise<void> {}

	async unpublish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void> {
		const released = new Set(targets.map((target) => target.alias));
		for (const target of targets) this.store.release(target.alias, config.id, process.pid);
		this.published = this.published.filter((target) => !released.has(target.alias));
	}
}

const temporaryDirectories: string[] = [];
const servers: Bun.Server<undefined>[] = [];
const daemonPids: number[] = [];
const SUPERVISOR = join(import.meta.dir, "remote-forward-supervisor.ts");

// macOS resolves /tmp and /var through symlinks, so canonicalize once: the supervisor reports realpaths and
// every fixture assertion compares against the same canonical root on both Linux and Darwin.
function freshDirectory(): string {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "remote-forward-test-")));
	temporaryDirectories.push(directory);
	return directory;
}

async function freePort(): Promise<number> {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
	const port = server.port;
	if (port === undefined) throw new Error("Bun did not assign a loopback port");
	await server.stop(true);
	return port;
}

function config(
	directory: string,
	host: string,
	stream: string,
	localPort: number,
	alias: string,
	workspace = "workspace:2",
	kind: ForwardTargetConfig["kind"] = "portless",
): ForwardConfig {
	return {
		version: 1,
		id: `${host}-agents-${stream}`,
		workspace: `${host}-agents`,
		stream,
		host,
		user: "arthur",
		remoteNu: "/usr/bin/nu",
		remoteRunner: "/tmp/remote-workspace.nu",
		remoteManifest: "/tmp/remote-workspaces.yml",
		ssh: "/usr/bin/ssh",
		sshOptions: ["-x", "-o", "BatchMode=yes"],
		node: "/usr/bin/node",
		portless: "/tmp/portless",
		cmux: "/usr/local/bin/cmux",
		cmuxWorkspace: workspace,
		stateDir: join(directory, `${host}-${stream}`),
		refreshMs: 250,
		maxBackoffMs: 2_000,
		targets: [{ name: stream, kind, alias, localPort, path: "/", artifactDigest: kind === "static" ? "0".repeat(64) : null }],
	};
}

/** The live-plus-dead pair a real review forward carries when one companion backend is down. */
function pairedConfig(directory: string, livePort: number, deadPort: number): ForwardConfig {
	const paired = config(directory, "desktop", "companion", livePort, "desktop-companion", "workspace:9", "direct");
	paired.targets.push({
		name: "xanadu",
		kind: "direct",
		alias: "desktop-xanadu",
		localPort: deadPort,
		path: "/",
		artifactDigest: null,
	});
	return paired;
}

function resolvedPair(paired: ForwardConfig): ResolvedForwardTarget[] {
	return [
		{ ...paired.targets[0], remotePort: 42_201, url: "https://desktop-companion.localhost/" },
		{ ...paired.targets[1], remotePort: 42_202, url: "https://desktop-xanadu.localhost/" },
	];
}

function stubExecutable(directory: string, name: string, body: string): string {
	const path = join(directory, name);
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

/**
 * A stub barrier runs inside a supervisor child, so killing that supervisor orphans the barrier while
 * cleanup deletes the fixture directory holding its release file. An unbounded wait would then spin
 * forever on a file that can never appear and leave a sleeping shell on the host. Exit the moment the
 * fixture directory is gone, and cap the wait far beyond every test timeout as a second stop.
 */
function awaitRelease(variable: string): string {
	return [
		"attempts=0",
		`until [ -e "$${variable}" ]; do`,
		`\t[ -d "\${${variable}%/*}" ] || exit 1`,
		'\tattempts=$((attempts + 1))',
		'\t[ "$attempts" -lt 3000 ] || exit 1',
		"\tsleep 0.01",
		"done",
	].join("\n");
}

function sha256(value: string | Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function waitForPath(path: string, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
		await Bun.sleep(10);
	}
}

interface TunnelStub {
	/** Stands in for `ssh`: answers control commands, `_review`, and the tunnel master invocation. */
	readonly ssh: string;
	/** Written by the child that actually binds the review ports. */
	readonly pidFile: string;
	/** Create this file to make every refusing port start answering; delete it to make them refuse again. */
	readonly revive: string;
}

/**
 * A real, killable stand-in for the ssh tunnel child. Control commands (`-O check` / `-O exit`) answer
 * with `controlExit`, `_review` prints the resolver payload, and the master invocation execs a process
 * that binds the review ports and parks. `exec` preserves the shell's PID, so the identity the
 * supervisor records names exactly the process holding the ports.
 *
 * Each port carries its own mode, so one child can hold a live backend and a dead one at the same
 * time — the shape a partially reachable review forward actually has. A refusing port answers only
 * while the revive file exists, which is how a backend coming back and dying again is exercised
 * against a single unrestarted child.
 */
function tunnelStub(
	directory: string,
	name: string,
	ports: number[],
	options: { controlExit: number; backend: "accept" | "refuse"; review?: unknown; refuse?: readonly number[] },
): TunnelStub {
	const pidFile = join(directory, `${name}.pid`);
	const reviewFile = join(directory, `${name}-review.json`);
	const revive = join(directory, `${name}.revive`);
	const holder = join(directory, `${name}-holder.ts`);
	writeFileSync(reviewFile, JSON.stringify(options.review ?? []));
	writeFileSync(
		holder,
		[
			'import { existsSync } from "node:fs";',
			"const [pidFile, revive, ...specs] = Bun.argv.slice(2);",
			"for (const spec of specs) {",
			'\tconst [port, mode] = spec.split(":");',
			"\tBun.listen({",
			'\t\thostname: "127.0.0.1",',
			"\t\tport: Number(port),",
			'\t\tsocket: { open(socket) { if (mode === "refuse" && !existsSync(revive)) socket.end(); }, data() {} },',
			"\t});",
			"}",
			"await Bun.write(pidFile, String(process.pid));",
			"await new Promise<void>(() => {});",
			"",
		].join("\n"),
	);
	const specs = ports
		.map((port) => `${port}:${options.backend === "refuse" || options.refuse?.includes(port) ? "refuse" : "accept"}`)
		.join(" ");
	const ssh = stubExecutable(
		directory,
		name,
		[
			'for arg in "$@"; do',
			"\tcase \"$arg\" in",
			`\t\t-O) exit ${options.controlExit} ;;`,
			`\t\t_review) cat '${reviewFile}'; exit 0 ;;`,
			"\tesac",
			"done",
			`exec '${process.execPath}' '${holder}' '${pidFile}' '${revive}' ${specs}`,
		].join("\n"),
	);
	return { ssh, pidFile, revive };
}

const FAST_TUNNEL: TunnelBounds = {
	readyAttempts: 8,
	readyIntervalMs: 40,
	killGraceMs: 300,
	reapAttempts: 40,
	reapIntervalMs: 25,
};

function readForwardState(forwardConfig: ForwardConfig): ForwardState {
	return JSON.parse(readFileSync(join(forwardConfig.stateDir, "state.json"), "utf8")) as ForwardState;
}

/**
 * A successor reaps its predecessor's recorded child before it publishes its own, so for a moment
 * the state file names a child that is already gone. `after` skips that record and waits for the
 * successor's own.
 */
async function waitForTunnelRecord(
	forwardConfig: ForwardConfig,
	timeoutMs = 10_000,
	after?: TunnelChildRecord,
): Promise<TunnelChildRecord> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const record = existsSync(join(forwardConfig.stateDir, "state.json"))
			? decodeTunnelChildRecord(readForwardState(forwardConfig).tunnel)
			: null;
		if (record !== null && record.pid !== after?.pid) return record;
		if (Date.now() >= deadline) throw new Error("Timed out waiting for a published tunnel child record");
		await Bun.sleep(20);
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForPidExit(pid: number, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (pidAlive(pid)) {
		if (Date.now() >= deadline) throw new Error(`Process ${pid} never exited`);
		await Bun.sleep(20);
	}
}

async function portsFree(ports: number[]): Promise<boolean> {
	for (const port of ports) {
		try {
			await assertLoopbackPortFree("probe", port);
		} catch {
			return false;
		}
	}
	return true;
}

const FAST_BOUNDS: StaticServerBounds = { ...DEFAULT_STATIC_BOUNDS, maxBytes: 4_096, idleMs: 2_000, lifetimeMs: 5_000 };

afterEach(async () => {
	for (const server of servers.splice(0)) await server.stop(true);
	for (const pid of daemonPids.splice(0)) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone: the test asserted its exit.
		}
	}
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("remote review forward supervisor", () => {
	test("refreshes a changed backend port and recovers a dropped tunnel", async () => {
		const directory = freshDirectory();
		const localPort = await freePort();
		const forwardConfig = config(directory, "nixbox", "primer", localPort, "nixbox-primer");
		const resolver = new MutableLoopbackResolver(forwardConfig.targets);
		const firstPort = resolver.state.ports.get("primer")!;
		const secondPort = firstPort + 1;
		const transport = new LoopbackHttpTunnelTransport(
			new Map([
				[firstPort, "first backend"],
				[secondPort, "second backend"],
			]),
		);
		const supervisor = new ForwardSupervisor(forwardConfig, {
			resolver,
			transport,
			routes: new LeaseBackedRoutes(join(directory, "aliases")),
		});

		expect((await supervisor.reconcileOnce()).phase).toBe("healthy");
		expect(await fetch(`http://127.0.0.1:${localPort}`).then((response) => response.text())).toBe("first backend");
		resolver.state.ports.set("primer", secondPort);
		expect((await supervisor.reconcileOnce()).targets[0].remotePort).toBe(secondPort);
		expect(await fetch(`http://127.0.0.1:${localPort}`).then((response) => response.text())).toBe("second backend");
		expect(transport.starts).toBe(2);

		transport.drop();
		expect((await supervisor.reconcileOnce()).phase).toBe("healthy");
		expect(transport.starts).toBe(3);
		await supervisor.stop();
	});

	test("degrades with a typed cause and no stale listener, then reconnects", async () => {
		const directory = freshDirectory();
		const localPort = await freePort();
		const forwardConfig = config(directory, "nixbox", "playground", localPort, "nixbox-playground-scene", "workspace:4");
		const resolver = new MutableLoopbackResolver(forwardConfig.targets);
		const backendPort = resolver.state.ports.get("playground")!;
		const supervisor = new ForwardSupervisor(forwardConfig, {
			resolver,
			transport: new LoopbackHttpTunnelTransport(new Map([[backendPort, "scene"]])),
			routes: new LeaseBackedRoutes(join(directory, "aliases")),
		});
		expect((await supervisor.reconcileOnce()).phase).toBe("healthy");

		resolver.state.online = false;
		const degraded = await supervisor.reconcileOnce();
		expect(degraded.phase).toBe("degraded");
		expect(degraded.targets).toEqual([]);
		expect(degraded.lastError).toMatchObject({ _tag: "HostUnreachable", host: "nixbox", user: "arthur", exitCode: 255 });
		await assertLoopbackPortFree("nixbox-playground-scene", localPort);

		resolver.state.online = true;
		const recovered = await supervisor.reconcileOnce();
		expect(recovered.phase).toBe("healthy");
		expect(recovered.lastError).toBeNull();
		expect(await fetch(`http://127.0.0.1:${localPort}`).then((response) => response.text())).toBe("scene");
		await supervisor.stop();
	});

	test("keeps the same stream distinct across desktop, h11, and nixbox alias prefixes", async () => {
		const directory = freshDirectory();
		const routes = new LeaseBackedRoutes(join(directory, "aliases"));
		const hosts = ["desktop", "h11dsi", "nixbox"] as const;
		const prefixes: Record<string, string> = { desktop: "desktop", h11dsi: "h11", nixbox: "nixbox" };
		const supervisors: ForwardSupervisor[] = [];
		for (const host of hosts) {
			const port = await freePort();
			const forwardConfig = config(directory, host, "primer", port, `${prefixes[host]}-primer`);
			const resolver = new MutableLoopbackResolver(forwardConfig.targets);
			const backend = resolver.state.ports.get("primer")!;
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver,
				transport: new LoopbackHttpTunnelTransport(new Map([[backend, host]])),
				routes,
			});
			const state = await supervisor.reconcileOnce();
			expect(state.phase).toBe("healthy");
			expect(state.targets[0].alias).toBe(`${prefixes[host]}-primer`);
			expect(await fetch(`http://127.0.0.1:${port}`).then((response) => response.text())).toBe(host);
			supervisors.push(supervisor);
		}
		for (const supervisor of supervisors) await supervisor.stop();
	});

	test("reports a port collision and a lease held by another owner as distinct tagged errors", async () => {
		const directory = freshDirectory();
		const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") });
		servers.push(occupied);
		const occupiedPort = occupied.port;
		if (occupiedPort === undefined) throw new Error("Bun did not assign the occupied loopback port");
		const collision = await assertLoopbackPortFree("nixbox-primer", occupiedPort).catch((problem) => problem);
		expect(collision).toBeInstanceOf(PortCollision);
		expect(collision.detail()).toMatchObject({ _tag: "PortCollision", alias: "nixbox-primer", localPort: occupiedPort });

		const leases = new AliasLeaseStore(join(directory, "aliases"));
		const stale = {
			version: 1 as const,
			forwardId: "nixbox-agents-primer",
			pid: 2_147_483_646,
			alias: "nixbox-primer",
			localPort: 18_641,
			configPath: "/tmp/config.json",
		};
		leases.acquire(stale);
		leases.acquire({ ...stale, pid: process.pid });
		expect(leases.read("nixbox-primer")?.pid).toBe(process.pid);

		leases.release("nixbox-primer", stale.forwardId, process.pid);
		leases.acquire({ ...stale, forwardId: "desktop-agents-primer" });
		let held: unknown;
		try {
			leases.acquire({ ...stale, pid: process.pid });
		} catch (problem) {
			held = problem;
		}
		expect(held).toBeInstanceOf(LeaseHeldByAnotherOwner);
		expect((held as LeaseHeldByAnotherOwner).detail()).toMatchObject({
			_tag: "LeaseHeldByAnotherOwner",
			alias: "nixbox-primer",
			forwardId: "nixbox-agents-primer",
			holderForwardId: "desktop-agents-primer",
		});
	});

	test("builds loopback-only SSH forwards and no-focus cmux commands for mapped workspaces", async () => {
		const directory = freshDirectory();
		const localPort = await freePort();
		const mappings = [
			["harness", "workspace:7"],
			["primer", "workspace:2"],
			["companion", "workspace:3"],
			["playground", "workspace:4"],
		] as const;
		for (const [stream, workspace] of mappings) {
			const forwardConfig = config(directory, "nixbox", stream, localPort, `nixbox-${stream}`, workspace);
			const target = { ...forwardConfig.targets[0], remotePort: 4_177, url: `https://nixbox-${stream}.localhost/` };
			const ssh = buildSshForwardArguments(forwardConfig, [target]);
			expect(ssh).toContain(`127.0.0.1:${localPort}:127.0.0.1:4177`);
			expect(ssh.join(" ")).not.toContain("0.0.0.0");
			expect(ssh).toContain("-N");
			// Without this the master forks into the background under a PID nothing recorded or reaps.
			expect(ssh).toContain("ControlPersist=no");
			expect(buildCmuxBrowserCommands(forwardConfig, [target])).toEqual([
				[forwardConfig.cmux, "browser", "open", target.url, "--workspace", workspace, "--focus", "false"],
			]);
		}
	});

	test("projects a supervisor whose process is gone as dead rather than healthy", async () => {
		const directory = freshDirectory();
		const localPort = await freePort();
		const forwardConfig = config(directory, "nixbox", "primer", localPort, "nixbox-primer");
		forwardConfig.cmux = stubExecutable(directory, "cmux-refusing", 'echo "workspace not found" >&2\nexit 3');
		const target = { ...forwardConfig.targets[0], remotePort: 4_177, url: "https://nixbox-primer.localhost/" };
		const ownerToken = crypto.randomUUID();
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		const configPath = join(forwardConfig.stateDir, "config.json");
		writeFileSync(configPath, JSON.stringify(forwardConfig));
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${process.pid}\n`);
		writeFileSync(
			join(forwardConfig.stateDir, "supervisor.lock"),
			JSON.stringify({ version: 1, token: ownerToken, pid: process.pid }),
		);
		writeFileSync(
			join(forwardConfig.stateDir, "state.json"),
			JSON.stringify({
				version: 1,
				id: forwardConfig.id,
				pid: process.pid,
				supervisorIdentity: readProcessIdentity(process.pid),
				ownerToken,
				running: true,
				phase: "healthy",
				attempt: 0,
				configDigest: "fixture",
				updatedAt: new Date().toISOString(),
				lastError: null,
				targets: [target],
			}),
		);
		const open = Bun.spawn([process.execPath, SUPERVISOR, "open", "--config", configPath], {
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await open.exited).toBe(1);
		const browserError = JSON.parse(readFileSync(join(forwardConfig.stateDir, "browser.json"), "utf8"))[0];
		expect(browserError).toMatchObject({ status: "error", workspace: "workspace:2" });
		expect(JSON.parse(browserError.error)).toMatchObject({
			_tag: "BrowserOpenFailed",
			target: "primer",
			message: "workspace not found",
		});

		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "2147483646\n");
		writeFileSync(
			join(forwardConfig.stateDir, "supervisor.lock"),
			JSON.stringify({ version: 1, token: ownerToken, pid: 2_147_483_646 }),
		);
		const status = Bun.spawn([process.execPath, SUPERVISOR, "status", "--config", configPath], { stdout: "pipe" });
		const [statusExit, statusOutput] = await Promise.all([status.exited, new Response(status.stdout).text()]);
		expect(statusExit).toBe(0);
		const projected = JSON.parse(statusOutput);
		expect(projected).toMatchObject({ running: false, phase: "dead", targets: [] });
		expect(projected.lastError).toMatchObject({ _tag: "StaleSupervisor", forwardId: forwardConfig.id });

		const reopen = Bun.spawn([process.execPath, SUPERVISOR, "open", "--config", configPath], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [reopenExit, reopenError] = await Promise.all([reopen.exited, new Response(reopen.stderr).text()]);
		expect(reopenExit).toBe(1);
		expect(JSON.parse(reopenError)).toMatchObject({ _tag: "BackendAbsent" });
	});

	test("leaves failed-identity startup ownership until a later contender proves ESRCH", async () => {
		const directory = freshDirectory();
		const barrierDirectory = freshDirectory();
		const readyPath = join(barrierDirectory, "owner-ready");
		const releasePath = join(barrierDirectory, "owner-release");
		stubExecutable(
			barrierDirectory,
			"ps",
			`: > "$BARRIER_READY"\n${awaitRelease("BARRIER_RELEASE")}\nexit 1`,
		);
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		forwardConfig.ssh = stubExecutable(directory, "ssh-unreachable", "exit 255");
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		const configPath = join(forwardConfig.stateDir, "config.json");
		writeFileSync(configPath, JSON.stringify(forwardConfig));
		const owner = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
			env: {
				...process.env,
				PATH: `${barrierDirectory}:${process.env.PATH ?? ""}`,
				BARRIER_READY: readyPath,
				BARRIER_RELEASE: releasePath,
			},
		});
		daemonPids.push(owner.pid);
		await waitForPath(readyPath);
		const lockBeforeFailure = readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8");
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(owner.pid));
		expect(existsSync(join(forwardConfig.stateDir, "state.json"))).toBe(false);

		const contender = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		daemonPids.push(contender.pid);
		try {
			const contenderExit = await Promise.race([contender.exited, Bun.sleep(2_000).then(() => null)]);
			if (contenderExit === null) {
				contender.kill("SIGKILL");
				await contender.exited;
			}
			const contenderError = await new Response(contender.stderr).text();
			expect(contenderExit).toBe(1);
			expect(JSON.parse(contenderError)).toMatchObject({
				_tag: "SupervisorIdentityUnavailable",
				forwardId: forwardConfig.id,
				pid: owner.pid,
			});
			expect(readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8")).toBe(lockBeforeFailure);
			expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(owner.pid));
		} finally {
			writeFileSync(releasePath, "release\n");
		}

		const [ownerExit, ownerError] = await Promise.all([owner.exited, new Response(owner.stderr).text()]);
		expect(ownerExit).toBe(1);
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8")).toBe(lockBeforeFailure);
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(owner.pid));
		expect(JSON.parse(ownerError)).toMatchObject({
			_tag: "SupervisorIdentityUnavailable",
			forwardId: forwardConfig.id,
			pid: owner.pid,
		});

		const successor = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		daemonPids.push(successor.pid);
		await waitForPath(join(forwardConfig.stateDir, "state.json"));
		const successorOwner = JSON.parse(readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8"));
		expect(successorOwner).toMatchObject({ version: 1, pid: successor.pid });
		expect(successorOwner.token).not.toBe(JSON.parse(lockBeforeFailure).token);
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(successor.pid));
	}, 10_000);

	test("keeps a new lock incarnation when stale state names its reused PID", async () => {
		const directory = freshDirectory();
		const barrierDirectory = freshDirectory();
		const wrapperReadyPath = join(barrierDirectory, "wrapper-ready");
		const wrapperReleasePath = join(barrierDirectory, "wrapper-release");
		const ownerReadyPath = join(barrierDirectory, "owner-ready");
		const ownerReleasePath = join(barrierDirectory, "owner-release");
		const realPs = Bun.which("ps");
		if (realPs === null) throw new Error("ps is required for the process-identity test");
		stubExecutable(
			barrierDirectory,
			"ps",
			`: > "$OWNER_READY"\n${awaitRelease("OWNER_RELEASE")}\nexec "$REAL_PS" "$@"`,
		);
		const wrapper = stubExecutable(
			barrierDirectory,
			"owner-wrapper",
			`: > "$WRAPPER_READY"\n${awaitRelease("WRAPPER_RELEASE")}\nexec "$BUN" "$SUPERVISOR" run --config "$CONFIG"`,
		);
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		forwardConfig.ssh = stubExecutable(directory, "ssh-unreachable", "exit 255");
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		const configPath = join(forwardConfig.stateDir, "config.json");
		writeFileSync(configPath, JSON.stringify(forwardConfig));
		const owner = Bun.spawn([wrapper], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			env: {
				...process.env,
				PATH: `${barrierDirectory}:${process.env.PATH ?? ""}`,
				WRAPPER_READY: wrapperReadyPath,
				WRAPPER_RELEASE: wrapperReleasePath,
				OWNER_READY: ownerReadyPath,
				OWNER_RELEASE: ownerReleasePath,
				REAL_PS: realPs,
				BUN: process.execPath,
				SUPERVISOR,
				CONFIG: configPath,
			},
		});
		daemonPids.push(owner.pid);
		await waitForPath(wrapperReadyPath);
		const currentIdentity = readProcessIdentity(owner.pid);
		if (currentIdentity === null) throw new Error("Could not fingerprint the future lock owner");
		const staleToken = crypto.randomUUID();
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${owner.pid}\n`);
		writeFileSync(
			join(forwardConfig.stateDir, "state.json"),
			JSON.stringify({
				version: 1,
				id: forwardConfig.id,
				pid: owner.pid,
				supervisorIdentity: {
					...currentIdentity,
					startFingerprint: `${currentIdentity.startFingerprint} stale incarnation`,
				},
				ownerToken: staleToken,
				running: true,
				phase: "healthy",
				attempt: 0,
				configDigest: "stale-fixture",
				updatedAt: new Date().toISOString(),
				lastError: null,
				targets: [],
			}),
		);
		writeFileSync(wrapperReleasePath, "release\n");
		await waitForPath(ownerReadyPath);
		const ownerLock = readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8");
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(owner.pid));

		const contender = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		daemonPids.push(contender.pid);
		try {
			const contenderExit = await Promise.race([contender.exited, Bun.sleep(2_000).then(() => null)]);
			if (contenderExit === null) {
				contender.kill("SIGKILL");
				await contender.exited;
			}
			const contenderError = await new Response(contender.stderr).text();
			expect(contenderExit).toBe(1);
			expect(JSON.parse(contenderError)).toMatchObject({
				_tag: "SupervisorIdentityUnavailable",
				forwardId: forwardConfig.id,
				pid: owner.pid,
			});
			expect(readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8")).toBe(ownerLock);
			expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(owner.pid));
			const currentOwner = JSON.parse(ownerLock);
			expect(currentOwner).toMatchObject({ version: 1, pid: owner.pid });
			expect(currentOwner.token).not.toBe(staleToken);
		} finally {
			writeFileSync(ownerReleasePath, "release\n");
		}
	}, 12_000);

	test("revalidates the full tuple at a barrier immediately before signaling its identity PID", async () => {
		const directory = freshDirectory();
		const readyPath = join(directory, "sentinel-ready");
		const signalPath = join(directory, "sentinel-signaled");
		const sentinel = Bun.spawn(
			[
				process.execPath,
				"-e",
				'process.on("SIGUSR1", () => { void Bun.write(process.env.SIGNAL_PATH, "signaled\\n"); }); await Bun.write(process.env.READY_PATH, "ready\\n"); setInterval(() => {}, 1_000);',
			],
			{
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				env: { ...process.env, READY_PATH: readyPath, SIGNAL_PATH: signalPath },
			},
		);
		daemonPids.push(sentinel.pid);
		await waitForPath(readyPath);
		const identity = readProcessIdentity(sentinel.pid);
		if (identity === null) throw new Error("Could not fingerprint signal sentinel");

		let releaseBarrier!: () => void;
		const released = new Promise<void>((resolve) => {
			releaseBarrier = resolve;
		});
		let reachBarrier!: () => void;
		const reached = new Promise<void>((resolve) => {
			reachBarrier = resolve;
		});
		let currentIdentity = identity;
		const signaling = signalProcessIdentity("nixbox-agents-primer", identity, "SIGUSR1", {
			beforeRevalidation: async () => {
				reachBarrier();
				await released;
			},
			readCurrent: () => currentIdentity,
		});
		await reached;
		currentIdentity = { ...identity, startFingerprint: `${identity.startFingerprint} reused` };
		releaseBarrier();
		const failure = await signaling.catch((problem) => problem);
		expect(failure).toBeInstanceOf(StaleSupervisor);
		await Bun.sleep(100);
		expect(existsSync(signalPath)).toBe(false);
	});

	test("reclaims a stale tuple without signaling the reused PID", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		forwardConfig.ssh = stubExecutable(directory, "ssh-cleanup", "exit 0");
		forwardConfig.node = stubExecutable(directory, "node-cleanup", "exit 0");
		forwardConfig.portless = stubExecutable(directory, "portless-cleanup", "exit 0");
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		const configPath = join(forwardConfig.stateDir, "config.json");
		writeFileSync(configPath, JSON.stringify(forwardConfig));

		const imposter = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		daemonPids.push(imposter.pid);
		let identity = readProcessIdentity(imposter.pid);
		for (let attempt = 0; identity === null && attempt < 20; attempt += 1) {
			await Bun.sleep(10);
			identity = readProcessIdentity(imposter.pid);
		}
		expect(identity).not.toBeNull();
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${imposter.pid}\n`);
		const ownerToken = crypto.randomUUID();
		writeFileSync(
			join(forwardConfig.stateDir, "supervisor.lock"),
			JSON.stringify({ version: 1, token: ownerToken, pid: imposter.pid }),
		);
		writeFileSync(
			join(forwardConfig.stateDir, "state.json"),
			JSON.stringify({
				version: 1,
				id: forwardConfig.id,
				pid: imposter.pid,
				supervisorIdentity: { ...identity!, startFingerprint: `${identity!.startFingerprint} reused` },
				ownerToken,
				running: true,
				phase: "healthy",
				attempt: 0,
				configDigest: "fixture",
				updatedAt: new Date().toISOString(),
				lastError: null,
				targets: [],
			}),
		);

		const stop = Bun.spawn([process.execPath, SUPERVISOR, "stop", "--config", configPath], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			stop.exited,
			new Response(stop.stdout).text(),
			new Response(stop.stderr).text(),
		]);
		if (exitCode !== 0) throw new Error(stderr);
		expect(() => process.kill(imposter.pid, 0)).not.toThrow();
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ phase: "stopped", running: false, pid: imposter.pid });
	});

	test("old owner finally preserves a replacement lock incarnation", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		const oldOwner = { version: 1 as const, token: crypto.randomUUID(), pid: process.pid };
		const newOwner = { version: 1 as const, token: crypto.randomUUID(), pid: process.pid + 1 };
		writeFileSync(join(forwardConfig.stateDir, "supervisor.lock"), `${JSON.stringify(oldOwner)}\n`);
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${oldOwner.pid}\n`);

		let reachBarrier!: () => void;
		const reached = new Promise<void>((resolve) => {
			reachBarrier = resolve;
		});
		let releaseBarrier!: () => void;
		const released = new Promise<void>((resolve) => {
			releaseBarrier = resolve;
		});
		const supervisorModule = await import("./remote-forward-supervisor");
		const releaseOwnership = Reflect.get(supervisorModule, "releaseSupervisorOwnership");
		if (typeof releaseOwnership !== "function") throw new Error("releaseSupervisorOwnership is unavailable");
		const releasing = releaseOwnership(forwardConfig, oldOwner, {
			beforeCompare: async () => {
				reachBarrier();
				await released;
			},
		}) as Promise<boolean>;
		await reached;
		writeFileSync(join(forwardConfig.stateDir, "supervisor.lock"), `${JSON.stringify(newOwner)}\n`);
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${newOwner.pid}\n`);
		releaseBarrier();

		expect(await releasing).toBe(false);
		expect(JSON.parse(readFileSync(join(forwardConfig.stateDir, "supervisor.lock"), "utf8"))).toEqual(newOwner);
		expect(readFileSync(join(forwardConfig.stateDir, "supervisor.pid"), "utf8").trim()).toBe(String(newOwner.pid));
	});

	test("parses only exact Portless localhost routes", () => {
		const routes = parsePortlessRoutes(
			`\n  https://nixbox-primer.localhost  ->  localhost:18641  (alias)\n  https://other.localhost  ->  0.0.0.0:9999  (alias)\n`,
		);
		expect(routes.get("nixbox-primer")).toEqual({ alias: "nixbox-primer", port: 18_641, kind: "alias" });
		expect(routes.has("other")).toBe(false);
	});

	test("decodes review target kinds and refuses ambiguous local bindings", () => {
		const directory = freshDirectory();
		const base = config(directory, "nixbox", "harness", 18_640, "nixbox-harness", "workspace:7", "static");
		expect(validateForwardConfig(JSON.parse(JSON.stringify(base))).targets[0].kind).toBe("static");

		const badKind = JSON.parse(JSON.stringify(base));
		badKind.targets[0].kind = "tunnel";
		expect(() => validateForwardConfig(badKind)).toThrow("targets[0].kind");

		const duplicateAlias = JSON.parse(JSON.stringify(base));
		duplicateAlias.targets.push({ ...duplicateAlias.targets[0], localPort: 18_646 });
		expect(() => validateForwardConfig(duplicateAlias)).toThrow("Duplicate local alias");

		const duplicatePort = JSON.parse(JSON.stringify(base));
		duplicatePort.targets.push({ ...duplicatePort.targets[0], alias: "nixbox-harness-report" });
		expect(() => validateForwardConfig(duplicatePort)).toThrow("Duplicate local port");
	});
	test("recreates a missing owned alias and rejects changed lease ownership", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		const routeFile = join(directory, "route.txt");
		const portless = stubExecutable(
			directory,
			"portless-real",
			`route=${routeFile}
if [ "$1" = list ]; then [ ! -f "$route" ] || cat "$route"; exit 0; fi
if [ "$2" = --remove ]; then rm -f "$route"; exit 0; fi
printf 'https://%s.localhost -> localhost:%s (alias)\\n' "$2" "$3" > "$route"`,
		);
		forwardConfig.node = "/usr/bin/env";
		forwardConfig.portless = portless;
		const target = { ...forwardConfig.targets[0], remotePort: 41_111, url: "https://nixbox-primer.localhost/" };
		const publisher = new PortlessRoutePublisher(forwardConfig, join(directory, "config.json"), 1_000);
		await publisher.publish(forwardConfig, [target]);
		rmSync(routeFile);
		await publisher.reconcileHealthy(forwardConfig, [target]);
		expect(readFileSync(routeFile, "utf8")).toContain(`localhost:${target.localPort}`);

		const leasePath = publisher.leases.leasePath(target.alias);
		const changed = JSON.parse(readFileSync(leasePath, "utf8"));
		changed.forwardId = "other-forward";
		writeFileSync(leasePath, JSON.stringify(changed));
		await expect(publisher.reconcileHealthy(forwardConfig, [target])).rejects.toBeInstanceOf(LeaseHeldByAnotherOwner);
	});

	test("retains failed route cleanup and retries it on the next reconcile", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "primer", await freePort(), "nixbox-primer");
		const routeFile = join(directory, "route.txt");
		const failures = join(directory, "remove-failures");
		forwardConfig.node = "/usr/bin/env";
		forwardConfig.portless = stubExecutable(
			directory,
			"portless-retry",
			`route=${routeFile}
failures=${failures}
if [ "$1" = list ]; then [ ! -f "$route" ] || cat "$route"; exit 0; fi
if [ "$2" = --remove ]; then
  if [ -f "$failures" ]; then n=$(cat "$failures"); if [ "$n" -gt 0 ]; then echo $((n-1)) > "$failures"; exit 7; fi; fi
  rm -f "$route"; exit 0
fi
printf 'https://%s.localhost -> localhost:%s (alias)\\n' "$2" "$3" > "$route"`,
		);
		const resolver = new MutableLoopbackResolver(forwardConfig.targets);
		const initialPort = resolver.state.ports.get("primer")!;
		const nextPort = initialPort + 1;
		const transport = new LoopbackHttpTunnelTransport(new Map([[initialPort, "first"], [nextPort, "second"]]));
		const supervisor = new ForwardSupervisor(forwardConfig, {
			resolver,
			transport,
			routes: new PortlessRoutePublisher(forwardConfig, join(directory, "config.json"), 1_000),
		});
		expect((await supervisor.reconcileOnce()).phase).toBe("healthy");
		writeFileSync(failures, "2\n");
		resolver.state.ports.set("primer", nextPort);
		expect((await supervisor.reconcileOnce()).phase).toBe("degraded");
		const recovered = await supervisor.reconcileOnce();
		expect(recovered.phase).toBe("healthy");
		expect(await fetch(`http://127.0.0.1:${forwardConfig.targets[0].localPort}/`).then((response) => response.text())).toBe("second");
		await supervisor.stop();
	});

	test("keeps live targets available through independent degradation and permits degraded open", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness", "workspace:7");
		const staticTarget: ForwardTargetConfig = {
			name: "report",
			kind: "static",
			alias: "nixbox-report",
			localPort: await freePort(),
			path: "/report",
			artifactDigest: "0".repeat(64),
		};
		forwardConfig.targets.push(staticTarget);
		const live = { ...forwardConfig.targets[0], remotePort: 42_001, url: "https://nixbox-harness.localhost/" };
		const degradation = {
			target: staticTarget,
			error: new StaticArtifactRejected("report.html", "missing", "report unavailable").detail(),
		};
		const transport = new LoopbackHttpTunnelTransport(new Map([[live.remotePort, "live"]]));
		const supervisor = new ForwardSupervisor(forwardConfig, {
			resolver: { async resolveTargets() { return { available: [live], degradations: [degradation] }; } },
			transport,
			routes: new LeaseBackedRoutes(join(directory, "aliases")),
		});
		const degraded = await supervisor.reconcileOnce();
		expect(degraded).toMatchObject({ phase: "degraded", targets: [{ name: "harness" }] });
		expect(degraded.degradations).toHaveLength(1);

		forwardConfig.cmux = stubExecutable(directory, "cmux-ok", "exit 0");
		const configPath = join(forwardConfig.stateDir, "config.json");
		writeFileSync(configPath, JSON.stringify(forwardConfig));
		const ownerToken = crypto.randomUUID();
		writeFileSync(join(forwardConfig.stateDir, "supervisor.pid"), `${process.pid}\n`);
		writeFileSync(join(forwardConfig.stateDir, "supervisor.lock"), JSON.stringify({ version: 1, token: ownerToken, pid: process.pid }));
		writeFileSync(
			join(forwardConfig.stateDir, "state.json"),
			JSON.stringify({ ...degraded, ownerToken, supervisorIdentity: readProcessIdentity(process.pid) }),
		);
		const opened = Bun.spawn([process.execPath, SUPERVISOR, "open", "--config", configPath,], { stdout: "pipe", stderr: "pipe" });
		expect(await opened.exited).toBe(0);
		expect(JSON.parse(readFileSync(join(forwardConfig.stateDir, "browser.json"), "utf8"))).toEqual([
			expect.objectContaining({ name: "harness", status: "opened" }),
		]);
		await supervisor.stop();
	});

	test(
		"reaps the pending tunnel child when a stop lands inside the readiness wait",
		async () => {
			const directory = freshDirectory();
			const localPort = await freePort();
			const forwardConfig = config(directory, "nixbox", "harness", localPort, "nixbox-harness", "workspace:7");
			// The control master never comes up, so readiness can never finish and the stop always lands
			// inside the wait — the exact window that used to leak an ssh child holding the review ports.
			const stub = tunnelStub(directory, "ssh-barrier", [localPort], { controlExit: 1, backend: "accept" });
			forwardConfig.ssh = stub.ssh;
			const target = { ...forwardConfig.targets[0], remotePort: 42_101, url: "https://nixbox-harness.localhost/" };
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: [target], degradations: [] }; } },
				transport: new SshTunnelTransport({ ...FAST_TUNNEL, readyAttempts: 200, readyIntervalMs: 50 }),
				routes: new LeaseBackedRoutes(join(directory, "aliases")),
			});

			const reconcile = supervisor.reconcileOnce();
			const record = await waitForTunnelRecord(forwardConfig);
			await waitForPath(stub.pidFile, 10_000);
			const childPid = Number(readFileSync(stub.pidFile, "utf8").trim());
			daemonPids.push(childPid);
			expect(record.pid).toBe(childPid);
			expect(readForwardState(forwardConfig).phase).toBe("starting");
			expect(pidAlive(childPid)).toBe(true);
			expect(await portsFree([localPort])).toBe(false);

			expect((await supervisor.stop()).phase).toBe("stopped");
			await waitForPidExit(childPid);
			expect((await reconcile).phase).toBe("degraded");
			expect(readForwardState(forwardConfig).tunnel).toBeNull();
			expect(await portsFree([localPort])).toBe(true);
		},
		30_000,
	);

	test(
		"leaves no tunnel child and no occupied port when readiness fails",
		async () => {
			const directory = freshDirectory();
			const localPort = await freePort();
			const forwardConfig = config(directory, "nixbox", "harness", localPort, "nixbox-harness", "workspace:7");
			// The master reports healthy but the forwarded channel closes every connection, so readiness
			// fails on the backend probe rather than on the transport.
			const refusing = tunnelStub(directory, "ssh-refuse", [localPort], { controlExit: 0, backend: "refuse" });
			forwardConfig.ssh = refusing.ssh;
			const target = { ...forwardConfig.targets[0], remotePort: 42_102, url: "https://nixbox-harness.localhost/" };
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: [target], degradations: [] }; } },
				transport: new SshTunnelTransport(FAST_TUNNEL),
				routes: new LeaseBackedRoutes(join(directory, "aliases")),
			});

			const degraded = await supervisor.reconcileOnce();
			expect(degraded.phase).toBe("degraded");
			expect(degraded.lastError?._tag).toBe("BackendAbsent");
			expect(degraded.tunnel).toBeNull();
			await waitForPath(refusing.pidFile, 10_000);
			await waitForPidExit(Number(readFileSync(refusing.pidFile, "utf8").trim()));
			expect(await portsFree([localPort])).toBe(true);
		},
		30_000,
	);

	test(
		"rebinds the review ports a failed reconcile released",
		async () => {
			const directory = freshDirectory();
			const localPort = await freePort();
			const forwardConfig = config(directory, "nixbox", "harness", localPort, "nixbox-harness", "workspace:7");
			const refusing = tunnelStub(directory, "ssh-reuse-refuse", [localPort], { controlExit: 0, backend: "refuse" });
			forwardConfig.ssh = refusing.ssh;
			const target = { ...forwardConfig.targets[0], remotePort: 42_104, url: "https://nixbox-harness.localhost/" };
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: [target], degradations: [] }; } },
				transport: new SshTunnelTransport(FAST_TUNNEL),
				routes: new LeaseBackedRoutes(join(directory, "aliases")),
			});
			expect((await supervisor.reconcileOnce()).phase).toBe("degraded");

			// Before the fix this second pass failed with PortCollision: the first attempt's child was
			// still bound to the review port that no supervisor owned any more.
			const accepting = tunnelStub(directory, "ssh-reuse-accept", [localPort], { controlExit: 0, backend: "accept" });
			forwardConfig.ssh = accepting.ssh;
			const healthy = await supervisor.reconcileOnce();
			expect(healthy.phase).toBe("healthy");
			expect(decodeTunnelChildRecord(healthy.tunnel)?.localPorts).toEqual([localPort]);
			await waitForPath(accepting.pidFile, 10_000);
			const reusedPid = Number(readFileSync(accepting.pidFile, "utf8").trim());
			daemonPids.push(reusedPid);

			expect((await supervisor.stop()).phase).toBe("stopped");
			await waitForPidExit(reusedPid);
			expect(readForwardState(forwardConfig).tunnel).toBeNull();
			expect(await portsFree([localPort])).toBe(true);
		},
		30_000,
	);

	test(
		"a successor reaps the tunnel child a killed supervisor left holding the review ports",
		async () => {
			const directory = freshDirectory();
			const localPort = await freePort();
			const forwardConfig = config(directory, "nixbox", "harness", localPort, "nixbox-harness", "workspace:7");
			const review = [
				{
					name: "harness",
					kind: "portless",
					alias: "nixbox-harness",
					path: "/",
					artifactDigest: null,
					status: "healthy",
					remotePort: 42_103,
				},
			];
			// The master never answers a control check, so every incarnation stays inside its readiness
			// wait and a SIGKILL reproduces the crash that used to strand the child.
			const stub = tunnelStub(directory, "ssh-daemon", [localPort], { controlExit: 1, backend: "accept", review });
			forwardConfig.ssh = stub.ssh;
			forwardConfig.node = stubExecutable(directory, "portless-noop", "exit 0");
			forwardConfig.portless = forwardConfig.node;
			mkdirSync(forwardConfig.stateDir, { recursive: true });
			const configPath = join(directory, "forward-config.json");
			writeFileSync(configPath, JSON.stringify(forwardConfig));

			const crashed = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			daemonPids.push(crashed.pid);
			const stranded = await waitForTunnelRecord(forwardConfig, 20_000);
			await waitForPath(stub.pidFile, 10_000);
			daemonPids.push(stranded.pid);
			crashed.kill("SIGKILL");
			await crashed.exited;
			// The orphan this change exists to prevent: the child outlives its supervisor holding the port.
			expect(pidAlive(stranded.pid)).toBe(true);
			expect(await portsFree([localPort])).toBe(false);

			const successor = Bun.spawn([process.execPath, SUPERVISOR, "run", "--config", configPath], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			daemonPids.push(successor.pid);
			await waitForPidExit(stranded.pid, 20_000);
			const replacement = await waitForTunnelRecord(forwardConfig, 20_000, stranded);
			expect(replacement.pid).not.toBe(stranded.pid);
			daemonPids.push(replacement.pid);

			successor.kill("SIGKILL");
			await successor.exited;
			const stopped = Bun.spawn([process.execPath, SUPERVISOR, "stop", "--config", configPath], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(await stopped.exited).toBe(0);
			await waitForPidExit(replacement.pid, 20_000);
			expect(readForwardState(forwardConfig).tunnel).toBeNull();
			expect(await portsFree([localPort])).toBe(true);
		},
		90_000,
	);

	test(
		"opens the reachable review target while one forwarded backend stays dead",
		async () => {
			const directory = freshDirectory();
			const livePort = await freePort();
			const deadPort = await freePort();
			const forwardConfig = pairedConfig(directory, livePort, deadPort);
			// One master, two forwards, one dead remote backend: the exact shape the live smoke hit.
			const stub = tunnelStub(directory, "ssh-mixed", [livePort, deadPort], {
				controlExit: 0,
				backend: "accept",
				refuse: [deadPort],
			});
			forwardConfig.ssh = stub.ssh;
			const resolved = resolvedPair(forwardConfig);
			const routes = new LeaseBackedRoutes(join(directory, "aliases"));
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: resolved, degradations: [] }; } },
				transport: new SshTunnelTransport(FAST_TUNNEL),
				routes,
			});

			const state = await supervisor.reconcileOnce();
			await waitForPath(stub.pidFile, 10_000);
			const childPid = Number(readFileSync(stub.pidFile, "utf8").trim());
			daemonPids.push(childPid);

			expect(state.phase).toBe("degraded");
			expect(state.targets.map((target) => target.name)).toEqual(["companion"]);
			expect(state.degradations).toHaveLength(1);
			expect(state.degradations[0].target.name).toBe("xanadu");
			expect(state.degradations[0].error).toMatchObject({ _tag: "BackendAbsent", target: "xanadu", kind: "direct" });
			// The child survives and keeps both forwards bound, so the dead backend can still come back.
			expect(decodeTunnelChildRecord(state.tunnel)?.pid).toBe(childPid);
			expect(decodeTunnelChildRecord(state.tunnel)?.localPorts).toEqual([livePort, deadPort]);
			expect(await portsFree([livePort, deadPort])).toBe(false);
			// Only the reachable target is published, leased, and therefore openable.
			expect(routes.published.map((target) => target.alias)).toEqual(["desktop-companion"]);
			expect(routes.store.read("desktop-companion")?.localPort).toBe(livePort);
			expect(routes.store.read("desktop-xanadu")).toBeNull();

			expect((await supervisor.stop()).phase).toBe("stopped");
			await waitForPidExit(childPid);
			expect(await portsFree([livePort, deadPort])).toBe(true);
		},
		30_000,
	);

	test(
		"reaps the tunnel and records every dead backend when nothing answers",
		async () => {
			const directory = freshDirectory();
			const firstPort = await freePort();
			const secondPort = await freePort();
			const forwardConfig = pairedConfig(directory, firstPort, secondPort);
			const stub = tunnelStub(directory, "ssh-all-dead", [firstPort, secondPort], {
				controlExit: 0,
				backend: "refuse",
			});
			forwardConfig.ssh = stub.ssh;
			const resolved = resolvedPair(forwardConfig);
			const routes = new LeaseBackedRoutes(join(directory, "aliases"));
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: resolved, degradations: [] }; } },
				transport: new SshTunnelTransport(FAST_TUNNEL),
				routes,
			});

			const state = await supervisor.reconcileOnce();
			expect(state.phase).toBe("degraded");
			expect(state.targets).toEqual([]);
			// Every dead backend is named, not just the first one that failed a probe.
			expect(state.degradations.map((entry) => entry.target.name)).toEqual(["companion", "xanadu"]);
			expect(state.lastError).toMatchObject({ _tag: "BackendAbsent", target: "companion" });
			expect(state.tunnel).toBeNull();
			expect(routes.published).toEqual([]);
			await waitForPath(stub.pidFile, 10_000);
			await waitForPidExit(Number(readFileSync(stub.pidFile, "utf8").trim()));
			expect(await portsFree([firstPort, secondPort])).toBe(true);
		},
		30_000,
	);

	test(
		"republishes a recovered backend and releases a dying one on the same tunnel child",
		async () => {
			const directory = freshDirectory();
			const livePort = await freePort();
			const deadPort = await freePort();
			const forwardConfig = pairedConfig(directory, livePort, deadPort);
			const stub = tunnelStub(directory, "ssh-recovery", [livePort, deadPort], {
				controlExit: 0,
				backend: "accept",
				refuse: [deadPort],
			});
			forwardConfig.ssh = stub.ssh;
			const resolved = resolvedPair(forwardConfig);
			const routes = new LeaseBackedRoutes(join(directory, "aliases"));
			const supervisor = new ForwardSupervisor(forwardConfig, {
				resolver: { async resolveTargets() { return { available: resolved, degradations: [] }; } },
				transport: new SshTunnelTransport(FAST_TUNNEL),
				routes,
			});

			expect((await supervisor.reconcileOnce()).phase).toBe("degraded");
			await waitForPath(stub.pidFile, 10_000);
			const childPid = Number(readFileSync(stub.pidFile, "utf8").trim());
			daemonPids.push(childPid);
			expect(routes.published.map((target) => target.alias)).toEqual(["desktop-companion"]);

			writeFileSync(stub.revive, "");
			const recovered = await supervisor.reconcileOnce();
			expect(recovered.phase).toBe("healthy");
			expect(recovered.degradations).toEqual([]);
			expect(recovered.targets.map((target) => target.name)).toEqual(["companion", "xanadu"]);
			expect(routes.published.map((target) => target.alias)).toEqual(["desktop-companion", "desktop-xanadu"]);
			expect(routes.store.read("desktop-xanadu")?.localPort).toBe(deadPort);
			// Recovery publishes a route; it never restarts the child that already forwards the port.
			expect(decodeTunnelChildRecord(recovered.tunnel)?.pid).toBe(childPid);
			expect(Number(readFileSync(stub.pidFile, "utf8").trim())).toBe(childPid);

			rmSync(stub.revive, { force: true });
			const relapsed = await supervisor.reconcileOnce();
			expect(relapsed.phase).toBe("degraded");
			expect(relapsed.targets.map((target) => target.name)).toEqual(["companion"]);
			// The alias that died is released on its own; the target that never moved keeps its lease.
			expect(routes.store.read("desktop-xanadu")).toBeNull();
			expect(routes.store.read("desktop-companion")?.localPort).toBe(livePort);
			expect(routes.published.map((target) => target.alias)).toEqual(["desktop-companion"]);
			expect(decodeTunnelChildRecord(relapsed.tunnel)?.pid).toBe(childPid);

			expect((await supervisor.stop()).phase).toBe("stopped");
			await waitForPidExit(childPid);
			expect(await portsFree([livePort, deadPort])).toBe(true);
		},
		30_000,
	);

});

describe("ssh backend resolution", () => {
	test("separates an unreachable host from an absent backend", async () => {
		const directory = freshDirectory();
		const unreachable = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness", "workspace:7");
		unreachable.ssh = stubExecutable(directory, "ssh-unreachable", 'echo "ssh: connect to host nixbox port 22" >&2\nexit 255');
		const transportFailure = await new SshTargetResolver().resolveTargets(unreachable).catch((problem) => problem);
		expect(transportFailure).toBeInstanceOf(HostUnreachable);
		expect(transportFailure.detail()).toMatchObject({ _tag: "HostUnreachable", host: "nixbox", exitCode: 255 });

		const portless = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness", "workspace:7");
		portless.ssh = stubExecutable(
			directory,
			"ssh-noport",
			`echo '${JSON.stringify([{ ...portless.targets[0], status: "degraded", remotePort: null, error: new BackendAbsent("harness", "portless", "missing").detail() }])}'`,
		);
		const absent = await new SshTargetResolver().resolveTargets(portless);
		expect(absent.available).toHaveLength(0);
		expect(absent.degradations[0]?.error).toMatchObject({ _tag: "BackendAbsent", target: "harness", kind: "portless" });

		const healthy = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness", "workspace:7", "static");
		healthy.ssh = stubExecutable(
			directory,
			"ssh-ok",
			`echo '${JSON.stringify([{ ...healthy.targets[0], status: "healthy", remotePort: 45_123 }])}'`,
		);
		const resolved = await new SshTargetResolver().resolveTargets(healthy);
		expect(resolved.available[0]).toMatchObject({
			remotePort: 45_123,
			kind: "static",
			url: "https://nixbox-harness.localhost/",
		});
	});
	test("degrades a direct target when SSH is alive but the forwarded backend is absent", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(
			directory,
			"nixbox",
			"harness",
			await freePort(),
			"nixbox-harness",
			"workspace:7",
			"direct",
		);
		mkdirSync(forwardConfig.stateDir, { recursive: true });
		forwardConfig.ssh = stubExecutable(
			directory,
			"ssh-master-only",
			'case " $* " in *" -O check "*) exit 0;; *" -O exit "*) exit 0;; esac\ntrap "exit 0" TERM\nwhile :; do sleep 1; done',
		);
		const target = { ...forwardConfig.targets[0], remotePort: 45_123, url: "https://nixbox-harness.localhost/" };
		const transport = new SshTunnelTransport();

		const supervisor = new ForwardSupervisor(forwardConfig, {
			resolver: { async resolveTargets() { return { available: [target], degradations: [] }; } },
			transport,
			routes: new LeaseBackedRoutes(join(directory, "aliases")),
		});
		const state = await supervisor.reconcileOnce();
		expect(state).toMatchObject({ phase: "degraded", lastError: { _tag: "BackendAbsent", kind: "direct" } });
	}, 15_000);

	test("caps subprocess diagnostics and appends the truncation marker", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness");
		forwardConfig.ssh = stubExecutable(directory, "ssh-loud", "printf '%070000d' 0 >&2\nexit 2");
		const failure = await new SshTargetResolver().resolveTargets(forwardConfig).catch((problem) => problem);
		expect(failure).toBeInstanceOf(BackendAbsent);
		expect((failure as BackendAbsent).message).toContain("[stderr truncated: kept 65536 of 70000 bytes]");
	});

	test("bounds a transport command and cancels inherited stream drains", async () => {
		const directory = freshDirectory();
		const forwardConfig = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness");
		forwardConfig.ssh = stubExecutable(directory, "ssh-hangs", "trap '' TERM\nsleep 5 &\nwait");
		const started = Date.now();
		const failure = await new SshTargetResolver(50).resolveTargets(forwardConfig).catch((problem) => problem);
		expect(failure).toBeInstanceOf(HostUnreachable);
		expect((failure as HostUnreachable).message).toContain("timed out");
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	test("degrades every exact metadata mismatch independently", async () => {
		const directory = freshDirectory();
		const base = config(directory, "nixbox", "harness", await freePort(), "nixbox-harness");
		const expected = base.targets[0];
		const mismatches: Array<Record<string, unknown>> = [
			{ ...expected, name: "other", status: "healthy", remotePort: 41_111 },
			{ ...expected, kind: "direct", status: "healthy", remotePort: 41_111 },
			{ ...expected, alias: "other-alias", status: "healthy", remotePort: 41_111 },
			{ ...expected, path: "/other", status: "healthy", remotePort: 41_111 },
			{ ...expected, artifactDigest: "0".repeat(64), status: "healthy", remotePort: 41_111 },
			{ ...expected, status: "unknown", remotePort: 41_111 },
		];
		for (const [index, candidate] of mismatches.entries()) {
			const forwardConfig = { ...base };
			forwardConfig.ssh = stubExecutable(directory, `ssh-mismatch-${index}`, `echo '${JSON.stringify([candidate])}'`);
			const resolution = await new SshTargetResolver().resolveTargets(forwardConfig);
			expect(resolution.available).toHaveLength(0);
			expect(resolution.degradations[0]?.error).toMatchObject({ _tag: "BackendAbsent" });
		}
	});

});

describe("bounded static review artifacts", () => {
	function artifactFixture(body = "<html><body>report</body></html>"): { root: string; artifact: string } {
		const root = freshDirectory();
		mkdirSync(join(root, "data", "harness"), { recursive: true });
		writeFileSync(join(root, "data", "harness", "reliability-report.html"), body);
		writeFileSync(join(root, "data", "harness", "style.css"), "body { color: red }");
		writeFileSync(join(root, "secret.txt"), "must not leak");
		return { root, artifact: "data/harness/reliability-report.html" };
	}

	test("refuses traversal, missing files, symlink escapes, and unrenderable types", () => {
		const { root, artifact } = artifactFixture();
		expect(resolveStaticArtifact(root, artifact).file).toBe(join(root, artifact));

		for (const [candidate, reason] of [
			["../etc/passwd", "unsafe-path"],
			["data/harness/../../secret.txt", "unsafe-path"],
			["data/harness/absent.html", "missing"],
			["data/harness/style.bin", "unsupported-type"],
		] as const) {
			const rejection = (() => {
				try {
					resolveStaticArtifact(root, candidate);
					return null;
				} catch (problem) {
					return problem;
				}
			})();
			expect(rejection).toBeInstanceOf(StaticArtifactRejected);
			expect((rejection as StaticArtifactRejected).reason).toBe(reason);
		}

		const outside = freshDirectory();
		writeFileSync(join(outside, "escape.html"), "<html>escaped</html>");
		symlinkSync(join(outside, "escape.html"), join(root, "data", "harness", "escape.html"));
		let escape: unknown;
		try {
			resolveStaticArtifact(root, "data/harness/escape.html");
		} catch (problem) {
			escape = problem;
		}
		expect(escape).toBeInstanceOf(StaticArtifactRejected);
		expect((escape as StaticArtifactRejected).reason).toBe("escapes-root");
	});

	test("serves the artifact and its siblings while refusing everything outside the bounds", async () => {
		const { root, artifact } = artifactFixture();
		const handle = startStaticServer(resolveStaticArtifact(root, artifact), FAST_BOUNDS, () => {});
		try {
			const origin = `http://127.0.0.1:${handle.port}`;
			const index = await fetch(`${origin}/`);
			expect(index.status).toBe(200);
			expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
			expect(await index.text()).toContain("report");

			expect((await fetch(`${origin}/style.css`)).status).toBe(200);
			expect((await fetch(`${origin}/../../secret.txt`)).status).toBe(404);
			expect((await fetch(`${origin}/%2e%2e%2f%2e%2e%2fsecret.txt`)).status).toBe(404);
			expect((await fetch(`${origin}/absent.html`)).status).toBe(404);
			expect((await fetch(`${origin}/`, { method: "POST" })).status).toBe(405);
		} finally {
			await handle.stop();
		}
	});

	test("refuses to serve an artifact larger than the configured byte bound", async () => {
		const { root, artifact } = artifactFixture("x".repeat(FAST_BOUNDS.maxBytes + 1));
		const handle = startStaticServer(resolveStaticArtifact(root, artifact), FAST_BOUNDS, () => {});
		try {
			expect((await fetch(`http://127.0.0.1:${handle.port}/`)).status).toBe(413);
		} finally {
			await handle.stop();
		}
	});

	test("serializes ensures and reuses one token-bound full-identity daemon", async () => {
		const { root, artifact } = artifactFixture();
		const stateDir = join(root, ".runtime", "static");
		const digest = sha256(readFileSync(join(root, artifact)));
		const [first, concurrent] = await Promise.all([
			ensureStaticDaemon(root, stateDir, "reliability-report", artifact, digest, DEFAULT_STATIC_BOUNDS),
			ensureStaticDaemon(root, stateDir, "reliability-report", artifact, digest, DEFAULT_STATIC_BOUNDS),
		]);
		daemonPids.push(first.pid);
		expect(concurrent.pid).toBe(first.pid);
		expect(concurrent.token).toBe(first.token);
		expect(first.processIdentity).toMatchObject({
			pid: first.pid,
			bootId: expect.any(String),
			startFingerprint: expect.any(String),
		});
		expect(first.artifactDigest).toBe(digest);
		expect(await fetch(`http://127.0.0.1:${first.port}/`).then((response) => response.text())).toContain("report");

		const reused = await ensureStaticDaemon(root, stateDir, "reliability-report", artifact, digest, DEFAULT_STATIC_BOUNDS);
		expect(reused.pid).toBe(first.pid);
		expect(reused.port).toBe(first.port);

		process.kill(first.pid, "SIGKILL");
		const rebound = await ensureStaticDaemon(root, stateDir, "reliability-report", artifact, digest, DEFAULT_STATIC_BOUNDS);
		daemonPids.push(rebound.pid);
		expect(rebound.pid).not.toBe(first.pid);
		expect(rebound.token).not.toBe(first.token);
		expect(rebound.port).not.toBe(first.port);
		expect(await fetch(`http://127.0.0.1:${rebound.port}/`).then((response) => response.text())).toContain("report");
		process.kill(rebound.pid, "SIGTERM");
	}, 30_000);

	test("rejects a declared digest that does not match the static artifact", async () => {
		const { root, artifact } = artifactFixture();
		const rejection = await ensureStaticDaemon(
			root,
			join(root, "state"),
			"reliability-report",
			artifact,
			"0".repeat(64),
			DEFAULT_STATIC_BOUNDS,
		).catch((problem) => problem);
		expect(rejection).toBeInstanceOf(StaticArtifactRejected);
		expect(rejection.detail()).toMatchObject({ reason: "digest-mismatch" });
	});

	test("reports a missing artifact as a rejection instead of binding a socket", async () => {
		const root = freshDirectory();
		const rejection = await ensureStaticDaemon(
			root,
			join(root, "state"),
			"reliability-report",
			"data/harness/reliability-report.html",
			"0".repeat(64),
			DEFAULT_STATIC_BOUNDS,
		).catch((problem) => problem);
		expect(rejection).toBeInstanceOf(StaticArtifactRejected);
		expect(rejection.detail()).toMatchObject({ _tag: "StaticArtifactRejected", reason: "missing" });
	});
});
