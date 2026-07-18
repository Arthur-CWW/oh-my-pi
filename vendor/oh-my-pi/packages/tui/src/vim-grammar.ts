export type VimMode = "insert" | "normal" | "visual" | "visualLine";
export type VimOperator = "d" | "c" | "y";
export type VimRegisterName = "+";
export type VimMotion =
	| "h"
	| "j"
	| "k"
	| "l"
	| "w"
	| "W"
	| "b"
	| "B"
	| "e"
	| "E"
	| "0"
	| "^"
	| "$"
	| "gg"
	| "G";

export interface VimPosition {
	line: number;
	col: number;
}

export type VimAnchor = VimPosition | "cursor";

export interface VimRegister {
	text: string;
	linewise: boolean;
}

/** The small key record the TUI integration can build from its raw key string. */
export interface VimKey {
	char?: string;
	name?: string;
	text?: string;
	key?: string;
	ctrl?: boolean;
	alt?: boolean;
	meta?: boolean;
	shift?: boolean;
}

export interface VimPendingOperator {
	op: VimOperator;
	count: number;
	motionCountText: string;
	prefixG: boolean;
	registerName?: VimRegisterName;
}

export interface VimState {
	mode: VimMode;
	pendingCount: number;
	pendingCountText: string;
	pendingOperator?: VimPendingOperator;
	pendingG: boolean;
	pendingGCount: number;
	pendingGExplicit: boolean;
	pendingR: number;
	pendingRegisterQuote: boolean;
	selectedRegister?: VimRegisterName;
	register: VimRegister;
	visualAnchor?: VimAnchor;
}

type MotionTarget = {
	kind: "motion";
	motion: Exclude<VimMotion, "gg" | "G">;
	count: number;
	linewise: false;
};
type LineTarget = {
	kind: "line";
	count: number;
	linewise: true;
};
type VerticalTarget = {
	kind: "vertical";
	direction: "down" | "up";
	count: number;
	linewise: true;
};
type GotoTarget = {
	kind: "goto";
	line: number | "last";
	linewise: true;
};
type CharacterTarget = {
	kind: "characters";
	direction: "forward" | "backward";
	count: number;
	linewise: false;
};
type LineEndTarget = {
	kind: "line-end";
	linewise: false;
};
type VisualTarget = {
	kind: "visual";
	linewise: boolean;
	anchor?: VimAnchor;
};

export type VimTarget = MotionTarget | LineTarget | VerticalTarget | GotoTarget | CharacterTarget | LineEndTarget | VisualTarget;

export type VimEffect =
	| { type: "motion"; motion: VimMotion; count: number; explicit: boolean }
	| {
			type: "enter-insert";
			variant: "cursor" | "line-start" | "after-cursor" | "line-end" | "open-below" | "open-above";
			count: number;
		}
	| { type: "delete"; target: VimTarget; registerName?: VimRegisterName }
	| { type: "change"; target: VimTarget; registerName?: VimRegisterName }
	| { type: "yank"; target: VimTarget; registerName?: VimRegisterName }
	| { type: "put"; before: boolean; count: number; register: VimRegister; registerName?: VimRegisterName }
	| { type: "replace-char"; char: string; count: number }
	| { type: "undo"; count: number }
	| { type: "redo"; count: number }
	| { type: "mode"; mode: VimMode }
	| { type: "set-visual-anchor"; anchor: "cursor" }
	| { type: "clear-visual-anchor" }
	| { type: "swap-visual-anchor" }
	| { type: "toggle-paste" }
	| { type: "end-insert-session" }
	| { type: "passthrough"; key: VimKey };

const MAX_COUNT = 999;
const EMPTY_REGISTER: VimRegister = { text: "", linewise: false };

export function createVimState(mode: VimMode = "insert", register: VimRegister = EMPTY_REGISTER): VimState {
	return {
		mode,
		pendingCount: 0,
		pendingCountText: "",
		pendingOperator: undefined,
		pendingG: false,
		pendingGCount: 0,
		pendingGExplicit: false,
		pendingR: 0,
		pendingRegisterQuote: false,
		selectedRegister: undefined,
		register: { text: register.text, linewise: register.linewise },
		visualAnchor: undefined,
	};
}

