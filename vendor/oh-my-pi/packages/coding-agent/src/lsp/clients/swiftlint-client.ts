/**
 * SwiftLint CLI-based linter client.
 * Parses SwiftLint's JSON reporter output into LSP Diagnostic format.
 */
import {
	DEFAULT_STREAM_CAP_BYTES,
	DIAGNOSTIC_STREAM_CAP_BYTES,
	readCapped,
	withCappedStreamNotice,
} from "@oh-my-pi/pi-utils";
import type { Diagnostic, DiagnosticSeverity, LinterClient, ServerConfig } from "../../lsp/types";

/** Shape of a single violation from `swiftlint lint --reporter json`. */
interface SwiftLintViolation {
	character: number;
	file: string;
	line: number;
	reason: string;
	rule_id: string;
	severity: "Error" | "Warning";
	type: string;
}

interface CapturedOutputOverflow {
	readonly keptBytes: number;
	readonly totalBytes: number;
}

interface SwiftLintRunResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly success: boolean;
	readonly stdoutOverflow?: CapturedOutputOverflow;
}

function parseSeverity(severity: string): DiagnosticSeverity {
	switch (severity) {
		case "Error":
			return 1;
		case "Warning":
			return 2;
		default:
			return 2;
	}
}

function overflowDiagnostic(overflow: CapturedOutputOverflow): Diagnostic {
	return {
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
		},
		severity: 1,
		code: "output-overflow",
		source: "swiftlint",
		message:
			`SwiftLint emitted ${overflow.totalBytes} bytes, exceeding the ${overflow.keptBytes}-byte capture limit; ` +
			"diagnostics are incomplete and were not parsed.",
	};
}

async function runSwiftLint(args: string[], cwd: string, resolvedCommand?: string): Promise<SwiftLintRunResult> {
	const command = resolvedCommand ?? "swiftlint";

	try {
		const proc = Bun.spawn([command, ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
		});

		const [stdoutRead, stderrRead] = await Promise.all([
			readCapped(proc.stdout, DEFAULT_STREAM_CAP_BYTES),
			readCapped(proc.stderr, DIAGNOSTIC_STREAM_CAP_BYTES),
			proc.exited,
		]);
		const stdout = withCappedStreamNotice(stdoutRead, "stdout");
		const stderr = withCappedStreamNotice(stderrRead, "stderr");

		// swiftlint exits non-zero when violations are found — that's not a failure
		return {
			stdout,
			stderr,
			success: stdoutRead.text.length > 0,
			stdoutOverflow: stdoutRead.truncated
				? { keptBytes: stdoutRead.keptBytes, totalBytes: stdoutRead.totalBytes }
				: undefined,
		};
	} catch (err) {
		return { stdout: "", stderr: String(err), success: false };
	}
}

/**
 * SwiftLint CLI-based linter client.
 * Runs `swiftlint lint --reporter json` and converts violations to LSP diagnostics.
 */
export class SwiftLintClient implements LinterClient {
	/** Factory method for creating SwiftLintClient instances */
	static create(config: ServerConfig, cwd: string): LinterClient {
		return new SwiftLintClient(config, cwd);
	}

	constructor(
		private readonly config: ServerConfig,
		private readonly cwd: string,
	) {}

	async format(_filePath: string, content: string): Promise<string> {
		// SwiftLint doesn't support formatting
		return content;
	}

	async lint(filePath: string): Promise<Diagnostic[]> {
		const result = await runSwiftLint(
			["lint", "--quiet", "--reporter", "json", filePath],
			this.cwd,
			this.config.resolvedCommand,
		);

		if (result.stdoutOverflow) {
			return [overflowDiagnostic(result.stdoutOverflow)];
		}

		if (!result.success) {
			return [];
		}

		return this.#parseJsonOutput(result.stdout);
	}

	#parseJsonOutput(jsonOutput: string): Diagnostic[] {
		const diagnostics: Diagnostic[] = [];

		try {
			const violations: SwiftLintViolation[] = JSON.parse(jsonOutput);

			for (const v of violations) {
				// SwiftLint lines/characters are 1-based; LSP is 0-based
				const line = Math.max(0, v.line - 1);
				const character = Math.max(0, v.character - 1);

				diagnostics.push({
					range: {
						start: { line, character },
						end: { line, character },
					},
					severity: parseSeverity(v.severity),
					message: v.reason,
					source: "swiftlint",
					code: v.rule_id,
				});
			}
		} catch {
			// JSON parse failed, return empty
		}

		return diagnostics;
	}

	dispose(): void {
		// Nothing to dispose for CLI client
	}
}
