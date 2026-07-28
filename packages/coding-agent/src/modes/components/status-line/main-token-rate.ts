import { theme } from "../../theme/theme";
import { calculateTokensPerSecond, type TokenRateMessage } from "./token-rate";
import type { RenderedSegment, StatusLineSegment } from "./types";

export interface MainTokenRateViewModel {
	label: string;
}

/** Build the live main-session throughput badge. Completed and under-sampled turns stay hidden. */
export function getMainTokenRateViewModel(
	messages: ReadonlyArray<TokenRateMessage>,
	isStreaming: boolean,
	nowMs: number = Date.now(),
): MainTokenRateViewModel | null {
	if (!isStreaming) return null;
	const tokensPerSecond = calculateTokensPerSecond(messages, true, nowMs);
	if (tokensPerSecond === null) return null;
	return { label: `${tokensPerSecond.toFixed(1)} tok/s` };
}

export const mainTokenRateSegment: StatusLineSegment = {
	id: "token_rate",
	render(ctx): RenderedSegment {
		const mainSession = ctx.mainSession ?? ctx.session;
		const viewModel = getMainTokenRateViewModel(mainSession.state.messages, mainSession.isStreaming);
		if (viewModel === null) return { content: "", visible: false };
		return { content: theme.fg("accent", viewModel.label), visible: true };
	},
};
