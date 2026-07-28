
export const PLAN_ARTIFACT_CUSTOM_TYPE = "plan-artifact" as const;
export const PLAN_ARTIFACT_VERSION = 1 as const;

/** Durable pointer to an approved plan revision stored beside its session journal. */
export interface PlanArtifactReference {
	readonly version: typeof PLAN_ARTIFACT_VERSION;
	readonly title: string;
	/** Stable session-local path for the immutable approved copy. */
	readonly localPath: string;
}

export interface DecodedPlanArtifactEntry {
	readonly id: string;
	readonly data: PlanArtifactReference;
}

/** Decode plan metadata at the persisted-session trust boundary. */
export function decodePlanArtifactEntry(value: unknown): DecodedPlanArtifactEntry | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const entry = value as Record<string, unknown>;
	if (entry.type !== "custom" || entry.customType !== PLAN_ARTIFACT_CUSTOM_TYPE || typeof entry.id !== "string") {
		return undefined;
	}
	const data = entry.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
	const candidate = data as Record<string, unknown>;
	if (
		candidate.version !== PLAN_ARTIFACT_VERSION ||
		typeof candidate.title !== "string" ||
		candidate.title.trim().length === 0 ||
		typeof candidate.localPath !== "string" ||
		!/^local:\/\/plans\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(candidate.localPath)
	) {
		return undefined;
	}
	return {
		id: entry.id,
		data: {
			version: PLAN_ARTIFACT_VERSION,
			title: candidate.title,
			localPath: candidate.localPath,
		},
	};
}

/** Return the newest valid plan artifact from a journal branch. */
export function findLatestPlanArtifact(entries: readonly unknown[]): DecodedPlanArtifactEntry | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const decoded = decodePlanArtifactEntry(entries[index]);
		if (decoded) return decoded;
	}
	return undefined;
}