export const initialVimState: VimState = createVimState();

type CountInfo = { count: number; explicit: boolean };

type NormalizedKey = { value: string; printable: boolean; modified: boolean };

function clampCount(value: number): number {
	return Math.max(1, Math.min(MAX_COUNT, value));
}

function normalizeKey(key: VimKey): NormalizedKey | undefined {
	const raw = key.char ?? key.text ?? key.key ?? key.name;
	if (raw === undefined || raw.length === 0) return undefined;
	const value = key.ctrl || key.alt || key.meta ? `${key.ctrl ? "ctrl+" : ""}${key.alt ? "alt+" : ""}${key.meta ? "meta+" : ""}${raw.toLowerCase()}` : raw === "esc" ? "escape" : raw;
	const modified = Boolean(key.ctrl || key.alt || key.meta);
	const printable = !modified && raw.length === 1 && raw.charCodeAt(0) >= 32;
	return { value, printable, modified };
}

function isCountDigit(value: string, current: string): boolean {
	return /^[1-9]$/.test(value) || (current.length > 0 && value === "0");
}

function consumeCount(state: VimState): { state: VimState; info: CountInfo } {
	const explicit = state.pendingCountText.length > 0;
	return {
		state: { ...state, pendingCount: 0, pendingCountText: "" },
		info: { count: explicit ? clampCount(state.pendingCount) : 1, explicit },
	};
}

function appendCount(state: VimState, digit: string): VimState {
	const text = `${state.pendingCountText}${digit}`;
	const parsed = Number.parseInt(text, 10);
	return { ...state, pendingCountText: text, pendingCount: Number.isFinite(parsed) ? Math.min(MAX_COUNT, parsed) : MAX_COUNT };
}

function clearPending(state: VimState): VimState {
	return {
		...state,
		pendingCount: 0,
		pendingCountText: "",
		pendingOperator: undefined,
		pendingG: false,
		pendingGCount: 0,
		pendingGExplicit: false,
		pendingR: 0,
		pendingRegisterQuote: false,
		selectedRegister: undefined,
	};
}

function setMode(state: VimState, mode: VimMode): VimState {
	return { ...clearPending(state), mode, visualAnchor: mode === "visual" || mode === "visualLine" ? state.visualAnchor : undefined };
}

function operation(type: VimOperator | "delete" | "change" | "yank", target: VimTarget, registerName?: VimRegisterName): VimEffect {
	const effectType = type === "d" ? "delete" : type === "c" ? "change" : type === "y" ? "yank" : type;
	return registerName === undefined ? { type: effectType, target } : { type: effectType, target, registerName };
}


function motionTarget(motion: Exclude<VimMotion, "gg" | "G">, count: number): MotionTarget {
	return { kind: "motion", motion, count, linewise: false };
}

function operatorMotionEffect(pending: VimPendingOperator, motion: Exclude<VimMotion, "gg" | "G">, count: number): VimEffect {
	return operation(pending.op, motionTarget(motion, count), pending.registerName);
}

function visualOperation(state: VimState, operator: VimOperator, linewise: boolean, registerName?: VimRegisterName): VimEffect {
	return operation(operator, { kind: "visual", linewise, anchor: state.visualAnchor }, registerName);
}


function reduceInsert(state: VimState, key: VimKey, normalized: NormalizedKey | undefined): { state: VimState; effects: VimEffect[] } {
	if (normalized?.value === "escape") {
		return { state: setMode(state, "normal"), effects: [{ type: "end-insert-session" }, { type: "mode", mode: "normal" }] };
	}
	return { state, effects: [{ type: "passthrough", key }] };
}

