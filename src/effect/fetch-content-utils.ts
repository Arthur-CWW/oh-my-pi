export function extractHeadingTitle(text: string): string | null {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) {
		return null;
	}
	const cleaned = match[1]?.replace(/\*+/g, "").trim();
	return cleaned || null;
}

export function formatSeconds(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	}
	return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function readExecError(error: unknown): {
	readonly code?: string;
	readonly stderr: string;
	readonly message: string;
} {
	if (!error || typeof error !== "object") {
		return { stderr: "", message: String(error) };
	}
	const candidate = error as {
		readonly code?: string;
		readonly stderr?: Buffer | string;
		readonly message?: string;
	};
	const stderrRaw = candidate.stderr;
	const stderr = Buffer.isBuffer(stderrRaw)
		? stderrRaw.toString("utf-8")
		: typeof stderrRaw === "string"
			? stderrRaw
			: "";
	return {
		code: candidate.code,
		stderr,
		message: candidate.message ?? "",
	};
}

export function isTimeoutError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as {
		readonly killed?: boolean;
		readonly name?: string;
		readonly code?: string;
		readonly message?: string;
	};
	return (
		candidate.killed === true ||
		candidate.name === "AbortError" ||
		candidate.code === "ETIMEDOUT" ||
		(candidate.message ?? "").toLowerCase().includes("timed out")
	);
}

export function trimErrorText(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function mapFfmpegError(error: unknown): string {
	const { code, stderr, message } = readExecError(error);
	if (code === "ENOENT") {
		return "ffmpeg is not installed. Install with: brew install ffmpeg";
	}
	if (isTimeoutError(error)) {
		return "ffmpeg timed out extracting frame";
	}
	if (stderr.includes("403")) {
		return "Stream URL returned 403 — may have expired, try again";
	}
	const snippet = trimErrorText(stderr || message);
	return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}
