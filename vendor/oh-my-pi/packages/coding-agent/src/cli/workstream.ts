import * as path from "node:path";
import { decodeSessionWorkstream, type SessionWorkstream } from "../session/session-entries";

const WORKSTREAM_SLUG_HINT = "Use lowercase letters, numbers, and single hyphens (for example, harness-runtime).";

export interface StartupWorkstream {
	workstream?: SessionWorkstream;
	/** Only a CLI value may override metadata loaded from a resumed session. */
	explicit: boolean;
}

export class WorkstreamResolutionError extends Error {
	constructor(source: "--workstream" | "OMP_WORKSTREAM", value: string) {
		super(`Invalid ${source} value ${JSON.stringify(value)}. ${WORKSTREAM_SLUG_HINT}`);
		this.name = "WorkstreamResolutionError";
	}
}

function decodeLaunchValue(value: string, source: "--workstream" | "OMP_WORKSTREAM"): SessionWorkstream {
	const workstream = decodeSessionWorkstream(value === "adhoc" ? { kind: "adhoc" } : { kind: "workstream", id: value });
	if (!workstream) throw new WorkstreamResolutionError(source, value);
	return workstream;
}

/** Resolve launch-only classification. Persisted metadata is handled by SessionManager after resume. */
export function resolveStartupWorkstream(
	cliValue: string | undefined,
	cwd: string,
	environment: Readonly<Record<string, string | undefined>> = process.env,
	resuming = false,
): StartupWorkstream {
	if (cliValue !== undefined) {
		return { workstream: decodeLaunchValue(cliValue, "--workstream"), explicit: true };
	}
	if (resuming) return { explicit: false };

	const environmentValue = environment.OMP_WORKSTREAM?.trim();
	if (environmentValue) {
		return { workstream: decodeLaunchValue(environmentValue, "OMP_WORKSTREAM"), explicit: false };
	}

	const normalizedCwd = path.resolve(cwd);
	if (path.basename(path.dirname(normalizedCwd)) !== "streams") return { explicit: false };
	const inferred = decodeSessionWorkstream({ kind: "workstream", id: path.basename(normalizedCwd) });
	return inferred ? { workstream: inferred, explicit: false } : { explicit: false };
}
