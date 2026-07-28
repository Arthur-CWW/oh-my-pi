import * as fs from "node:fs";
import * as path from "node:path";
import * as dirs from "../../src/dirs";

const expectedRoot = process.env.TEST_EXPECT_CONFIG_ROOT;
const hostile = process.env.TEST_HOSTILE_ROOT;
if (!hostile) throw new Error("TEST_HOSTILE_ROOT is required");

if (expectedRoot === undefined) {
	process.stdout.write(
		JSON.stringify({
			configHome: dirs.getConfigHomeDir(),
			configRoot: dirs.getConfigRootDir(),
			agentDir: dirs.getAgentDir(),
			statsDb: dirs.getStatsDbPath(),
			githubCache: dirs.getGithubCacheDbPath(),
			authBrokerCache: dirs.getAuthBrokerSnapshotCachePath(),
		}),
	);
	process.exit(0);
}

const root = path.normalize(expectedRoot);
const paths: Record<string, string> = {};
const capture = (name: string, value: string): string => {
	paths[name] = value;
	const relative = path.relative(root, value);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return value;
	throw new Error(`${name} escaped config root: ${value}`);
};

capture("configHome", dirs.getConfigHomeDir());
capture("configHomeHostileArg", dirs.getConfigHomeDir(hostile));
capture("configRoot", dirs.getConfigRootDir());
capture("profileRootDefault", dirs.getProfileRootDir(undefined));
capture("profileRootNamed", dirs.getProfileRootDir("fixture"));
capture("agentDir", dirs.getAgentDir());
capture("reports", dirs.getReportsDir());
capture("logs", dirs.getLogsDir());
capture("logPath", dirs.getLogPath(new Date("2026-01-02T00:00:00.000Z")));
capture("plugins", dirs.getPluginsDir());
capture("pluginsHostileHome", dirs.getPluginsDir(hostile));
capture("pluginsNodeModules", dirs.getPluginsNodeModules(hostile));
capture("pluginsPackageJson", dirs.getPluginsPackageJson(hostile));
capture("pluginsLockfile", dirs.getPluginsLockfile(hostile));
capture("remote", dirs.getRemoteDir());
capture("worktrees", dirs.getWorktreesDir());
capture("worktree", dirs.getWorktreeDir("safe-segment"));
capture("sshControl", dirs.getSshControlDir());
capture("remoteHost", dirs.getRemoteHostDir());
capture("pythonEnv", dirs.getPythonEnvDir());
capture("pythonGateway", dirs.getPythonGatewayDir());
capture("puppeteer", dirs.getPuppeteerDir());
capture("docsRs", dirs.getDocsRsCacheDir());
capture("autoQa", dirs.getAutoQaDbDir());
capture("gpuCache", dirs.getGpuCachePath());
capture("githubCache", dirs.getGithubCacheDbPath());
capture("authBrokerCache", dirs.getAuthBrokerSnapshotCachePath());
capture("fastembed", dirs.getFastembedCacheDir());
capture("fastembedRuntime", dirs.getFastembedRuntimeDir());
capture("natives", dirs.getNativesDir());
capture("stats", dirs.getStatsDbPath());
capture("autoresearch", dirs.getAutoresearchDir());
capture("autoresearchProject", dirs.getAutoresearchProjectDir("safe-project"));
capture("autoresearchDb", dirs.getAutoresearchDbPath("safe-project"));
capture("autoresearchRun", dirs.getAutoresearchRunDir("safe-project", 7));

const captureAgentPaths = (suffix: string, agentDir?: string): void => {
	capture(`agentDb${suffix}`, dirs.getAgentDbPath(agentDir));
	capture(`lastChangelog${suffix}`, dirs.getLastChangelogVersionPath(agentDir));
	capture(`historyDb${suffix}`, dirs.getHistoryDbPath(agentDir));
	capture(`modelDb${suffix}`, dirs.getModelDbPath(agentDir));
	capture(`tinyModels${suffix}`, dirs.getTinyModelsCacheDir(agentDir));
	capture(`sessions${suffix}`, dirs.getSessionsDir(agentDir));
	capture(`blobs${suffix}`, dirs.getBlobsDir(agentDir));
	capture(`themes${suffix}`, dirs.getCustomThemesDir(agentDir));
	capture(`tools${suffix}`, dirs.getToolsDir(agentDir));
	capture(`commands${suffix}`, dirs.getCommandsDir(agentDir));
	capture(`prompts${suffix}`, dirs.getPromptsDir(agentDir));
	capture(`modules${suffix}`, dirs.getAgentModulesDir(agentDir));
	capture(`memories${suffix}`, dirs.getMemoriesDir(agentDir));
	capture(`terminalSessions${suffix}`, dirs.getTerminalSessionsDir(agentDir));
	capture(`crashLog${suffix}`, dirs.getCrashLogPath(agentDir));
	capture(`debugLog${suffix}`, dirs.getDebugLogPath(agentDir));
};

captureAgentPaths("Default");
captureAgentPaths("HostileArg", hostile);
capture("mcpUser", dirs.getMCPConfigPath("user", hostile));
capture("sshUser", dirs.getSSHConfigPath("user", hostile));

process.env.OMP_CONFIG_ROOT = hostile;
process.env.XDG_DATA_HOME = hostile;
process.env.XDG_STATE_HOME = hostile;
process.env.XDG_CACHE_HOME = hostile;
process.env.PI_CODING_AGENT_DIR = hostile;
dirs.refreshDirsFromEnv();
capture("rootAfterEnvMutation", dirs.getConfigRootDir());
capture("agentAfterEnvMutation", dirs.getAgentDir());
capture("statsAfterEnvMutation", dirs.getStatsDbPath());

dirs.setProfile("work");
capture("profileActiveRoot", dirs.getConfigRootDir());
capture("profileActiveAgent", dirs.getAgentDir());
capture("profileActiveSession", dirs.getSessionsDir(hostile));
dirs.setProfile(undefined);
capture("profileResetRoot", dirs.getConfigRootDir());
capture("profileResetAgent", dirs.getAgentDir());

dirs.setAgentDir(hostile);
capture("setAgentDirRoot", dirs.getConfigRootDir());
capture("setAgentDirAgent", dirs.getAgentDir());
captureAgentPaths("AfterSetAgent", hostile);

const installId = dirs.getInstallId();
const installIdPath = capture("installIdPath", path.join(root, "install-id"));
if (!/^[0-9a-f-]{36}$/i.test(installId)) throw new Error(`Invalid install id: ${installId}`);
if (fs.readFileSync(installIdPath, "utf8").trim() !== installId)
	throw new Error("Install id was not persisted at root");

// Project-scoped helpers are intentionally excluded: OMP_CONFIG_ROOT governs
// user-global state, while getProject* and project MCP/SSH paths must remain cwd-scoped.
process.stdout.write(JSON.stringify({ root, paths, installId }));