function reduceVisual(state: VimState, key: VimKey, normalized: NormalizedKey | undefined): { state: VimState; effects: VimEffect[] } {
	if (normalized === undefined) return { state, effects: [{ type: "passthrough", key }] };
	const value = normalized.value;
	if (value === "escape") {
		return { state: setMode(state, "normal"), effects: [{ type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
	}
	if (state.pendingRegisterQuote) {
		if (value === "+") return { state: { ...state, pendingRegisterQuote: false, selectedRegister: "+" }, effects: [] };
		return { state: clearPending(state), effects: [] };
	}
	if (value === '"') return { state: { ...state, pendingRegisterQuote: true }, effects: [] };
	if (state.pendingG) {
		if (value === "g") {
			const next = setMode(state, state.mode);
			return { state: next, effects: [{ type: "motion", motion: "gg", count: state.pendingGExplicit ? state.pendingGCount : 1, explicit: state.pendingGExplicit }] };
		}
		if (value === "x") return { state: clearPending(state), effects: [{ type: "toggle-paste" }] };
		return { state: clearPending(state), effects: [] };
	}
	if (isCountDigit(value, state.pendingCountText)) return { state: appendCount(state, value), effects: [] };
	const consumed = consumeCount(state);
	const current = consumed.state;
	const { count, explicit } = consumed.info;
	const registerName = state.selectedRegister;
	switch (value) {
		case "v":
			if (state.mode === "visual") return { state: setMode(current, "normal"), effects: [{ type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
			return { state: { ...current, mode: "visual" }, effects: [{ type: "mode", mode: "visual" }] };
		case "V":
			if (state.mode === "visualLine") return { state: setMode(current, "normal"), effects: [{ type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
			return { state: { ...current, mode: "visualLine" }, effects: [{ type: "mode", mode: "visualLine" }] };
		case "o":
			return { state: current, effects: [{ type: "swap-visual-anchor" }] };
		case "h":
		case "j":
		case "k":
		case "l":
		case "w":
		case "W":
		case "b":
		case "B":
		case "e":
		case "E":
		case "0":
		case "^":
		case "$":
			return { state: current, effects: [{ type: "motion", motion: value, count, explicit }] };
		case "g":
			return { state: { ...current, pendingG: true, pendingGCount: count, pendingGExplicit: explicit }, effects: [] };
		case "G":
			return { state: current, effects: [{ type: "motion", motion: "G", count, explicit }] };
		case "d":
		case "x":
			return { state: setMode(current, "normal"), effects: [visualOperation(state, "d", state.mode === "visualLine", registerName), { type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
		case "c":
		case "s":
			return {
				state: { ...clearPending(current), mode: "insert", visualAnchor: undefined },
				effects: [visualOperation(state, "c", state.mode === "visualLine", registerName), { type: "clear-visual-anchor" }, { type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }],
			};
		case "y":
			return { state: setMode(current, "normal"), effects: [visualOperation(state, "y", state.mode === "visualLine", registerName), { type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
		case "D":
			return { state: setMode(current, "normal"), effects: [visualOperation(state, "d", true, registerName), { type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
		case "C":
			return {
				state: { ...clearPending(current), mode: "insert", visualAnchor: undefined },
				effects: [visualOperation(state, "c", true, registerName), { type: "clear-visual-anchor" }, { type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }],
			};
		case "Y":
			return { state: setMode(current, "normal"), effects: [visualOperation(state, "y", true, registerName), { type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }] };
		case "u":
			return { state: setMode(current, "normal"), effects: [{ type: "clear-visual-anchor" }, { type: "mode", mode: "normal" }, { type: "undo", count }] };
		default:
			return normalized.printable ? { state: current, effects: [] } : { state: current, effects: [{ type: "passthrough", key }] };
	}
}

function reduceNormal(state: VimState, key: VimKey, normalized: NormalizedKey | undefined): { state: VimState; effects: VimEffect[] } {
	if (normalized === undefined) return { state, effects: [{ type: "passthrough", key }] };
	const value = normalized.value;
	if (value === "ctrl+r") return { state: clearPending(state), effects: [{ type: "redo", count: state.pendingCountText ? clampCount(state.pendingCount) : 1 }] };
	if (value === "ctrl+-") return { state: clearPending(state), effects: [{ type: "undo", count: state.pendingCountText ? clampCount(state.pendingCount) : 1 }] };
	if (value === "escape") {
		return state.pendingCountText || state.pendingOperator || state.pendingG || state.pendingR > 0 || state.pendingRegisterQuote
			? { state: clearPending(state), effects: [] }
			: { state, effects: [{ type: "passthrough", key }] };
	}
	if (state.pendingR > 0) {
		if (normalized.printable && !normalized.modified && value.length === 1 && value.charCodeAt(0) >= 32) {
			return { state: clearPending(state), effects: [{ type: "replace-char", char: value, count: state.pendingR }] };
		}
		return { state: clearPending(state), effects: [] };
	}
	if (state.pendingRegisterQuote) {
		if (value === "+") return { state: { ...state, pendingRegisterQuote: false, selectedRegister: "+" }, effects: [] };
		return { state: clearPending(state), effects: [] };
	}
	if (value === '"') return { state: { ...state, pendingRegisterQuote: true }, effects: [] };
	if (state.pendingOperator) return reducePendingOperator(state, key, normalized);
	if (state.pendingG) {
		if (value === "g") {
			return { state: clearPending(state), effects: [{ type: "motion", motion: "gg", count: state.pendingGExplicit ? state.pendingGCount : 1, explicit: state.pendingGExplicit }] };
		}
		if (value === "x") return { state: clearPending(state), effects: [{ type: "toggle-paste" }] };
		return { state: clearPending(state), effects: [] };
	}
	if (isCountDigit(value, state.pendingCountText)) return { state: appendCount(state, value), effects: [] };
	const consumed = consumeCount(state);
	const current = consumed.state;
	const { count, explicit } = consumed.info;
	const registerName = state.selectedRegister;
	switch (value) {
		case "d":
		case "c":
		case "y":
			return {
				state: {
					...current,
					pendingOperator: { op: value, count, motionCountText: "", prefixG: false, registerName },
					selectedRegister: undefined,
				},
				effects: [],
			};
		case "v":
			return { state: { ...current, mode: "visual", visualAnchor: "cursor", selectedRegister: undefined }, effects: [{ type: "set-visual-anchor", anchor: "cursor" }, { type: "mode", mode: "visual" }] };
		case "V":
			return { state: { ...current, mode: "visualLine", visualAnchor: "cursor", selectedRegister: undefined }, effects: [{ type: "set-visual-anchor", anchor: "cursor" }, { type: "mode", mode: "visualLine" }] };
		case "i":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }] };
		case "I":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "line-start", count: 1 }, { type: "mode", mode: "insert" }] };
		case "a":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "after-cursor", count: 1 }, { type: "mode", mode: "insert" }] };
		case "A":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "line-end", count: 1 }, { type: "mode", mode: "insert" }] };
		case "o":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "open-below", count }, { type: "mode", mode: "insert" }] };
		case "O":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "enter-insert", variant: "open-above", count }, { type: "mode", mode: "insert" }] };
		case "h":
		case "j":
		case "k":
		case "l":
		case "w":
		case "W":
		case "b":
		case "B":
		case "e":
		case "E":
		case "0":
		case "^":
		case "$":
			return { state: current, effects: [{ type: "motion", motion: value, count, explicit }] };
		case "g":
			return { state: { ...current, pendingG: true, pendingGCount: count, pendingGExplicit: explicit }, effects: [] };
		case "G":
			return { state: current, effects: [{ type: "motion", motion: "G", count, explicit }] };
		case "x":
			return { state: { ...current, selectedRegister: undefined }, effects: [{ type: "delete", target: { kind: "characters", direction: "forward", count, linewise: false }, registerName }] };
		case "X":
			return { state: { ...current, selectedRegister: undefined }, effects: [{ type: "delete", target: { kind: "characters", direction: "backward", count, linewise: false }, registerName }] };
		case "D":
			return { state: { ...current, selectedRegister: undefined }, effects: [operation("d", { kind: "line-end", linewise: false }, registerName)] };
		case "C":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [operation("c", { kind: "line-end", linewise: false }, registerName), { type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }] };
		case "s":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [{ type: "delete", target: { kind: "characters", direction: "forward", count, linewise: false }, registerName }, { type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }] };
		case "S":
			return { state: { ...setMode(current, "insert"), selectedRegister: undefined }, effects: [operation("c", { kind: "line", count, linewise: true }, registerName), { type: "enter-insert", variant: "cursor", count: 1 }, { type: "mode", mode: "insert" }] };
		case "Y":
			return { state: { ...current, selectedRegister: undefined }, effects: [operation("y", { kind: "line", count, linewise: true }, registerName)] };
		case "p":
			return { state: { ...current, selectedRegister: undefined }, effects: [{ type: "put", before: false, count, register: { ...state.register }, registerName }] };
		case "P":
			return { state: { ...current, selectedRegister: undefined }, effects: [{ type: "put", before: true, count, register: { ...state.register }, registerName }] };
		case "r":
			return { state: { ...current, pendingR: count, selectedRegister: undefined }, effects: [] };
		case "u":
			return { state: current, effects: [{ type: "undo", count }] };
		default:
			return normalized.printable ? { state: current, effects: [] } : { state: current, effects: [{ type: "passthrough", key }] };
	}
}

