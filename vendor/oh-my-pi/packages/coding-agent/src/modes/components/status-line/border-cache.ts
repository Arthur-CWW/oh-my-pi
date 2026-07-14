import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectDir } from "@oh-my-pi/pi-utils";
import * as git from "../../../utils/git";
import { recordGitHeadResolution } from "./performance-counters";

export interface GitStatusSummary {
	staged: number;
	unstaged: number;
	untracked: number;
}

export class GitBorderCache {
	#branch: string | null | undefined;
	#branchRepoId: string | null | undefined;
	#branchCwd: string | undefined;
	#watcher: fs.FSWatcher | null = null;
	#watchPath: string | null = null;
	#branchResolution: Promise<void> | null = null;
	#branchResolvedAt = 0;
	#status: GitStatusSummary | null = null;
	#statusLastFetch = 0;
	#statusInFlight = false;

	constructor(
		private readonly onDirty: () => void,
		private readonly onChange: () => void,
		private readonly onBranchInvalidated: () => void,
	) {}

	get branchRepoId(): string | null | undefined {
		return this.#branchRepoId;
	}

	#setupWatcher(repository: git.GitRepository): void {
		const watchPath = repository.isReftable ? path.join(repository.gitDir, "reftable") : repository.headPath;
		if (this.#watcher && this.#watchPath === watchPath) return;
		this.#watcher?.close();
		this.#watcher = null;
		this.#watchPath = null;

		try {
			this.#watcher = fs.watch(watchPath, () => {
				this.#invalidateBranch();
				void this.refreshBranch();
			});
			this.#watchPath = watchPath;
		} catch {
			this.#watcher = null;
		}
	}

	#invalidateBranch(): void {
		this.#branch = undefined;
		this.#branchRepoId = undefined;
		this.#branchCwd = undefined;
		this.#branchResolvedAt = 0;
		this.onBranchInvalidated();
		this.onDirty();
	}

	async refreshBranch(): Promise<void> {
		if (this.#branchResolution) return this.#branchResolution;
		const cwd = getProjectDir();
		recordGitHeadResolution();
		const resolution = (async () => {
			let head: git.GitHeadState | null;
			try {
				head = await git.head.resolve(cwd);
			} catch {
				head = null;
			}
			if (getProjectDir() !== cwd) return;
			const branch = head ? (head.kind === "ref" ? (head.branchName ?? head.ref) : "detached") : null;
			const repoId = head?.headPath ?? null;
			const changed = this.#branch !== branch || this.#branchRepoId !== repoId || this.#branchCwd !== cwd;
			this.#branch = branch;
			this.#branchRepoId = repoId;
			this.#branchCwd = cwd;
			this.#branchResolvedAt = Date.now();
			if (head) {
				this.#setupWatcher(head);
			} else {
				this.#watcher?.close();
				this.#watcher = null;
				this.#watchPath = null;
			}
			if (changed) {
				this.onDirty();
				this.onChange();
			}
		})();
		this.#branchResolution = resolution;
		try {
			await resolution;
		} finally {
			if (this.#branchResolution === resolution) this.#branchResolution = null;
		}
	}

	getBranch(): string | null {
		const cwd = getProjectDir();
		const staleFallback = !this.#watcher && Date.now() - this.#branchResolvedAt >= 30_000;
		if (this.#branchCwd !== cwd || this.#branch === undefined || staleFallback) void this.refreshBranch();
		return this.#branchCwd === cwd ? (this.#branch ?? null) : null;
	}

	getStatus(): GitStatusSummary | null {
		if (this.#statusInFlight || Date.now() - this.#statusLastFetch < 1000) return this.#status;
		this.#statusInFlight = true;
		(async () => {
			try {
				const next = await git.status.summary(getProjectDir());
				const changed =
					this.#status?.staged !== next?.staged ||
					this.#status?.unstaged !== next?.unstaged ||
					this.#status?.untracked !== next?.untracked;
				this.#status = next;
				if (changed) {
					this.onDirty();
					this.onChange();
				}
			} catch {
				if (this.#status !== null) {
					this.#status = null;
					this.onDirty();
					this.onChange();
				}
			} finally {
				this.#statusLastFetch = Date.now();
				this.#statusInFlight = false;
			}
		})();
		return this.#status;
	}

	dispose(): void {
		this.#watcher?.close();
		this.#watcher = null;
		this.#watchPath = null;
	}
}

export class BorderMemo {
	#cached:
		| { width: number; revision: number; liveBucket: number; themeEpoch: number; content: string }
		| undefined;

	get(width: number, revision: number, liveBucket: number, themeEpoch: number): string | undefined {
		const cached = this.#cached;
		return cached?.width === width &&
			cached.revision === revision &&
			cached.liveBucket === liveBucket &&
			cached.themeEpoch === themeEpoch
			? cached.content
			: undefined;
	}

	set(width: number, revision: number, liveBucket: number, themeEpoch: number, content: string): void {
		this.#cached = { width, revision, liveBucket, themeEpoch, content };
	}
}
