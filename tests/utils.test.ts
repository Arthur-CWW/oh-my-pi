import { describe, expect, it } from "bun:test";
import {
	formatSeconds,
	isTimeoutError,
	mapFfmpegError,
	readExecError,
	trimErrorText,
} from "../src/old/utils.ts";

describe("utils", () => {
	it("formats seconds correctly", () => {
		expect(formatSeconds(65)).toBe("1:05");
		expect(formatSeconds(3661)).toBe("1:01:01");
	});

	it("trims noisy error text", () => {
		expect(trimErrorText(" a\n\n b\t c ")).toBe("a b c");
	});

	it("detects timeout errors", () => {
		expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
		expect(isTimeoutError({ message: "request timed out" })).toBe(true);
		expect(isTimeoutError({})).toBe(false);
	});

	it("normalizes exec errors", () => {
		const err = {
			code: "ENOENT",
			message: "missing",
			stderr: Buffer.from("stderr msg"),
		};
		expect(readExecError(err)).toEqual({
			code: "ENOENT",
			message: "missing",
			stderr: "stderr msg",
		});
	});

	it("maps ffmpeg errors", () => {
		expect(mapFfmpegError({ code: "ENOENT" })).toContain("ffmpeg is not installed");
		expect(mapFfmpegError({ message: "operation timed out" })).toContain("timed out");
	});
});
