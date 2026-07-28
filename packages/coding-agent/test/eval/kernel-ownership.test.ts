import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	inspectKernelProcess,
	listKernelOwnershipRecords,
	registerKernelOwnership,
} from "../../src/eval/kernel-ownership";
import { disposeKernelSessionsByOwner, executePython } from "../../src/eval/py/executor";

describe("eval kernel ownership", () => {
	it("records a real Python kernel and removes it during owner teardown", async () => {
		using tempDir = TempDir.createSync("@eval-kernel-owner-");
		const root = `${tempDir.path()}/kernels`;
		const ownerId = `owner-${crypto.randomUUID()}`;
		await executePython("print('owned')", {
			cwd: tempDir.path(),
			sessionId: `session-${ownerId}`,
			kernelOwnerId: ownerId,
			kernelOwnershipRoot: root,
			kernelMode: "session",
		});
		const records = await listKernelOwnershipRecords(root);
		expect(records).toHaveLength(1);
		const kernelPid = records[0]?.record.kernelPid;
		expect(kernelPid).toBeGreaterThan(0);
		expect(inspectKernelProcess(kernelPid as number).alive).toBe(true);

		await disposeKernelSessionsByOwner(ownerId);
		expect(inspectKernelProcess(kernelPid as number).alive).toBe(false);
		expect(await listKernelOwnershipRecords(root)).toHaveLength(0);
	});

	it("retains live-owner markers and exposes owner attribution", async () => {
		using tempDir = TempDir.createSync("@eval-kernel-owner-");
		const handle = await registerKernelOwnership({
			kind: "node-repl",
			kernelId: "live-kernel",
			sessionId: "live-session",
			ownerPid: process.pid,
			kernelPid: process.pid,
			root: tempDir.path(),
		});
		const records = await listKernelOwnershipRecords(tempDir.path());
		expect(records[0]?.record).toMatchObject({ sessionId: "live-session", ownerPid: process.pid });
		await handle.unregister();
	});
});
