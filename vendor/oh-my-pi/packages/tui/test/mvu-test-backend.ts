import type { Component } from "@oh-my-pi/pi-tui";

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface CellStyle {
	readonly foreground?: string;
	readonly background?: string;
	readonly bold: boolean;
	readonly dim: boolean;
	readonly underline: boolean;
	readonly inverse: boolean;
}

export interface GridCell {
	readonly text: string;
	readonly width: number;
	readonly style: CellStyle;
}

export interface Grid {
	readonly columns: number;
	readonly rows: number;
	cell(row: number, column: number): GridCell;
	region(rect: Rect): readonly string[];
}

const DEFAULT_STYLE: CellStyle = {
	bold: false,
	dim: false,
	underline: false,
	inverse: false,
};

const ANSI_COLOR: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "bright-black",
	91: "bright-red",
	92: "bright-green",
	93: "bright-yellow",
	94: "bright-blue",
	95: "bright-magenta",
	96: "bright-cyan",
	97: "bright-white",
};

const ANSI_BACKGROUND: Record<number, string> = {
	40: "black",
	41: "red",
	42: "green",
	43: "yellow",
	44: "blue",
	45: "magenta",
	46: "cyan",
	47: "white",
	100: "bright-black",
	101: "bright-red",
	102: "bright-green",
	103: "bright-yellow",
	104: "bright-blue",
	105: "bright-magenta",
	106: "bright-cyan",
	107: "bright-white",
};

function rgbColor(red: number, green: number, blue: number): string {
	return `rgb(${red},${green},${blue})`;
}

function indexedColor(index: number): string {
	return `ansi-${index}`;
}

function applySgr(style: CellStyle, params: readonly number[]): CellStyle {
	let next: CellStyle = style;
	for (let index = 0; index < params.length; index++) {
		const code = params[index] ?? 0;
		if (code === 0) {
			next = DEFAULT_STYLE;
		} else if (code === 1) {
			next = { ...next, bold: true };
		} else if (code === 2) {
			next = { ...next, dim: true };
		} else if (code === 4) {
			next = { ...next, underline: true };
		} else if (code === 7) {
			next = { ...next, inverse: true };
		} else if (code === 22) {
			next = { ...next, bold: false, dim: false };
		} else if (code === 24) {
			next = { ...next, underline: false };
		} else if (code === 27) {
			next = { ...next, inverse: false };
		} else if (code === 39) {
			next = { ...next, foreground: undefined };
		} else if (code === 49) {
			next = { ...next, background: undefined };
		} else if (ANSI_COLOR[code] !== undefined) {
			next = { ...next, foreground: ANSI_COLOR[code] };
		} else if (ANSI_BACKGROUND[code] !== undefined) {
			next = { ...next, background: ANSI_BACKGROUND[code] };
		} else if (code === 38 || code === 48) {
			const colorMode = params[index + 1];
			if (colorMode === 5 && params[index + 2] !== undefined) {
				const color = indexedColor(params[index + 2]!);
				next = code === 38 ? { ...next, foreground: color } : { ...next, background: color };
				index += 2;
			} else if (
				colorMode === 2 &&
				params[index + 2] !== undefined &&
				params[index + 3] !== undefined &&
				params[index + 4] !== undefined
			) {
				const color = rgbColor(params[index + 2]!, params[index + 3]!, params[index + 4]!);
				next = code === 38 ? { ...next, foreground: color } : { ...next, background: color };
				index += 4;
			}
		}
	}
	return next;
}

function parseSgr(line: string, at: number, style: CellStyle): { readonly next: number; readonly style: CellStyle } | undefined {
	if (line.charCodeAt(at) !== 0x1b || line.charCodeAt(at + 1) !== 0x5b) return undefined;
	let cursor = at + 2;
	while (cursor < line.length) {
		const code = line.charCodeAt(cursor);
		if (code >= 0x40 && code <= 0x7e) break;
		cursor += 1;
	}
	if (cursor >= line.length) return { next: line.length, style };
	if (line[cursor] !== "m") return { next: cursor + 1, style };
	const paramsText = line.slice(at + 2, cursor);
	const params = paramsText.length === 0 ? [0] : paramsText.split(";").map(value => Number(value) || 0);
	return { next: cursor + 1, style: applySgr(style, params) };
}

