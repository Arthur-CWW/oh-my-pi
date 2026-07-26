import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
	classifyDiskPressure,
	DEFAULT_DISK_PRESSURE_THRESHOLDS,
	evaluateDiskAdmission,
	GIB,
	probeDiskPressure,
	type StatfsBoundary,
} from "../../src/resource/disk-pressure";

function statfsFixture(freeGiB: number, totalGiB = 100): StatfsBoundary {
	return {
		type: 0x1a,
		bsize: GIB,
		blocks: totalGiB,
		bfree: freeGiB,
		bavail: freeGiB,
	};
}

describe("disk pressure thresholds", () => {
	it("uses either free bytes or free percent and reports the highest severity", () => {
		expect(classifyDiskPressure(40 * GIB, 40).state).toBe("warning");
		expect(classifyDiskPressure(30 * GIB, 3).state).toBe("blocking");
		expect(classifyDiskPressure(9 * GIB, 50).state).toBe("emergency");
		expect(classifyDiskPressure(60 * GIB, 20).state).toBe("normal");
	});

	it("holds a recovering state until both byte and percent hysteresis clear", () => {
		expect(classifyDiskPressure(21 * GIB, 10.5, DEFAULT_DISK_PRESSURE_THRESHOLDS, "blocking").state).toBe(
			"blocking",
		);
		expect(classifyDiskPressure(23 * GIB, 11.5, DEFAULT_DISK_PRESSURE_THRESHOLDS, "blocking").state).toBe(
			"warning",
		);
		expect(classifyDiskPressure(51 * GIB, 20, DEFAULT_DISK_PRESSURE_THRESHOLDS, "warning").state).toBe(
			"warning",
		);
		expect(classifyDiskPressure(53 * GIB, 20, DEFAULT_DISK_PRESSURE_THRESHOLDS, "warning").state).toBe(
			"normal",
		);
	});
});

describe("disk pressure receipts", () => {
	it("deduplicates state notifications and emits one recovery", async () => {
		const root = await fs.mkdtemp(path.join(process.env.TEST_TMPDIR ?? os.tmpdir(), "omp-disk-pressure-"));
		const stateFile = path.join(root, "state.json");
		let fixture = statfsFixture(40);
		const notifications: string[] = [];
		const options = {
			stateFile,
			statfs: async () => fixture,
			notifier: async (projection: { state: string }) => {
				notifications.push(projection.state);
			},
			notify: true,
			now: () => new Date("2026-07-26T12:00:00.000Z"),
		};

		await probeDiskPressure(options);
		await probeDiskPressure(options);
		fixture = statfsFixture(15);
		await probeDiskPressure(options);
		fixture = statfsFixture(60);
		await probeDiskPressure(options);
		await probeDiskPressure(options);

		expect(notifications).toEqual(["warning", "blocking", "normal"]);
		const receipt = JSON.parse(await fs.readFile(stateFile, "utf8")) as Record<string, unknown>;
		expect(receipt).toMatchObject({ version: 1, state: "normal", notifiedState: "normal" });
	});

	it("keeps dry-run notification and guard checks side-effect free", async () => {
		const root = await fs.mkdtemp(path.join(process.env.TEST_TMPDIR ?? os.tmpdir(), "omp-disk-dry-"));
		const stateFile = path.join(root, "state.json");
		let notified = false;
		const projection = await probeDiskPressure({
			stateFile,
			statfs: async () => statfsFixture(5),
			notifier: async () => {
				notified = true;
			},
			notify: true,
			dryRun: true,
		});

		expect(projection).toMatchObject({ state: "emergency", wouldNotify: true, notificationDelivered: false });
		expect(evaluateDiskAdmission(projection, "heavy").admitted).toBeFalse();
		expect(notified).toBeFalse();
		expect(await Bun.file(stateFile).exists()).toBeFalse();
	});
});

describe("disk admission", () => {
	it("fails conservative on malformed statfs while admitting non-allocating operations", async () => {
		const projection = await probeDiskPressure({
			stateFile: null,
			statfs: async () => ({ bsize: "4096", blocks: 100, bfree: 1, bavail: 1 }),
			dryRun: true,
		});
		expect(projection.state).toBe("unavailable");
		expect(evaluateDiskAdmission(projection, "heavy").admitted).toBeFalse();
		for (const operation of ["readOnly", "status", "cleanup", "offload", "alreadyRunning"] as const) {
			expect(evaluateDiskAdmission(projection, operation).admitted).toBeTrue();
		}
	});

	it("admits writable children at warning and blocks them at blocking", async () => {
		const warning = await probeDiskPressure({ stateFile: null, statfs: async () => statfsFixture(40), dryRun: true });
		const blocking = await probeDiskPressure({ stateFile: null, statfs: async () => statfsFixture(15), dryRun: true });
		expect(evaluateDiskAdmission(warning, "heavy").admitted).toBeTrue();
		expect(evaluateDiskAdmission(blocking, "heavy").admitted).toBeFalse();
		expect(evaluateDiskAdmission(blocking, "readOnly").admitted).toBeTrue();
	});
});
