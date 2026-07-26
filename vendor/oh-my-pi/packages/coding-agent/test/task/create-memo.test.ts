import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as unknown as ToolSession;
}

describe("TaskTool capability generations", () => {
	let cwd = "";

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "task-capability-generation-"));
		await fs.mkdir(path.join(cwd, ".omp", "agents"), { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	async function writeAgent(description: string): Promise<void> {
		await Bun.write(
			path.join(cwd, ".omp", "agents", "capability_probe.md"),
			`---\nname: capability_probe\ndescription: ${description}\nmodel: pi/smol\n---\n\nProbe task capabilities.\n`,
		);
	}

	it("discovers newly added responsibilities in the next generation", async () => {
		const first = await TaskTool.create(createSession(cwd));
		await writeAgent("Fresh capability");
		const second = await TaskTool.create(createSession(cwd));

		expect(first.description).not.toContain("# capability_probe");
		expect(second.description).toContain("# capability_probe\nFresh capability");
	});

	it("keeps an existing generation immutable while the next generation rescans", async () => {
		await writeAgent("Generation one");
		const first = await TaskTool.create(createSession(cwd));
		await writeAgent("Generation two");
		const second = await TaskTool.create(createSession(cwd));

		expect(first.description).toContain("# capability_probe\nGeneration one");
		expect(first.description).not.toContain("Generation two");
		expect(second.description).toContain("# capability_probe\nGeneration two");
	});
});
