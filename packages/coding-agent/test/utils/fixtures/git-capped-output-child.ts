import * as git from "../../../src/utils/git";

const [workDir, totalBytesText, capBytesText] = process.argv.slice(2);
if (!workDir || !totalBytesText || !capBytesText) throw new Error("expected workDir, totalBytes, and capBytes");

const totalBytes = Number.parseInt(totalBytesText, 10);
const capBytes = Number.parseInt(capBytesText, 10);
const result = await git.run(workDir, ["shim"], {
	env: { GIT_SHIM_BYTES: String(totalBytes) },
	maxStdoutBytes: capBytes,
});

process.stdout.write(
	JSON.stringify({
		totalBytes: result.stdoutBytes,
		retainedBytes: result.stdoutKeptBytes,
		truncated: result.stdoutTruncated,
		maxRssKiB: process.resourceUsage().maxRSS,
	}),
);
