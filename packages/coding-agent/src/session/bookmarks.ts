import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";

export const BOOKMARKS_SCHEMA_VERSION = 1 as const;
export const DEFAULT_BOOKMARKS_PATH = path.join(os.homedir(), ".omp", "agent", "bookmarks-v1.jsonl");

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const TimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);

export const BookmarkTargetSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("session"),
		sessionId: NonEmptyStringSchema,
		title: NonEmptyStringSchema,
	}),
	Schema.Struct({
		kind: Schema.Literal("agent"),
		sessionId: NonEmptyStringSchema,
		agentId: NonEmptyStringSchema,
		title: NonEmptyStringSchema,
	}),
]);

export const BookmarkRecordSchema = Schema.Struct({
	id: NonEmptyStringSchema,
	createdAt: TimestampSchema,
	tag: Schema.optional(NonEmptyStringSchema),
	note: Schema.optional(NonEmptyStringSchema),
	target: BookmarkTargetSchema,
	cwd: NonEmptyStringSchema,
});

export type BookmarkTarget = typeof BookmarkTargetSchema.Type;
export type BookmarkRecord = typeof BookmarkRecordSchema.Type;

export interface BookmarkInput {
	readonly target: BookmarkTarget;
	readonly cwd: string;
	readonly tag?: string;
	readonly note?: string;
}

export interface BookmarksStoreOptions {
	readonly filePath?: string;
	readonly now?: () => Date;
	readonly idFactory?: () => string;
}

function targetKey(target: BookmarkTarget): string {
	return target.kind === "agent"
		? `${target.kind}:${target.sessionId}:${target.agentId}`
		: `${target.kind}:${target.sessionId}`;
}

function isNotFound(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function cleanOptional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function decodeRecord(raw: string): BookmarkRecord | undefined {
	try {
		return Schema.decodeUnknownSync(BookmarkRecordSchema)(JSON.parse(raw), { onExcessProperty: "error" });
	} catch {
		return undefined;
	}
}

export class BookmarksStore {
	readonly filePath: string;
	readonly #now: () => Date;
	readonly #idFactory: () => string;

	constructor(options: BookmarksStoreOptions = {}) {
		this.filePath = options.filePath ?? DEFAULT_BOOKMARKS_PATH;
		this.#now = options.now ?? (() => new Date());
		this.#idFactory = options.idFactory ?? randomUUID;
	}

	async list(): Promise<BookmarkRecord[]> {
		let raw: string;
		try {
			raw = await fs.readFile(this.filePath, "utf8");
		} catch (error) {
			if (isNotFound(error)) return [];
			throw error;
		}

		const byTarget = new Map<string, BookmarkRecord>();
		for (const line of raw.split("\n")) {
			const record = line.trim() ? decodeRecord(line) : undefined;
			if (record) byTarget.set(targetKey(record.target), record);
		}
		return [...byTarget.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
	}

	async upsert(input: BookmarkInput): Promise<BookmarkRecord> {
		const tag = cleanOptional(input.tag);
		const note = cleanOptional(input.note);
		const existing = (await this.list()).find(record => targetKey(record.target) === targetKey(input.target));
		const record: BookmarkRecord = {
			id: existing?.id ?? this.#idFactory(),
			createdAt: existing?.createdAt ?? this.#now().toISOString(),
			...(tag === undefined ? {} : { tag }),
			...(note === undefined ? {} : { note }),
			target: input.target,
			cwd: input.cwd,
		};
		await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
		return record;
	}
}

export function bookmarkTargetKey(target: BookmarkTarget): string {
	return targetKey(target);
}
