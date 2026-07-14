import { AssistantMessageComponent } from "./components/assistant-message";
import { UserMessageComponent } from "./components/user-message";
import type { InteractiveModeContext } from "./types";

export function toggleTranscriptWrap(ctx: InteractiveModeContext): boolean {
	ctx.transcriptWrap = !ctx.transcriptWrap;
	ctx.chatContainer.invalidate();
	ctx.ui.resetDisplay();
	return ctx.transcriptWrap;
}

export function toggleRichTranscript(ctx: InteractiveModeContext): boolean {
	ctx.richTranscript = !ctx.richTranscript;
	if (ctx.transcriptMode === "rawSemantic") {
		ctx.toggleTranscriptMode();
	}
	for (const child of ctx.chatContainer.children) {
		if (child instanceof AssistantMessageComponent || child instanceof UserMessageComponent) {
			child.setRichRendering(ctx.richTranscript);
		}
	}
	ctx.streamingComponent?.setRichRendering(ctx.richTranscript);
	ctx.chatContainer.invalidate();
	ctx.ui.resetDisplay();
	return ctx.richTranscript;
}
