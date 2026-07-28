import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { IrcMessage } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TranscriptDisplayContext } from "@oh-my-pi/pi-coding-agent/modes/transcript-display";
import { type IrcDetails, ircToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/irc";
import { sanitizeText } from "@oh-my-pi/pi-utils";

async function theme() {
	const uiTheme = await getThemeByName("dark");
	expect(uiTheme).toBeDefined();
	expect(uiTheme?.getSymbolPreset()).toBeDefined();
	return uiTheme!;
}

const display = (overrides: Partial<TranscriptDisplayContext> = {}): TranscriptDisplayContext => ({
	transcriptWrap: false,
	richTranscript: true,
	...overrides,
});

const rawLines = (component: { render: (w: number) => readonly string[] }, width = 200) => [...component.render(width)];

const lines = (component: { render: (w: number) => readonly string[] }, width = 200) =>
	rawLines(component, width).map(sanitizeText);

const expectWidthBounded = (rendered: readonly string[], width: number) => {
	for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
};

const msg = (overrides: Partial<IrcMessage>): IrcMessage => ({
	id: "7181122334455667789",
	from: "AuthLoader",
	to: "Main",
	body: "session-store rename is merged.",
	ts: Date.now() - 30_000,
	origin: "agent",
	...overrides,
});

describe("ircToolRenderer send", () => {
	it("folds a single delivery outcome into the header and shows the awaited reply", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "send",
						from: "Main",
						to: "AuthLoader",
						receipts: [{ to: "AuthLoader", outcome: "revived" }],
						waited: msg({ body: "go ahead, auth.ts is yours." }),
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "send", to: "AuthLoader", message: "Are you done with auth.ts?", await: true },
			),
		);
		expect(rendered[0]).toContain("AuthLoader");
		expect(rendered[0]).toContain("revived");
		expect(rendered.some(line => line.includes("Are you done with auth.ts?"))).toBe(true);
		expect(rendered.some(line => line.includes("go ahead, auth.ts is yours."))).toBe(true);
	});

	it("lists per-recipient outcomes with error text when a broadcast partially fails", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "send",
						from: "Main",
						to: "all",
						receipts: [
							{ to: "AuthLoader", outcome: "woken" },
							{ to: "RateLimiter", outcome: "failed", error: 'unknown agent "RateLimiter"' },
						],
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "send", to: "all", message: "heads up" },
			),
		);
		expect(rendered[0]).toContain("broadcast");
		expect(rendered[0]).toContain("1 delivered");
		expect(rendered[0]).toContain("1 failed");
		expect(rendered.some(line => line.includes("AuthLoader") && line.includes("woken"))).toBe(true);
		expect(rendered.some(line => line.includes("RateLimiter") && line.includes('unknown agent "RateLimiter"'))).toBe(
			true,
		);
	});

	it("flags an awaited send whose reply timed out", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "send",
						from: "Main",
						to: "AuthLoader",
						receipts: [{ to: "AuthLoader", outcome: "injected" }],
						waited: null,
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "send", to: "AuthLoader", message: "ping", await: true },
			),
		);
		expect(rendered[0]).toContain("no reply");
		expect(rendered.some(line => line.includes("No reply yet"))).toBe(true);
	});

	it("surfaces pre-delivery validation failures as an error detail", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: '`to` is required for op="send".' }],
					details: { op: "send", from: "Main" } satisfies IrcDetails,
					isError: true,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "send" },
			),
		);
		expect(rendered.some(line => line.includes('`to` is required for op="send".'))).toBe(true);
	});
});

describe("ircToolRenderer wait", () => {
	it("renders the consumed message under a sender header", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: { op: "wait", from: "Main", waited: msg({}) } satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "wait", from: "AuthLoader" },
			),
		);
		expect(rendered[0]).toContain("AuthLoader");
		expect(rendered.some(line => line.includes("session-store rename is merged."))).toBe(true);
	});

	it("marks a timed-out wait without inventing a message", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "No message from AuthLoader within 2m." }],
					details: { op: "wait", from: "Main", waited: null } satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "wait", from: "AuthLoader" },
			),
		);
		expect(rendered[0]).toContain("timed out");
		expect(rendered.some(line => line.includes("No message from AuthLoader within 2m."))).toBe(true);
	});
});

describe("ircToolRenderer inbox", () => {
	it("lists each message with sender and body preview", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "inbox",
						from: "Main",
						inbox: [
							msg({ from: "AuthLoader", body: "bus landed." }),
							msg({ from: "RateLimiter", body: "receipts carry outcome.", replyTo: "7181122334455667791" }),
						],
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "inbox", peek: true },
			),
		);
		expect(rendered[0]).toContain("2 messages");
		expect(rendered[0]).toContain("peek");
		expect(rendered.some(line => line.includes("bus landed."))).toBe(true);
		expect(rendered.some(line => line.includes("RateLimiter"))).toBe(true);
		expect(rendered.some(line => line.includes("receipts carry outcome."))).toBe(true);
	});
});

