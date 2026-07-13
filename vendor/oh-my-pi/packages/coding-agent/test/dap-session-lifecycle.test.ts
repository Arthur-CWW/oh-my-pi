import { describe, expect, it, spyOn } from "bun:test";
import * as timers from "node:timers/promises";
import { DapSessionManager } from "../src/dap/session";

describe("DAP session manager lifecycle", () => {
	it("does not start the cleanup interval before the first launch or attach", async () => {
		const interval = spyOn(timers, "setInterval");
		try {
			const manager = new DapSessionManager();
			expect(interval).not.toHaveBeenCalled();
			await manager.dispose();
		} finally {
			interval.mockRestore();
		}
	});
});
