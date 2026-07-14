/** Stable presentation settings shared by transcript renderers. */
export interface TranscriptDisplayContext {
	readonly transcriptWrap: boolean;
	readonly richTranscript: boolean;
}

/** Explicit defaults for non-interactive transcript construction. */
export const DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT: TranscriptDisplayContext = Object.freeze({
	transcriptWrap: false,
	richTranscript: true,
});
