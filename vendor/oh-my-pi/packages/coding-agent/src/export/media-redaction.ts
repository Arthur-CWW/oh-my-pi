export const VIDEO_OMITTED_TEXT = "[video omitted from export]";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Remove inline video bytes from an export snapshot without mutating live session state. */
export function redactVideoPayloads(value: unknown): void {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			const item: unknown = value[index];
			if (isRecord(item) && item.type === "video" && typeof item.data === "string") {
				value[index] = { type: "text", text: VIDEO_OMITTED_TEXT };
				continue;
			}
			redactVideoPayloads(item);
		}
		return;
	}
	if (!isRecord(value)) return;
	for (const key in value) {
		const item = value[key];
		if (typeof item === "string" && item.startsWith("data:video/")) {
			value[key] = VIDEO_OMITTED_TEXT;
			continue;
		}
		if (isRecord(item) && item.type === "video" && typeof item.data === "string") {
			value[key] = { type: "text", text: VIDEO_OMITTED_TEXT };
			continue;
		}
		redactVideoPayloads(item);
	}
}
