import { afterEach, describe, expect, test, vi } from "bun:test";
import * as readline from "node:readline";
import { PassThrough } from "node:stream";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { __test, runAuthBrokerCommand } from "@oh-my-pi/pi-coding-agent/cli/auth-broker-cli";

type TestInput = PassThrough & {
	isTTY: boolean;
	isRaw: boolean;
	setRawMode(mode: boolean): TestInput;
};

const ORIGINAL_STDIN_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, "stdin");
let installedInput: TestInput | undefined;

function createTtyInput(initialRaw: boolean): { input: TestInput; rawModeCalls: boolean[] } {
	const input = new PassThrough() as TestInput;
	const rawModeCalls: boolean[] = [];
	input.isTTY = true;
	input.isRaw = initialRaw;
	input.setRawMode = (mode: boolean) => {
		rawModeCalls.push(mode);
		input.isRaw = mode;
		return input;
	};
	return { input, rawModeCalls };
}

function installStdin(input: TestInput): void {
	installedInput = input;
	Object.defineProperty(process, "stdin", { configurable: true, value: input });
}

function createPrompt(input: TestInput): readline.Interface {
	return readline.createInterface({ input, output: new PassThrough(), terminal: false });
}

function waitForKeypressListener(input: TestInput, command: Promise<void>): Promise<void> {
	if (input.listenerCount("keypress") > 0) return Promise.resolve();
	const promptReady = new Promise<void>(resolve => {
		const onNewListener = (event: string | symbol) => {
			if (event !== "keypress") return;
			input.off("newListener", onNewListener);
			queueMicrotask(resolve);
		};
		input.on("newListener", onNewListener);
	});
	const commandSettled = command.then(
		() => {
			throw new Error("auth-broker command settled before installing its prompt keypress listener");
		},
		error => {
			throw error;
		},
	);
	void commandSettled.catch(() => {});
	return Promise.race([promptReady, commandSettled]);
}

afterEach(() => {
	installedInput?.removeAllListeners();
	installedInput?.destroy();
	installedInput = undefined;
	if (ORIGINAL_STDIN_DESCRIPTOR) Object.defineProperty(process, "stdin", ORIGINAL_STDIN_DESCRIPTOR);
	vi.restoreAllMocks();
});

describe("auth-broker CLI prompt cancellation", () => {
	test("Escape cancels and restores raw mode/listeners", async () => {
		const { input, rawModeCalls } = createTtyInput(false);
		installStdin(input);
		const rl = createPrompt(input);
		const promise = __test.promptLine(rl, "Enter provider: ");

		expect(input.isRaw).toBe(true);
		expect(input.listenerCount("keypress")).toBe(1);
		expect(rl.listenerCount("SIGINT")).toBe(1);

		const key: readline.Key = { name: "escape" };
		input.emit("keypress", "\u001b", key);

		await expect(promise).rejects.toThrow("Login cancelled");
		expect(input.isRaw).toBe(false);
		expect(rawModeCalls).toEqual([true, false]);
		expect(input.listenerCount("keypress")).toBe(0);
		expect(rl.listenerCount("SIGINT")).toBe(0);
	});

	test("Ctrl-C keypress cancels and restores the previous raw-mode state", async () => {
		const { input, rawModeCalls } = createTtyInput(true);
		installStdin(input);
		const rl = createPrompt(input);
		const promise = __test.promptLine(rl, "Enter provider: ");

		const key: readline.Key = { ctrl: true, name: "c" };
		input.emit("keypress", "\u0003", key);

		await expect(promise).rejects.toThrow("Login cancelled");
		expect(input.isRaw).toBe(true);
		expect(rawModeCalls).toEqual([true, true]);
		expect(input.listenerCount("keypress")).toBe(0);
		expect(rl.listenerCount("SIGINT")).toBe(0);
	});

	test("readline SIGINT cancels and removes prompt hooks", async () => {
		const { input, rawModeCalls } = createTtyInput(false);
		installStdin(input);
		const rl = createPrompt(input);
		const promise = __test.promptLine(rl, "Enter provider: ");
		const close = vi.spyOn(rl, "close");

		rl.emit("SIGINT");

		await expect(promise).rejects.toThrow("Login cancelled");
		expect(input.isRaw).toBe(false);
		expect(rawModeCalls).toEqual([true, false]);
		expect(input.listenerCount("keypress")).toBe(0);
		expect(rl.listenerCount("SIGINT")).toBe(0);
		expect(close).toHaveBeenCalledTimes(1);
	});

	test("normal answers also remove raw-mode listeners", async () => {
		const { input, rawModeCalls } = createTtyInput(false);
		installStdin(input);
		const rl = createPrompt(input);
		const promise = __test.promptLine(rl, "Enter provider: ");

		input.write("kimi\n");

		await expect(promise).resolves.toBe("kimi");
		expect(input.isRaw).toBe(false);
		expect(rawModeCalls).toEqual([true, false]);
		expect(input.listenerCount("keypress")).toBe(0);
		expect(rl.listenerCount("SIGINT")).toBe(0);
		rl.close();
	});

	test("cancelling interactive login before provider selection does not open the credential store", async () => {
		const { input } = createTtyInput(false);
		installStdin(input);
		const open = vi.spyOn(SqliteAuthCredentialStore, "open");
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		const command = runAuthBrokerCommand({ action: "login", flags: {} });
		await waitForKeypressListener(input, command);
		const key: readline.Key = { name: "escape" };
		input.emit("keypress", "\u001b", key);

		await expect(command).rejects.toThrow("Login cancelled");
		expect(open).not.toHaveBeenCalled();
		expect(input.listenerCount("keypress")).toBe(0);
	});

	test("cancelling interactive logout closes the store without deleting credentials", async () => {
		const { input } = createTtyInput(false);
		installStdin(input);
		const deleteAuthCredentialsForProvider = vi.fn();
		const close = vi.fn();
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(SqliteAuthCredentialStore, "open").mockResolvedValue({
			listProviders: () => ["kimi"],
			deleteAuthCredentialsForProvider,
			close,
		} as never);

		const command = runAuthBrokerCommand({ action: "logout", flags: {} });
		await waitForKeypressListener(input, command);
		const key: readline.Key = { name: "escape" };
		input.emit("keypress", "\u001b", key);

		await expect(command).rejects.toThrow("Login cancelled");
		expect(deleteAuthCredentialsForProvider).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
		expect(input.listenerCount("keypress")).toBe(0);
	});
});
