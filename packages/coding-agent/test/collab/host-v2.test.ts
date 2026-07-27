import { describe, expect, it } from "bun:test";

const hostSource = await Bun.file(new URL("../../src/collab/host.ts", import.meta.url)).text();

describe("collab v2 host authority boundary", () => {
	it("routes authority exclusively through SessionRunner views", () => {
		expect(hostSource).toContain("SessionRunner");
		expect(hostSource).toContain("attachView");
		expect(hostSource).toContain("view.detach");
		expect(hostSource).not.toMatch(
			/AgentSession|SessionManager|AgentLifecycleManager|AgentRegistry|InteractiveModeContext|promptCustomMessage|\.abort\(/,
		);
	});

	it("does not stop the runner when the host or a peer detaches", () => {
		expect(hostSource).not.toContain("#runner.stop");
		expect(hostSource).not.toContain("runner.stop(");
	});
	it("projects transcript entries rather than the transcript container", () => {
		expect(hostSource).toContain("transcript: snapshot.transcript.entries");
		expect(hostSource).not.toContain("transcript: snapshot.transcript as never");
	});

});
