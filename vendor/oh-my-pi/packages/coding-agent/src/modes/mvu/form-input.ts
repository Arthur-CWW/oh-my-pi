import type { KeyEvent } from "./schema";

export interface TextDraftModel {
	readonly value: string;
	readonly cursor: number;
}

export type TextDraftMap<Key extends string> = Readonly<Record<Key, TextDraftModel>>;

export function makeTextDraftMap<Key extends string>(
	keys: readonly Key[],
	initial: Partial<Record<Key, string>> = {},
): TextDraftMap<Key> {
	const drafts = {} as Record<Key, TextDraftModel>;
	for (const key of keys) drafts[key] = makeTextDraft(initial[key] ?? "");
	return drafts;
}

export type TextDraftMsg =
	| { readonly _tag: "Insert"; readonly text: string }
	| { readonly _tag: "Backspace" }
	| { readonly _tag: "Delete" }
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "Jump"; readonly target: "start" | "end" }
	| { readonly _tag: "Replace"; readonly value: string }
	| { readonly _tag: "Submit" }
	| { readonly _tag: "Cancel" };

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function previousTextBoundary(value: string, cursor: number): number {
	let previous = 0;
	for (const part of segmenter.segment(value)) {
		if (part.index >= cursor) break;
		previous = part.index;
	}
	return previous;
}

export function nextTextBoundary(value: string, cursor: number): number {
	for (const part of segmenter.segment(value)) {
		if (part.index > cursor) return part.index;
	}
	return value.length;
}

export function makeTextDraft(value = ""): TextDraftModel {
	return { value, cursor: value.length };
}

export function updateTextDraft(model: TextDraftModel, msg: TextDraftMsg): TextDraftModel {
	switch (msg._tag) {
		case "Insert": {
			if (!msg.text) return model;
			const value = model.value.slice(0, model.cursor) + msg.text + model.value.slice(model.cursor);
			return { value, cursor: model.cursor + msg.text.length };
		}
		case "Backspace": {
			if (model.cursor <= 0) return model;
			const start = previousTextBoundary(model.value, model.cursor);
			return { value: model.value.slice(0, start) + model.value.slice(model.cursor), cursor: start };
		}
		case "Delete": {
			if (model.cursor >= model.value.length) return model;
			const end = nextTextBoundary(model.value, model.cursor);
			return { value: model.value.slice(0, model.cursor) + model.value.slice(end), cursor: model.cursor };
		}
		case "Move": {
			const cursor = msg.delta < 0 ? previousTextBoundary(model.value, model.cursor) : nextTextBoundary(model.value, model.cursor);
			return cursor === model.cursor ? model : { ...model, cursor };
		}
		case "Jump": {
			const cursor = msg.target === "start" ? 0 : model.value.length;
			return cursor === model.cursor ? model : { ...model, cursor };
		}
		case "Replace":
			return msg.value === model.value && model.cursor === msg.value.length
				? model
				: { value: msg.value, cursor: msg.value.length };
		case "Submit":
		case "Cancel":
			return model;
	}
}

export function updateTextDraftAt<Key extends string>(
	drafts: TextDraftMap<Key>,
	key: Key,
	msg: TextDraftMsg,
): TextDraftMap<Key> {
	const current = drafts[key];
	const next = updateTextDraft(current, msg);
	return next === current ? drafts : { ...drafts, [key]: next };
}

/** Converts already-decoded key events into pure text-edit messages. */
export function textDraftMsgFromEvent(event: KeyEvent): TextDraftMsg | undefined {
	if (event._tag === "Paste") return { _tag: "Insert", text: event.text };
	if (event._tag !== "Press") return undefined;
	if (event.text !== undefined && event.text.length > 0) return { _tag: "Insert", text: event.text };
	switch (String(event.key)) {
		case "enter":
		case "return":
			return { _tag: "Submit" };
		case "escape":
			return { _tag: "Cancel" };
		case "backspace":
			return { _tag: "Backspace" };
		case "delete":
			return { _tag: "Delete" };
		case "left":
			return { _tag: "Move", delta: -1 };
		case "right":
			return { _tag: "Move", delta: 1 };
		case "home":
			return { _tag: "Jump", target: "start" };
		case "end":
			return { _tag: "Jump", target: "end" };
		default:
			return undefined;
	}
}
