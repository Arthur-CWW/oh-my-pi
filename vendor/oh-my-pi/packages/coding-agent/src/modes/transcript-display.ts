/** Stable presentation settings shared by transcript renderers. */
export interface TranscriptDisplayContext {
	readonly transcriptWrap: boolean;
	readonly richTranscript: boolean;
}

/**
 * Compact cache discriminator for transcript renderers.
 *
 * Transcript display is view-local state and can change without replacing the
 * component that owns a cached body. Renderers include this value in their
 * memo key so a `:wrap`/`:rich` toggle is visible on the next frame.
 */
export function transcriptDisplayCacheVersion(display?: TranscriptDisplayContext): number {
	if (!display) return 2;
	return (display.transcriptWrap ? 1 : 0) | (display.richTranscript ? 2 : 0);
}

/** Explicit defaults for non-interactive transcript construction. */
export const DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT: TranscriptDisplayContext = Object.freeze({
	transcriptWrap: false,
	richTranscript: true,
});
