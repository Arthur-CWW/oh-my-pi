export interface StatusLinePerformanceCounters {
	gitHeadResolutions: number;
	borderRebuilds: number;
}

const counters: StatusLinePerformanceCounters = {
	gitHeadResolutions: 0,
	borderRebuilds: 0,
};

/** Lightweight render-path counters for focused performance regression tests. */
export function getStatusLinePerformanceCounters(): Readonly<StatusLinePerformanceCounters> {
	return { ...counters };
}

export function resetStatusLinePerformanceCounters(): void {
	counters.gitHeadResolutions = 0;
	counters.borderRebuilds = 0;
}

export function recordGitHeadResolution(): void {
	counters.gitHeadResolutions++;
}

export function recordBorderRebuild(): void {
	counters.borderRebuilds++;
}
