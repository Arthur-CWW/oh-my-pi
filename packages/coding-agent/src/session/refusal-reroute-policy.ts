export type ClassifierStopType = "refusal" | "sensitive" | string | undefined;

export interface RefusalRerouteInput {
	stopType: ClassifierStopType;
	latestUserText: string | undefined;
	fallbackPinned: boolean;
}

export type RefusalRerouteDecision =
	| { reroute: true }
	| { reroute: false; reason: "not-refusal" | "already-rerouted" | "missing-request" | "blocked-language" | "not-allowlisted" };

export const REFUSAL_REROUTE_ANNOTATION = "[rerouted after provider refusal]";

const BLOCKED_LANGUAGE =
	/\b(?:credential|credentials|password|passwords|secret|secrets|token|tokens|api[ -]?key|authentication|authorization|auth|exploit|exploitation|malware|ransomware|phishing|weapon|weapons|exfiltrat(?:e|es|ed|ing|ion)|steal|breach|bypass)\b/i;
const REMOTE_MUTATION =
	/\b(?:deploy|deployed|deploying|publish|published|publishing|upload|uploaded|uploading|post|posted|posting|send|sent|sending|push|pushed|pushing|release|released|releasing)\b/i;
const DOCUMENT_ACTION = /\b(?:write|edit|update|revise|create|add|fix|format|document)\b/i;
const DOCUMENT_TARGET =
	/(?:\b(?:documentation|docs?|readme|changelog|architecture brief|design brief)\b|(?:^|[\\/])docs?[\\/]|\.(?:md|mdx|rst|txt)\b)/i;
const TEST_ACTION = /\b(?:write|add|update|edit|fix|create|run)\b[^\n]{0,80}\btests?\b|\btests?\b[^\n]{0,80}\b(?:write|add|update|edit|fix|create|run)\b/i;
const LOCAL_CHECK_ACTION = /\b(?:run|fix)\b[^\n]{0,60}\b(?:format(?:ter|ting)?|typecheck|type-check|build)\b/i;

/**
 * Decide whether an explicit provider classifier refusal may use the existing
 * full-turn model fallback. This deliberately recognizes only a small set of
 * local development actions; uncertainty is a denial.
 */
export function decideRefusalReroute(input: RefusalRerouteInput): RefusalRerouteDecision {
	if (input.stopType !== "refusal") return { reroute: false, reason: "not-refusal" };
	if (input.fallbackPinned) return { reroute: false, reason: "already-rerouted" };
	const request = input.latestUserText?.trim();
	if (!request) return { reroute: false, reason: "missing-request" };
	if (BLOCKED_LANGUAGE.test(request) || REMOTE_MUTATION.test(request)) {
		return { reroute: false, reason: "blocked-language" };
	}
	if (
		(DOCUMENT_ACTION.test(request) && DOCUMENT_TARGET.test(request)) ||
		TEST_ACTION.test(request) ||
		LOCAL_CHECK_ACTION.test(request)
	) {
		return { reroute: true };
	}
	return { reroute: false, reason: "not-allowlisted" };
}
