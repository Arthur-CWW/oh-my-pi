import { getConfigRootDir, refreshDirsFromEnv } from "../../src/dirs";
import "../../src/env";

interface AuthoritySnapshot {
	configRoot: string;
	envConfigRoot: string | null;
}

function snapshot(): AuthoritySnapshot {
	return {
		configRoot: getConfigRootDir(),
		envConfigRoot: process.env.OMP_CONFIG_ROOT ?? null,
	};
}

if (process.env.TEST_CONFIG_ROOT_CHILD === "1") {
	process.stdout.write(JSON.stringify(snapshot()));
} else {
	const mutatedRoot = process.env.TEST_MUTATE_CONFIG_ROOT;
	if (mutatedRoot !== undefined) {
		process.env.OMP_CONFIG_ROOT = mutatedRoot;
		refreshDirsFromEnv();
	}

	const child = Bun.spawn([process.execPath, import.meta.path], {
		cwd: process.cwd(),
		env: { ...process.env, TEST_CONFIG_ROOT_CHILD: "1" },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`Child authority probe failed (${exitCode}): ${stderr}`);

	process.stdout.write(
		JSON.stringify({
			parent: snapshot(),
			child: JSON.parse(stdout) as AuthoritySnapshot,
		}),
	);
}
