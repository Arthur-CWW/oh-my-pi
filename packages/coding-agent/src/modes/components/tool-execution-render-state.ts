import { TERMINAL } from "@oh-my-pi/pi-tui";
import type { ToolRenderer } from "../../tools/renderers";
import { resolveImageOptions } from "../../tools/render-utils";
import { getThemeEpoch } from "../theme/theme";
import {
	DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT,
	type TranscriptDisplayContext,
} from "../transcript-display";

export type ToolRenderState = Parameters<ToolRenderer["renderResult"]>[1];

export class ToolDisplayMemo {
	#lastKey: string | undefined;
	#built = false;

	update(key: string, rebuild: () => void): void {
		if (key === this.#lastKey && this.#built) return;
		this.#lastKey = key;
		rebuild();
		this.#built = true;
	}
}

export function createToolRenderState(transcriptDisplay: TranscriptDisplayContext): ToolRenderState {
	return {
		expanded: false,
		isPartial: true,
		transcriptDisplay,
	};
}

export function syncToolRenderState(
	state: ToolRenderState,
	expanded: boolean,
	isPartial: boolean,
	spinnerFrame: number | undefined,
	transcriptDisplay: TranscriptDisplayContext,
): void {
	state.expanded = expanded;
	state.isPartial = isPartial;
	state.spinnerFrame = spinnerFrame;
	state.transcriptDisplay = transcriptDisplay;
}

/**
 * Derive every external render input consumed by the display memo. Image size
 * only participates after a rebuild emitted images, avoiding resize-driven
 * rebuilds for the common image-free result.
 */
export function deriveToolDisplayMemoKey(
	state: ToolRenderState,
	resultVersion: number,
	showImages: boolean,
	displayInputVersion: number,
	backgroundTaskFrozen: boolean,
	renderedImageCount: number,
): string {
	const display = state.transcriptDisplay ?? DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT;
	let imageSizeKey = "-";
	if (renderedImageCount > 0) {
		const options = resolveImageOptions();
		imageSizeKey = `${options.maxWidthCells}:${options.maxHeightCells ?? "-"}`;
	}
	return `${resultVersion}|${state.expanded}|${state.isPartial}|${state.spinnerFrame ?? "-"}|${showImages}|${getThemeEpoch()}|${displayInputVersion}|${backgroundTaskFrozen}|${display.transcriptWrap}|${display.richTranscript}|${TERMINAL.imageProtocol ?? "-"}|${imageSizeKey}`;
}