function reducePendingOperator(state: VimState, key: VimKey, normalized: NormalizedKey): { state: VimState; effects: VimEffect[] } {
	const pending = state.pendingOperator;
	if (!pending) return { state, effects: [] };
	const value = normalized.value;
	if (value === "escape") return { state: clearPending(state), effects: [] };
	if (isCountDigit(value, pending.motionCountText)) {
		const text = `${pending.motionCountText}${value}`;
		return { state: { ...state, pendingOperator: { ...pending, motionCountText: text } }, effects: [] };
	}
	const explicit = pending.motionCountText.length > 0;
	const motionCount = explicit ? clampCount(pending.count * (Number.parseInt(pending.motionCountText, 10) || 1)) : pending.count;
	if (pending.prefixG) {
		if (value === "g") {
			const line = explicit ? Math.max(0, (Number.parseInt(pending.motionCountText, 10) || 1) - 1) : 0;
			return { state: clearPending(state), effects: [operation(pending.op, { kind: "goto", line, linewise: true }, pending.registerName)] };
		}
		return { state: clearPending(state), effects: [] };
	}
	if (value === "g") return { state: { ...state, pendingG: true, pendingOperator: { ...pending, prefixG: true } }, effects: [] };
	if (value === pending.op) {
		return { state: clearPending(state), effects: [operation(pending.op, { kind: "line", count: motionCount, linewise: true }, pending.registerName)] };
	}
	if (value === "G") {
		const line = explicit ? Math.max(0, (Number.parseInt(pending.motionCountText, 10) || 1) - 1) : "last";
		return { state: clearPending(state), effects: [operation(pending.op, { kind: "goto", line, linewise: true }, pending.registerName)] };
	}
	if (value === "j" || value === "k") {
		return {
			state: clearPending(state),
			effects: [operation(pending.op, { kind: "vertical", direction: value === "j" ? "down" : "up", count: motionCount, linewise: true }, pending.registerName)],
		};
	}
	if (value === "h" || value === "l" || value === "w" || value === "W" || value === "b" || value === "B" || value === "e" || value === "E" || value === "0" || value === "^" || value === "$") {
		return { state: clearPending(state), effects: [operatorMotionEffect(pending, value, motionCount)] };
	}
	return { state: clearPending(state), effects: [] };
}

export function reduceVimKey(state: VimState, key: VimKey): { state: VimState; effects: VimEffect[] } {
	const normalized = normalizeKey(key);
	if (state.mode === "insert") return reduceInsert(state, key, normalized);
	if (state.mode === "visual" || state.mode === "visualLine") return reduceVisual(state, key, normalized);
	return reduceNormal(state, key, normalized);
}