describe("ircToolRenderer list", () => {
	it("summarizes status counts and flags unread peers", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "list",
						from: "Main",
						peers: [
							{
								id: "RateLimiter",
								displayName: "task",
								kind: "sub",
								status: "parked",
								parentId: "Main",
								unread: 2,
								lastActivity: Date.now() - 12 * 60_000,
							},
							{
								id: "AuthLoader",
								displayName: "task",
								kind: "sub",
								status: "running",
								parentId: "Main",
								unread: 0,
								lastActivity: Date.now() - 2 * 60_000,
							},
						],
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "list" },
			),
		);
		expect(rendered[0]).toContain("1 running");
		expect(rendered[0]).toContain("1 parked");
		expect(rendered[0]).toContain("2 unread");
		// Running peers sort above parked ones regardless of input order.
		const authIndex = rendered.findIndex(line => line.includes("AuthLoader"));
		const rateIndex = rendered.findIndex(line => line.includes("RateLimiter"));
		expect(authIndex).toBeGreaterThan(0);
		expect(authIndex).toBeLessThan(rateIndex);
		expect(rendered.some(line => line.includes("RateLimiter") && line.includes("2 unread"))).toBe(true);
	});

	it("renders a peer's role displayName and current activity in the row", async () => {
		const uiTheme = await theme();
		const rendered = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "list",
						from: "Main",
						peers: [
							{
								id: "AuthScout",
								displayName: "Auth-flow security reviewer",
								kind: "sub",
								status: "running",
								parentId: "Main",
								unread: 0,
								lastActivity: Date.now() - 5_000,
								activity: "auditing the token refresh path",
							},
						],
					} satisfies IrcDetails,
				},
				{ expanded: false, isPartial: false, transcriptDisplay: display() },
				uiTheme,
				{ op: "list" },
			),
		);
		const row = rendered.find(line => line.includes("AuthScout"));
		expect(row).toBeDefined();
		expect(row).toContain("Auth-flow security reviewer");
		expect(row).toContain("auditing the token refresh path");
	});
});

