/**
 * IRC is for coordination references, not bulk content. Direct messages allow a
 * short explanation; broadcasts are tighter because every recipient inherits
 * the body in durable model context.
 */
export const IRC_BODY_MAX_CHARS = 1_200;
export const IRC_BROADCAST_BODY_MAX_CHARS = 400;

export type IrcMessageAudience = "direct" | "broadcast";

function bodyLimit(audience: IrcMessageAudience): number {
	return audience === "broadcast" ? IRC_BROADCAST_BODY_MAX_CHARS : IRC_BODY_MAX_CHARS;
}

export class IrcMessageLengthError extends Error {
	constructor(
		readonly audience: IrcMessageAudience,
		readonly limit: number,
		readonly actual: number,
	) {
		super(
			`IRC ${audience} body exceeds the ${limit}-character limit (${actual} characters). ` +
				"Put bulk content in a file and send its local:// or artifact:// path.",
		);
		this.name = "IrcMessageLengthError";
	}
}

export function ircMessageLengthError(body: string, audience: IrcMessageAudience): IrcMessageLengthError | undefined {
	const limit = bodyLimit(audience);
	return body.length > limit ? new IrcMessageLengthError(audience, limit, body.length) : undefined;
}

export function assertIrcMessageLength(body: string, audience: IrcMessageAudience): void {
	const error = ircMessageLengthError(body, audience);
	if (error) throw error;
}
