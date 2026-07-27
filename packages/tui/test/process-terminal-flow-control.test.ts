import { afterEach, describe, expect, it, vi } from "bun:test";
import { emergencyTerminalRestore, ProcessTerminal, setAltScreenActive } from "@oh-my-pi/pi-tui/terminal";

const stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdinIsRawDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isRaw");
const stdinSetRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");
const stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

interface TerminalMocks {
	rawModeCalls: boolean[];
	writes: string[];
}

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
		return;
	}
	Reflect.deleteProperty(target, key);
}

function installTtyMocks(initialRaw: boolean): TerminalMocks {
	let rawState = initialRaw;
	const rawModeCalls: boolean[] = [];
	const writes: string[] = [];

	Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", {
		configurable: true,
		get: () => rawState,
	});
	Object.defineProperty(process.stdin, "setRawMode", {
		configurable: true,
		value: (enabled: boolean) => {
			rawModeCalls.push(enabled);
			rawState = enabled;
			return process.stdin;
		},
	});

	vi.spyOn(process, "kill").mockReturnValue(true);
	vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
	vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
	vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
	vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
		writes.push(typeof chunk === "string" ? chunk : chunk.toString());
		return true;
	});

	return { rawModeCalls, writes };
}

describe("ProcessTerminal early flow-control acquisition", () => {
	afterEach(() => {
		setAltScreenActive(false);
		vi.restoreAllMocks();
		restoreProperty(process.stdin, "isTTY", stdinIsTtyDescriptor);
		restoreProperty(process.stdin, "isRaw", stdinIsRawDescriptor);
		restoreProperty(process.stdin, "setRawMode", stdinSetRawModeDescriptor);
		restoreProperty(process.stdout, "isTTY", stdoutIsTtyDescriptor);
	});

	it("enters raw mode at construction before start so startup Ctrl-S/DC3 is not swallowed", () => {
		const { rawModeCalls } = installTtyMocks(false);
		const received: string[] = [];

		const terminal = new ProcessTerminal();

		expect(rawModeCalls).toEqual([true]);

		terminal.start(
			data => received.push(data),
			() => {},
		);
		// StdinBuffer emits single non-escape bytes synchronously; this proves the
		// post-acquisition JS input path still delivers DC3 to the application.
		process.stdin.emit("data", "\x13");
		expect(received).toEqual(["\x13"]);

		terminal.stop();
		expect(rawModeCalls).toEqual([true, false]);
	});

	it("restores the prior non-raw state on stop", () => {
		const { rawModeCalls } = installTtyMocks(false);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		terminal.stop();

		expect(rawModeCalls).toEqual([true, false]);
	});

	it("restores the prior raw state on stop", () => {
		const { rawModeCalls } = installTtyMocks(true);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		terminal.stop();

		expect(rawModeCalls).toEqual([true, true]);
	});

	it("re-acquires raw mode after stop when started again", () => {
		const { rawModeCalls } = installTtyMocks(false);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		terminal.stop();
		terminal.start(
			() => {},
			() => {},
		);
		expect(rawModeCalls).toEqual([true, false, true]);

		terminal.stop();
		expect(rawModeCalls).toEqual([true, false, true, false]);
	});

	it("restores constructor-acquired raw mode if emergency cleanup runs before start", () => {
		const { rawModeCalls } = installTtyMocks(false);

		new ProcessTerminal();
		emergencyTerminalRestore();

		expect(rawModeCalls).toEqual([true, false]);
	});

	it("restores the captured raw state on live and orphan emergency cleanup", () => {
		const { rawModeCalls } = installTtyMocks(true);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		emergencyTerminalRestore();
		expect(rawModeCalls).toEqual([true, true]);

		emergencyTerminalRestore();
		expect(rawModeCalls).toEqual([true, true, true]);
	});

	it("skips orphan emergency restore when stdin/stdout are no longer TTYs", () => {
		const { rawModeCalls, writes } = installTtyMocks(false);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		terminal.stop();
		rawModeCalls.length = 0;
		writes.length = 0;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
		emergencyTerminalRestore();

		expect(rawModeCalls).toEqual([]);
		expect(writes).toEqual([]);
	});

	it("does not mutate stdin raw mode when stdin is not a TTY", () => {
		const rawModeCalls: boolean[] = [];
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
		Object.defineProperty(process.stdin, "isRaw", { value: false, configurable: true });
		Object.defineProperty(process.stdin, "setRawMode", {
			configurable: true,
			value: (enabled: boolean) => {
				rawModeCalls.push(enabled);
				return process.stdin;
			},
		});
		vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);

		const terminal = new ProcessTerminal();

		terminal.stop();
		expect(rawModeCalls).toEqual([]);
	});

	it("keeps raw mode active until stop so Ctrl-Q/DC1 cannot toggle output flow control mid-session", () => {
		const { rawModeCalls, writes } = installTtyMocks(false);
		const terminal = new ProcessTerminal();

		terminal.start(
			() => {},
			() => {},
		);
		terminal.write("\x11still rendered");

		expect(rawModeCalls).toEqual([true]);
		expect(writes.join("")).toContain("\x11still rendered");

		terminal.stop();
		expect(rawModeCalls).toEqual([true, false]);
	});
});