describe("ircToolRenderer transcript display", () => {
	const width = 34;
	const body =
		"**bold** alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november tail-token";

	it("applies wrapping and rich rendering to pending, final, awaited, wait, and inbox bodies", async () => {
		const uiTheme = await theme();
		const cases = [
			{
				render: (transcriptDisplay: TranscriptDisplayContext, expanded: boolean) =>
					ircToolRenderer.renderCall(
						{ op: "send", to: "AuthLoader", message: body },
						{ expanded, isPartial: false, transcriptDisplay },
						uiTheme,
					),
			},
			{
				render: (transcriptDisplay: TranscriptDisplayContext, expanded: boolean) =>
					ircToolRenderer.renderResult(
						{
							content: [{ type: "text", text: "" }],
							details: {
								op: "send",
								from: "Main",
								to: "AuthLoader",
								receipts: [{ to: "AuthLoader", outcome: "revived" }],
							} satisfies IrcDetails,
						},
						{ expanded, isPartial: false, transcriptDisplay },
						uiTheme,
						{ op: "send", to: "AuthLoader", message: body },
					),
			},
			{
				render: (transcriptDisplay: TranscriptDisplayContext, expanded: boolean) =>
					ircToolRenderer.renderResult(
						{
							content: [{ type: "text", text: "" }],
							details: {
								op: "send",
								from: "Main",
								to: "AuthLoader",
								receipts: [{ to: "AuthLoader", outcome: "injected" }],
								waited: msg({ body }),
							} satisfies IrcDetails,
						},
						{ expanded, isPartial: false, transcriptDisplay },
						uiTheme,
						{ op: "send", to: "AuthLoader", message: "short request", await: true },
					),
			},
			{
				render: (transcriptDisplay: TranscriptDisplayContext, expanded: boolean) =>
					ircToolRenderer.renderResult(
						{
							content: [{ type: "text", text: "" }],
							details: { op: "wait", from: "Main", waited: msg({ body }) } satisfies IrcDetails,
						},
						{ expanded, isPartial: false, transcriptDisplay },
						uiTheme,
						{ op: "wait", from: "AuthLoader" },
					),
			},
			{
				render: (transcriptDisplay: TranscriptDisplayContext, expanded: boolean) =>
					ircToolRenderer.renderResult(
						{
							content: [{ type: "text", text: "" }],
							details: {
								op: "inbox",
								from: "Main",
								inbox: [msg({ body })],
							} satisfies IrcDetails,
						},
						{ expanded, isPartial: false, transcriptDisplay },
						uiTheme,
						{ op: "inbox", peek: true },
					),
			},
		];

		for (const testCase of cases) {
			const wrapOff = rawLines(
				testCase.render(display({ transcriptWrap: false, richTranscript: false }), false),
				width,
			);
			const wrapOffPlain = wrapOff.map(sanitizeText).join("\n");
			expectWidthBounded(wrapOff, width);
			expect(wrapOffPlain).toContain("…");
			expect(wrapOffPlain).toContain("**bold**");
			expect(wrapOffPlain).not.toContain("tail-token");

			const wrappedPlain = rawLines(
				testCase.render(display({ transcriptWrap: true, richTranscript: false }), false),
				width,
			);
			const wrappedPlainText = wrappedPlain.map(sanitizeText).join("\n");
			expectWidthBounded(wrappedPlain, width);
			expect(wrappedPlain.length).toBeGreaterThan(wrapOff.length);
			expect(wrappedPlainText).toContain("**bold**");
			expect(wrappedPlainText).toContain("tail-token");

			const wrappedRich = rawLines(
				testCase.render(display({ transcriptWrap: true, richTranscript: true }), false),
				width,
			);
			const wrappedRichText = wrappedRich.map(sanitizeText).join("\n");
			expectWidthBounded(wrappedRich, width);
			expect(wrappedRichText).toContain("bold");
			expect(wrappedRichText).toContain("tail-token");
			expect(wrappedRichText).not.toContain("**bold**");
			expect(wrappedRich.join("\n")).not.toBe(wrappedPlain.join("\n"));
		}
	});

	it("keeps headers, receipts, timeouts, inbox heads, and roster rows single-line", async () => {
		const uiTheme = await theme();
		const transcriptDisplay = display({ transcriptWrap: true, richTranscript: false });

		const send = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "send",
						from: "Main",
						to: "AuthLoader",
						receipts: [{ to: "AuthLoader", outcome: "revived" }],
					} satisfies IrcDetails,
				},
				{ expanded: true, isPartial: false, transcriptDisplay },
				uiTheme,
				{ op: "send", to: "AuthLoader", message: body },
			),
			width,
		);
		expectWidthBounded(send, width);
		expect(send.filter(line => line.includes("AuthLoader")).length).toBe(1);
		expect(send.filter(line => line.includes("revived")).length).toBe(1);

		const timeout = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "No message from AuthLoader within 2m." }],
					details: { op: "wait", from: "Main", waited: null } satisfies IrcDetails,
				},
				{ expanded: true, isPartial: false, transcriptDisplay },
				uiTheme,
				{ op: "wait", from: "AuthLoader" },
			),
			width,
		);
		expectWidthBounded(timeout, width);
		expect(timeout).toHaveLength(2);
		expect(timeout[0]).toContain("timed out");

		const inbox = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "inbox",
						from: "Main",
						inbox: [msg({ body })],
					} satisfies IrcDetails,
				},
				{ expanded: true, isPartial: false, transcriptDisplay },
				uiTheme,
				{ op: "inbox", peek: true },
			),
			width,
		);
		expectWidthBounded(inbox, width);
		expect(inbox.filter(line => line.includes("AuthLoader")).length).toBe(1);

		const roster = lines(
			ircToolRenderer.renderResult(
				{
					content: [{ type: "text", text: "" }],
					details: {
						op: "list",
						from: "Main",
						peers: [
							{
								id: "AuthLoader",
								displayName: "task",
								kind: "sub",
								status: "running",
								parentId: "Main",
								unread: 0,
								lastActivity: Date.now() - 5_000,
								activity: "checking auth",
							},
						],
					} satisfies IrcDetails,
				},
				{ expanded: true, isPartial: false, transcriptDisplay },
				uiTheme,
				{ op: "list" },
			),
			width,
		);
		expectWidthBounded(roster, width);
		expect(roster.filter(line => line.includes("AuthLoader")).length).toBe(1);
	});
});

describe("ircToolRenderer body truncation", () => {
	it("collapses long bodies with an elision counter and expands on demand", async () => {
		const uiTheme = await theme();
		const body = Array.from({ length: 6 }, (_, i) => `reply line ${i + 1}`).join("\n");
		const details: IrcDetails = { op: "wait", from: "Main", waited: msg({ body }) };
		const result = { content: [{ type: "text", text: "" }], details };

		const collapsed = lines(
			ircToolRenderer.renderResult(result, { expanded: false, isPartial: false, transcriptDisplay: display() }, uiTheme, { op: "wait" }),
		);
		expect(collapsed.some(line => line.includes("reply line 2"))).toBe(true);
		expect(collapsed.some(line => line.includes("reply line 3"))).toBe(false);
		expect(collapsed.some(line => line.includes("+4 more lines"))).toBe(true);

		const expanded = lines(
			ircToolRenderer.renderResult(result, { expanded: true, isPartial: false, transcriptDisplay: display() }, uiTheme, { op: "wait" }),
		);
		expect(expanded.some(line => line.includes("reply line 6"))).toBe(true);
		expect(expanded.some(line => line.includes("more lines"))).toBe(false);
	});
});
