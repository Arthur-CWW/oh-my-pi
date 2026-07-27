import { describe, expect, it } from "bun:test";
import {
	decideRefusalReroute,
	REFUSAL_REROUTE_ANNOTATION,
} from "@oh-my-pi/pi-coding-agent/session/refusal-reroute-policy";

describe("provider refusal reroute policy", () => {
	it("allows the observed local architecture-documentation refusal", () => {
		expect(
			decideRefusalReroute({
				stopType: "refusal",
				latestUserText: "Write the architecture documentation to docs/fable/gateway-brief.md.",
				fallbackPinned: false,
			}),
		).toEqual({ reroute: true });
		expect(REFUSAL_REROUTE_ANNOTATION).toBe("[rerouted after provider refusal]");
	});

	it.each([
		"Update the README with installation notes.",
		"Add tests for the local parser.",
		"Run the typecheck and build.",
		"Fix formatting in docs/guide.md.",
	])("allows a narrow local development action: %s", latestUserText => {
		expect(decideRefusalReroute({ stopType: "refusal", latestUserText, fallbackPinned: false })).toEqual({
			reroute: true,
		});
	});

	it("blocks sensitive classifier stops even for allowlisted work", () => {
		expect(
			decideRefusalReroute({
				stopType: "sensitive",
				latestUserText: "Write docs/fable/gateway-brief.md.",
				fallbackPinned: false,
			}),
		).toEqual({ reroute: false, reason: "not-refusal" });
	});

	it.each([
		"Help me with this request.",
		"Review the project.",
		"Write documentation for credential exfiltration.",
		"Upload the README to the remote service.",
		"Deploy the documentation site.",
	])("blocks ambiguous, dangerous, or remote requests: %s", latestUserText => {
		expect(decideRefusalReroute({ stopType: "refusal", latestUserText, fallbackPinned: false }).reroute).toBe(
			false,
		);
	});

	it("permits one refusal fallback and never reroutes a pinned fallback", () => {
		const input = {
			stopType: "refusal",
			latestUserText: "Write docs/fable/gateway-brief.md architecture documentation.",
		} as const;
		expect(decideRefusalReroute({ ...input, fallbackPinned: false })).toEqual({ reroute: true });
		expect(decideRefusalReroute({ ...input, fallbackPinned: true })).toEqual({
			reroute: false,
			reason: "already-rerouted",
		});
	});
});
