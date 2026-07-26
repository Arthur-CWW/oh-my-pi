import type { IrcExternalMessage } from "./bus-external";

export interface PreparedExternalIrcInboundMessage {
	readonly body: string;
	readonly artifactUri?: string;
	readonly topic: string;
}

export interface PrepareExternalIrcInboundOptions {
	readonly inlineBodyMaxBytes: number;
	readonly saveArtifact: (body: string) => Promise<string | undefined>;
}

interface TopicRule {
	readonly label: string;
	readonly pattern: RegExp;
}

const GENERAL_TOPIC = "general coordination";
const TOPIC_RULES: readonly TopicRule[] = [
	{
		label: "security and access",
		pattern: /\b(?:authentication|authorization|credential|oauth|password|secret|ssh key|access token)\b/i,
	},
	{
		label: "media production",
		pattern: /\b(?:animation|audio|blender|camera|codec|ffmpeg|render(?:ing)?|timeline|video)\b/i,
	},
	{
		label: "infrastructure operations",
		pattern:
			/\b(?:cpu profiler|deployment|docker|incident response|kubernetes|memory pressure|process tree|server)\b/i,
	},
	{
		label: "software engineering",
		pattern:
			/\b(?:api endpoint|compiler|database|javascript|migration|python|rust|source code|stack trace|typescript|unit tests?)\b/i,
	},
	{
		label: "research and analysis",
		pattern: /\b(?:benchmark|dataset|experiment|literature review|paper|research|statistical)\b/i,
	},
];

function normalizedSender(sender: string): string {
	const normalized = sender.replace(/[\r\n\t]+/g, " ").trim();
	return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function shouldStoreAsArtifact(message: IrcExternalMessage, topic: string, inlineBodyMaxBytes: number): boolean {
	if (!Number.isSafeInteger(inlineBodyMaxBytes) || inlineBodyMaxBytes < 1) {
		throw new Error("IRC inline body byte bound must be a positive integer");
	}
	if (Buffer.byteLength(message.body, "utf8") > inlineBodyMaxBytes) return true;
	return message.audience === "broadcast" && topic !== GENERAL_TOPIC;
}

/**
 * Applies deterministic receiver-side IRC payload hygiene before model context
 * construction. Bodies selected by the policy are persisted verbatim, while
 * the model sees only a fixed-topic envelope and recovery URI.
 */
export async function prepareExternalIrcInboundMessage(
	message: IrcExternalMessage,
	options: PrepareExternalIrcInboundOptions,
): Promise<PreparedExternalIrcInboundMessage> {
	const topic = TOPIC_RULES.find(rule => rule.pattern.test(message.body))?.label ?? GENERAL_TOPIC;
	if (!shouldStoreAsArtifact(message, topic, options.inlineBodyMaxBytes)) {
		return { body: message.body, topic };
	}

	const artifactId = await options.saveArtifact(message.body);
	if (!artifactId) throw new Error("Unable to persist external IRC body as a session artifact");
	const artifactUri = `artifact://${artifactId}`;
	return {
		body: [
			"External IRC message withheld from inline context.",
			`Sender: ${normalizedSender(message.fromPeer)}`,
			`Topic: ${topic}`,
			`Reference: ${artifactUri}`,
		].join("\n"),
		artifactUri,
		topic,
	};
}
