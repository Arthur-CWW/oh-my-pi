import { getAgentDir, getConfigHomeDir } from "@oh-my-pi/pi-utils";
import { getConfigDirPaths } from "../../../src/config";
import { loadCapability, type SlashCommand } from "../../../src/discovery";
import { getUserPath, injectPluginDirRoots, listClaudePluginRoots } from "../../../src/discovery/helpers";
import { loadSkills } from "../../../src/extensibility/skills";

const cwd = process.env.OMP_TEST_PROJECT_DIR;
const hostileHome = process.env.OMP_TEST_HOSTILE_HOME;
const explicitPluginDir = process.env.OMP_TEST_EXPLICIT_PLUGIN_DIR;
if (!cwd) throw new Error("OMP_TEST_PROJECT_DIR is required");
if (!hostileHome) throw new Error("OMP_TEST_HOSTILE_HOME is required");
if (!explicitPluginDir) throw new Error("OMP_TEST_EXPLICIT_PLUGIN_DIR is required");

const [commands, skills] = await Promise.all([
	loadCapability<SlashCommand>("slash-commands", { cwd, providers: ["native", "claude"] }),
	loadSkills({
		cwd,
		customDirectories: ["~/custom-skills"],
		enableCodexUser: false,
		enableClaudeUser: true,
		enableClaudeProject: false,
		enablePiUser: true,
		enablePiProject: false,
		enableAgentsUser: false,
		enableAgentsProject: false,
	}),
]);
await injectPluginDirRoots(hostileHome, [explicitPluginDir], cwd);
const plugins = await listClaudePluginRoots(hostileHome, cwd);
const userPath = getUserPath({ cwd, home: hostileHome, repoRoot: null }, "claude", "commands");

process.stdout.write(
	JSON.stringify({
		configHomeDir: getConfigHomeDir(),
		configHomeFromHostileArg: getConfigHomeDir(hostileHome),
		agentDir: getAgentDir(),
		configDirOutput: getConfigDirPaths("commands", { project: false }),
		userPath,
		commands: commands.items
			.filter(command => command.level === "user")
			.map(command => ({ name: command.name, path: command.path })),
		skills: skills.skills
			.filter(skill => skill._source?.level === "user")
			.map(skill => ({ name: skill.name, path: skill.filePath })),
		plugins: plugins.roots.map(plugin => ({ id: plugin.id, path: plugin.path })),
		pluginWarnings: plugins.warnings,
	}),
);