function parseOsc(line: string, at: number): number | undefined {
	if (line.charCodeAt(at) !== 0x1b || line.charCodeAt(at + 1) !== 0x5d) return undefined;
	const bell = line.indexOf("\u0007", at + 2);
	const st = line.indexOf("\u001b\\", at + 2);
	if (bell < 0 && st < 0) return line.length;
	if (bell >= 0 && (st < 0 || bell < st)) return bell + 1;
	return st + 2;
}

function cellsForLine(line: string, columns: number): GridCell[] {
	const cells: GridCell[] = [];
	for (let column = 0; column < columns; column++) cells.push({ text: "", width: 1, style: DEFAULT_STYLE });
	let column = 0;
	let style = DEFAULT_STYLE;
	for (let index = 0; index < line.length && column < columns; ) {
		const sgr = parseSgr(line, index, style);
		if (sgr) {
			index = sgr.next;
			style = sgr.style;
			continue;
		}
		const osc = parseOsc(line, index);
		if (osc !== undefined) {
			index = osc;
			continue;
		}
		const code = line.charCodeAt(index);
		if (code === 0x1b) {
			index += 1;
			continue;
		}
		if (code === 0x0d) {
			index += 1;
			continue;
		}
		if (code === 0x09) {
			for (let spaces = 0; spaces < 4 && column < columns; spaces++) {
				cells[column] = { text: " ", width: 1, style };
				column += 1;
			}
			index += 1;
			continue;
		}
		if (code < 0x20) {
			index += 1;
			continue;
		}
		const codePoint = line.codePointAt(index);
		if (codePoint === undefined) break;
		const text = String.fromCodePoint(codePoint);
		const width = Bun.stringWidth(text);
		index += text.length;
		if (width === 0) {
			if (column > 0) {
				const previous = cells[column - 1]!;
				cells[column - 1] = { ...previous, text: previous.text + text };
			}
			continue;
		}
		if (column + width > columns) break;
		cells[column] = { text, width, style };
		for (let offset = 1; offset < width; offset++) {
			cells[column + offset] = { text: "", width: 0, style };
		}
		column += width;
	}
	return cells;
}

class CellGrid implements Grid {
	readonly columns: number;
	readonly rows: number;
	readonly #cells: readonly (readonly GridCell[])[];

	constructor(columns: number, rows: number, lines: readonly string[]) {
		this.columns = columns;
		this.rows = rows;
		const grid: GridCell[][] = [];
		for (let row = 0; row < rows; row++) grid.push(cellsForLine(lines[row] ?? "", columns));
		this.#cells = grid;
	}

	cell(row: number, column: number): GridCell {
		if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
			throw new RangeError(`Grid cell out of bounds: ${row},${column}`);
		}
		return this.#cells[row]![column]!;
	}

	region(rect: Rect): readonly string[] {
		const left = Math.max(0, Math.min(this.columns, rect.x));
		const top = Math.max(0, Math.min(this.rows, rect.y));
		const right = Math.max(left, Math.min(this.columns, rect.x + Math.max(0, rect.width)));
		const bottom = Math.max(top, Math.min(this.rows, rect.y + Math.max(0, rect.height)));
		const output: string[] = [];
		for (let row = top; row < bottom; row++) {
			let line = "";
			for (let column = left; column < right; column++) {
				const cell = this.#cells[row]![column]!;
				line += cell.width === 0 ? "" : cell.text || " ";
			}
			output.push(line);
		}
		return output;
	}
}

/**
 * Real component-render test backend. It intentionally bypasses ANSI/PTY
 * framing: the mounted Component.render output is decoded directly into cells.
 */
export class MvuTestBackend {
	#columns: number;
	#rows: number;
	#root: Component | undefined;

	constructor(columns: number, rows: number) {
		this.#columns = Math.max(1, columns);
		this.#rows = Math.max(1, rows);
	}

	mount(root: Component): void {
		this.#root = root;
	}

	render(): Grid {
		if (!this.#root) throw new Error("MvuTestBackend.render() called before mount()");
		return new CellGrid(this.#columns, this.#rows, this.#root.render(this.#columns));
	}

	resize(columns: number, rows: number): Grid {
		this.#columns = Math.max(1, columns);
		this.#rows = Math.max(1, rows);
		return this.render();
	}
}
