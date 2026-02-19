import { describe, expect, it } from "bun:test";
import { parseGitHubUrl } from "../src/old/github-extract.ts";
import { isPDF } from "../src/old/pdf-extract.ts";
import { isYouTubeURL } from "../src/old/youtube-extract.ts";

describe("URL parsers", () => {
	it("parses github root URL", () => {
		const parsed = parseGitHubUrl("https://github.com/owner/repo");
		expect(parsed).not.toBeNull();
		expect(parsed?.type).toBe("root");
		expect(parsed?.owner).toBe("owner");
		expect(parsed?.repo).toBe("repo");
	});

	it("parses github blob URL", () => {
		const parsed = parseGitHubUrl("https://github.com/owner/repo/blob/main/src/index.ts");
		expect(parsed?.type).toBe("blob");
		expect(parsed?.ref).toBe("main");
		expect(parsed?.path).toBe("src/index.ts");
	});

	it("rejects non-code github URLs", () => {
		expect(parseGitHubUrl("https://github.com/owner/repo/issues/1")).toBeNull();
	});

	it("detects pdf by URL or content-type", () => {
		expect(isPDF("https://example.com/a.pdf")).toBe(true);
		expect(isPDF("https://example.com/a", "application/pdf")).toBe(true);
		expect(isPDF("https://example.com/a", "text/html")).toBe(false);
	});

	it("parses youtube URLs", () => {
		const y1 = isYouTubeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
		expect(y1.isYouTube).toBe(true);
		expect(y1.videoId).toBe("dQw4w9WgXcQ");

		const y2 = isYouTubeURL("https://youtu.be/dQw4w9WgXcQ");
		expect(y2.isYouTube).toBe(true);
		expect(y2.videoId).toBe("dQw4w9WgXcQ");

		expect(isYouTubeURL("https://example.com/video").isYouTube).toBe(false);
	});
});
