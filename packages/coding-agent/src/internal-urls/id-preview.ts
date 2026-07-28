const DEFAULT_PREVIEW_LIMIT = 5;

export function formatIdPreview(ids: Iterable<string>, limit = DEFAULT_PREVIEW_LIMIT): string {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return "none";
	const preview = unique.slice(0, limit).join(", ");
	const remaining = unique.length - limit;
	return remaining > 0 ? `${preview} (+${remaining} more)` : preview;
}
