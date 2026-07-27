import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildVersionViewModel, formatVersion } from "../../src/slash-commands/version";

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

describe("/version view-model", () => {
	it("reports the binary digest and blessed registry match", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omp-version-"));
		const binary = "fixture binary bytes\n";
		const binaryPath = path.join(root, "omp");
		const registryPath = path.join(root, ".omp-release-registry.json");
		const binarySha256 = digest(binary);
		try {
			await writeFile(binaryPath, binary);
			await writeFile(
				registryPath,
				JSON.stringify({
					schemaVersion: 1,
					stable: binarySha256,
					previous: null,
					candidate: null,
					receiptDigest: null,
					timestamps: { candidate: null, blessed: "2026-07-14T00:00:00.000Z", rollback: null },
				}),
			);
			const viewModel = await buildVersionViewModel({
				compiled: true,
				executablePath: binaryPath,
				registryPath,
				version: "16.0.1+fork.abcdef123",
				sessionStartedAt: "2026-07-14T01:02:03.000Z",
			});

			expect(viewModel).toEqual({
				version: "16.0.1+fork.abcdef123",
				binarySha256,
				sourceCommit: "abcdef123",
				blessedStatus: "blessed",
				sessionStartedAt: "2026-07-14T01:02:03.000Z",
			});
			expect(formatVersion(viewModel)).toContain(`  blessed: blessed`);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses a dash for the binary digest in dev mode", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omp-version-"));
		const registryPath = path.join(root, ".omp-release-registry.json");
		try {
			await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, stable: digest("other") }));
			const viewModel = await buildVersionViewModel({
				compiled: false,
				registryPath,
				version: "16.0.1",
				sessionStartedAt: "2026-07-14T01:02:03.000Z",
			});

			expect(viewModel.binarySha256).toBe("-");
			expect(viewModel.blessedStatus).toBe("unknown");
			expect(formatVersion(viewModel)).toContain("  sha256: -");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
