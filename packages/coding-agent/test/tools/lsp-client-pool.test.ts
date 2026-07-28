import { afterEach, describe, expect, it } from "bun:test";
import { once } from "node:events";
import { watch } from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	getActiveClients,
	getOrCreateClient,
	releaseLspClientsForOwner,
	sendRequest,
	setIdleTimeout,
	shutdownAll,
} from "@oh-my-pi/pi-coding-agent/lsp/client";
import type { ServerConfig } from "@oh-my-pi/pi-coding-agent/lsp/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const TEST_IDLE_TTL_MS = 25;

interface PoolFixture {
	tempDir: TempDir;
	logPath: string;
	config: ServerConfig;
}

async function createPoolFixture(): Promise<PoolFixture> {
	const tempDir = TempDir.createSync("@omp-lsp-client-pool-");
	const serverPath = path.join(tempDir.path(), "pool-server.ts");
	const logPath = path.join(tempDir.path(), "server.log");
	await Bun.write(logPath, "");
	await Bun.write(
		serverPath,
		`import { appendFileSync } from "node:fs";
const logPath = process.argv[2];
const encoder = new TextEncoder();
appendFileSync(logPath, "spawn\\n");
function send(message) {
  const content = JSON.stringify(message);
  process.stdout.write(encoder.encode(\`Content-Length: \${Buffer.byteLength(content, "utf8")}\\r\\n\\r\\n\${content}\`));
}
let pending = Buffer.alloc(0);
for await (const chunk of Bun.stdin.stream()) {
  pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, Buffer.from(chunk)]);
  while (true) {
    const headerEnd = pending.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) break;
    const match = /Content-Length: (\\d+)/i.exec(pending.toString("utf8", 0, headerEnd));
    if (!match) throw new Error("missing Content-Length");
    const start = headerEnd + 4;
    const end = start + Number(match[1]);
    if (pending.length < end) break;
    const message = JSON.parse(pending.toString("utf8", start, end));
    pending = pending.subarray(end);
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    } else if (message.method === "pool/busy") {
      appendFileSync(logPath, "busy-start\\n");
      setTimeout(() => {
        appendFileSync(logPath, "busy-end\\n");
        send({ jsonrpc: "2.0", id: message.id, result: "done" });
      }, Number(message.params?.delayMs ?? 100));
    } else if (message.method === "shutdown") {
      appendFileSync(logPath, "shutdown\\n");
      send({ jsonrpc: "2.0", id: message.id, result: null });
    } else if (message.method === "exit") {
      appendFileSync(logPath, "exit\\n");
      process.exit(0);
    }
  }
}
`,
	);
	return {
		tempDir,
		logPath,
		config: {
			command: "pool-test-lsp",
			resolvedCommand: process.execPath,
			args: [serverPath, logPath],
			fileTypes: ["ts"],
			rootMarkers: [],
		},
	};
}

async function readEvents(logPath: string): Promise<string[]> {
	if (!(await Bun.file(logPath).exists())) return [];
	return (await Bun.file(logPath).text()).trim().split("\n").filter(Boolean);
}

async function waitForEventCount(logPath: string, event: string, count: number): Promise<void> {
	while (true) {
		const watcher = watch(logPath);
		try {
			if ((await readEvents(logPath)).filter(value => value === event).length >= count) return;
			await once(watcher, "change");
		} finally {
			watcher.close();
		}
	}
}

async function waitPastIdleTtl(): Promise<void> {
	// This integration test spans the parent process's idle checker and a real child
	// process, whose clocks cannot both be driven by Bun's fake timers.
	await Bun.sleep(TEST_IDLE_TTL_MS * 3);
}

function createSession(modelRegistry: ModelRegistry): AgentSession {
	return new AgentSession({
		agent: new Agent({ initialState: { systemPrompt: ["test"], tools: [], messages: [] } }),
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry,
	});
}

afterEach(async () => {
	setIdleTimeout(0);
	await shutdownAll();
	setIdleTimeout(undefined);
});

describe("LSP client session pool", () => {
	it("shares one server and child disposal releases only the child's reference", async () => {
		const fixture = await createPoolFixture();
		const authStorage = await AuthStorage.create(path.join(fixture.tempDir.path(), "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(fixture.tempDir.path(), "models.yml"));
		const parent = createSession(modelRegistry);
		const child = createSession(modelRegistry);
		setIdleTimeout(TEST_IDLE_TTL_MS);
		try {
			const parentClient = await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, parent);
			const childClient = await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, child);
			expect(childClient).toBe(parentClient);
			expect((await readEvents(fixture.logPath)).filter(event => event === "spawn")).toHaveLength(1);

			await child.dispose({ scope: "child" });
			await waitPastIdleTtl();
			expect(getActiveClients()).toHaveLength(1);
			expect(await readEvents(fixture.logPath)).not.toContain("shutdown");

			await parent.dispose({ scope: "child" });
			await waitForEventCount(fixture.logPath, "shutdown", 1);
		} finally {
			if (!child.isDisposed) await child.dispose({ scope: "child" });
			if (!parent.isDisposed) await parent.dispose({ scope: "child" });
			await shutdownAll();
			authStorage.close();
			fixture.tempDir.removeSync();
		}
	});

	it("shuts down only after the last reference has been idle for the TTL", async () => {
		const fixture = await createPoolFixture();
		const owner = {};
		setIdleTimeout(TEST_IDLE_TTL_MS);
		try {
			await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, owner);
			await waitPastIdleTtl();
			expect(getActiveClients()).toHaveLength(1);
			releaseLspClientsForOwner(owner);
			await waitForEventCount(fixture.logPath, "shutdown", 1);
			expect(getActiveClients()).toHaveLength(0);
		} finally {
			await shutdownAll();
			fixture.tempDir.removeSync();
		}
	});

	it("does not interrupt a request that remains busy past the idle TTL", async () => {
		const fixture = await createPoolFixture();
		const owner = {};
		setIdleTimeout(TEST_IDLE_TTL_MS);
		try {
			const client = await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, owner);
			const request = sendRequest(client, "pool/busy", { delayMs: TEST_IDLE_TTL_MS * 6 }, undefined, 1_000);
			await waitForEventCount(fixture.logPath, "busy-start", 1);
			releaseLspClientsForOwner(owner);
			await waitPastIdleTtl();
			expect(getActiveClients()).toHaveLength(1);
			expect(await readEvents(fixture.logPath)).not.toContain("shutdown");
			expect(await request).toBe("done");
			await waitForEventCount(fixture.logPath, "shutdown", 1);
		} finally {
			await shutdownAll();
			fixture.tempDir.removeSync();
		}
	});

	it("starts a fresh server when a new session acquires after idle shutdown", async () => {
		const fixture = await createPoolFixture();
		const firstOwner = {};
		const secondOwner = {};
		setIdleTimeout(TEST_IDLE_TTL_MS);
		try {
			const first = await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, firstOwner);
			releaseLspClientsForOwner(firstOwner);
			await waitForEventCount(fixture.logPath, "exit", 1);

			const second = await getOrCreateClient(fixture.config, fixture.tempDir.path(), 1_000, secondOwner);
			expect(second).not.toBe(first);
			await waitForEventCount(fixture.logPath, "spawn", 2);
			expect(getActiveClients()).toHaveLength(1);
			releaseLspClientsForOwner(secondOwner);
		} finally {
			await shutdownAll();
			fixture.tempDir.removeSync();
		}
	});
});
