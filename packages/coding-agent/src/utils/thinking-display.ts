/** Removes model-emitted empty HTML separators outside fenced code blocks. */
export function removeEmptyThinkingCommentSeparators(text: string): string {
	return removeThinkingCommentSeparators(text, false);
}

/** Removes trailing partial separator syntax while a thinking block streams. */
export function removeIncompleteThinkingCommentSuffix(text: string): string {
	return removeThinkingCommentSeparators(text, true);
}

function removeThinkingCommentSeparators(text: string, removeIncompleteSuffix: boolean): string {
	let display: string | undefined;
	let copiedThrough = 0;
	let inFence = false;
	let fenceMarker = 0;
	let fenceLength = 0;
	let lineStart = 0;

	for (let index = 0; index < text.length; index++) {
		if (index === lineStart) {
			let markerStart = index;
			while (markerStart - index < 4 && text.charCodeAt(markerStart) === 0x20) markerStart += 1;
			const marker = text.charCodeAt(markerStart);
			if (marker === 0x60 || marker === 0x7e) {
				let markerEnd = markerStart;
				while (text.charCodeAt(markerEnd) === marker) markerEnd += 1;
				const markerLength = markerEnd - markerStart;
				const closesFence =
					inFence && marker === fenceMarker && markerLength >= fenceLength && isFenceCloser(text, markerEnd);
				if (markerLength >= 3 && (!inFence || closesFence)) {
					if (inFence) {
						inFence = false;
					} else {
						inFence = true;
						fenceMarker = marker;
						fenceLength = markerLength;
					}
				}
			}
		}

		if (
			!inFence &&
			text.charCodeAt(index) === 0x3c &&
			text.charCodeAt(index + 1) === 0x21 &&
			text.charCodeAt(index + 2) === 0x2d &&
			text.charCodeAt(index + 3) === 0x2d
		) {
			let commentEnd = index + 4;
			while (isHtmlWhitespace(text.charCodeAt(commentEnd))) {
				if (text.charCodeAt(commentEnd) === 0x0a) lineStart = commentEnd + 1;
				commentEnd += 1;
			}
			const isComplete =
				text.charCodeAt(commentEnd) === 0x2d &&
				text.charCodeAt(commentEnd + 1) === 0x2d &&
				text.charCodeAt(commentEnd + 2) === 0x3e;
			if (isComplete || (removeIncompleteSuffix && commentEnd === text.length)) {
				if (display === undefined) {
					display = text.slice(0, index);
				} else {
					display += text.slice(copiedThrough, index);
				}
				const separatorEnd = isComplete ? commentEnd + 3 : commentEnd;
				copiedThrough = separatorEnd;
				index = separatorEnd - 1;
				continue;
			}
		}

		if (text.charCodeAt(index) === 0x0a) lineStart = index + 1;
	}

	return display === undefined ? text : display + text.slice(copiedThrough);
}

function isFenceCloser(text: string, index: number): boolean {
	for (let cursor = index; cursor < text.length && text.charCodeAt(cursor) !== 0x0a; cursor++) {
		const code = text.charCodeAt(cursor);
		if (code !== 0x09 && code !== 0x0d && code !== 0x20) return false;
	}
	return true;
}

function isHtmlWhitespace(code: number): boolean {
	return (
		code === 0x09 ||
		code === 0x0a ||
		code === 0x0b ||
		code === 0x0c ||
		code === 0x0d ||
		code === 0x20 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/** Normalizes thinking for display without changing the persisted source. */
export function normalizeThinkingDisplay(text: string | null | undefined): string {
	if (!text) return "";
	return canonicalizeMessage(removeEmptyThinkingCommentSeparators(text));
}

export function canonicalizeMessage(text: string | null | undefined): string {
	if (!text) return "";
	const trimmed = text.trim();
	for (let i = 0; i < trimmed.length; i++) {
		const code = trimmed.charCodeAt(i);
		if (code !== 0x2e && code !== 0x2026 && code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
			return trimmed;
		}
	}
	return "";
}
