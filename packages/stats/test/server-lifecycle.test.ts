import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { parseStatsArgs, validateStatsPort } from "../../coding-agent/src/cli/stats-cli";
import { closeDb } from "../src/db";
import { startServer, waitForStatsHealth, type StatsServer } from "../src/server";
import { getAgentDir, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";

const originalConfigDir = process.env.PI_CONFIG_DIR;
const originalAgentDir = getAgentDir();
let tempDir: TempDir | null = null;
let statsServer: StatsServer | null = null;

beforeEach(() => {
	tempDir = TempDir.createSync("@pi-stats-server-");
	const configDir = path.relative(os.homedir(), tempDir.join("config"));
	process.env.PI_CONFIG_DIR = configDir;
	setAgentDir(path.join(os.homedir(), configDir, "agent"));
});

afterEach(async () => {
	await statsServer?.stop();
	statsServer = null;
	closeDb();
	if (originalConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
	else process.env.PI_CONFIG_DIR = originalConfigDir;
	setAgentDir(originalAgentDir);
	tempDir?.removeSync();
	tempDir = null;
});

function serverUrl(server: StatsServer): string {
	return `http://127.0.0.1:${server.port}`;
}

describe("stats server lifecycle", () => {
	it("serves database readiness and runtime provenance", async () => {
		statsServer = await startServer(0);
		const [healthResponse, versionResponse] = await Promise.all([
			fetch(`${serverUrl(statsServer)}/healthz`),
			fetch(`${serverUrl(statsServer)}/version`),
		]);

		expect(healthResponse.status).toBe(200);
		expect(await healthResponse.json()).toEqual({ status: "ok", db: "ready" });
		expect(versionResponse.status).toBe(200);
		const version = (await versionResponse.json()) as {
			name: string;
			version: string;
			runtime: { name: string; version: string };
			provenance: { compiled: boolean; bundled: boolean; forkHash: string | null };
		};
		expect(version).toMatchObject({
			name: "omp",
			version: expect.any(String),
			runtime: { name: "bun", version: expect.any(String) },
			provenance: {
				compiled: expect.any(Boolean),
				bundled: expect.any(Boolean),
			},
		});
		expect(version.provenance.forkHash === null || typeof version.provenance.forkHash === "string").toBe(true);
	});

	it("single-flights database initialization across concurrent first requests", async () => {
		statsServer = await startServer(0);
		const responses = await Promise.all(
			Array.from({ length: 32 }, () => fetch(`${serverUrl(statsServer!)}/healthz`)),
		);
		expect(responses.every(response => response.status === 200)).toBe(true);
		const payloads = await Promise.all(responses.map(response => response.json()));
		expect(payloads.every(payload => payload.status === "ok" && payload.db === "ready")).toBe(true);
	});

	it("returns typed API errors", async () => {
		statsServer = await startServer(0);
		const response = await fetch(`${serverUrl(statsServer)}/api/request/not-an-id`);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: "BAD_REQUEST", message: "Request id must be an integer" },
		});
	});

	it("rejects invalid ports with actionable errors", async () => {
		expect(() => parseStatsArgs(["stats", "--port", "12oops"])).toThrow("Invalid stats port");
		expect(() => validateStatsPort(0)).toThrow("1 to 65535");
		expect(() => validateStatsPort(65_536)).toThrow("1 to 65535");
		expect(startServer(Number.NaN)).rejects.toThrow("Invalid stats server port");
	});

	it("stops accepting requests and can be stopped twice", async () => {
		statsServer = await startServer(0);
		const url = serverUrl(statsServer);
		expect((await fetch(`${url}/healthz`)).status).toBe(200);
		await statsServer.stop();
		await statsServer.stop();
		statsServer = null;
		expect(fetch(`${url}/healthz`)).rejects.toThrow();
	});
});

describe("stats health gate", () => {
	it("waits for a real server to report ready", async () => {
		let attempts = 0;
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				if (new URL(request.url).pathname !== "/healthz") return new Response("not found", { status: 404 });
				attempts++;
				return attempts < 3
					? Response.json({ status: "starting", db: "starting" }, { status: 503 })
					: Response.json({ status: "ok", db: "ready" });
			},
		});
		try {
			await expect(
				waitForStatsHealth(`http://127.0.0.1:${server.port}`, { attempts: 5, intervalMs: 1 }),
			).resolves.toEqual({ status: "ok", db: "ready" });
			expect(attempts).toBe(3);
		} finally {
			await server.stop(true);
		}
	});

	it("reports a clear bounded-retry failure", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("starting", { status: 503 }) });
		try {
			await expect(
				waitForStatsHealth(`http://127.0.0.1:${server.port}`, { attempts: 2, intervalMs: 1 }),
			).rejects.toThrow("after 2 attempts (HTTP 503)");
		} finally {
			await server.stop(true);
		}
	});
});
