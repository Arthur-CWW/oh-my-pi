import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KagiSearchResult } from "../packages/kagi/src/kagi-client.js";
import { queryRuns, saveSearchRun } from "../packages/kagi/src/kagi-log.js";

describe("kagi run log", () => {
	it("saves and filters run records", () => {
		const dir = mkdtempSync(join(tmpdir(), "kagi-log-test-"));
		try {
			const result: KagiSearchResult = {
				capturedAt: new Date().toISOString(),
				requestUrl: "https://kagi.com/socket/search?q=test&nonce=n",
				referer: "https://kagi.com/search?q=test",
				status: 200,
				ok: true,
				headersSent: { accept: "text/event-stream" },
				responseHeaders: { "content-type": "text/event-stream" },
				rawSse: `id: 0\ndata: [{"tag":"search.info","payload":{"next_batch":2}}]\n\n`,
				parsedEvents: [
					{
						id: "0",
						dataRaw: `[{"tag":"search.info","payload":{"next_batch":2}}]`,
						dataJson: [{ tag: "search.info", payload: { next_batch: 2 } }],
					},
				],
			};

			const record = saveSearchRun(result, { query: "test query", outputDir: dir, prefix: "case" });
			expect(record.runId.startsWith("case-")).toBe(true);

			const all = queryRuns(dir, {});
			expect(all.length).toBe(1);
			expect(all[0]?.query).toBe("test query");
			expect(all[0]?.tags).toContain("search.info");

			const byTag = queryRuns(dir, { tag: "search.info" });
			expect(byTag.length).toBe(1);

			const miss = queryRuns(dir, { queryIncludes: "missing" });
			expect(miss.length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
