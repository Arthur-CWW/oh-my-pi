#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, "..");
const extensionDir = path.join(workspaceDir, "extensions", "twitter-archive-firefox");
const defaultStartUrl = "https://x.com/i/bookmarks";
const defaultDedicatedProfile = path.join(os.homedir(), ".twitter-archive-firefox");
const sourceDirCandidates = [
  "dist/firefox",
  "dist",
  ".output/firefox-mv2",
  ".output/firefox",
  ".output",
  ".",
];

function printHelp() {
  console.log(`Run the Twitter archive Firefox WebExtension with web-ext temporary install.

Usage:
  bun browser-extensions/scripts/run-twitter-archive-firefox.mjs [options]

Options:
  --profile <path>      Firefox profile directory to reuse. Opt-in for your normal profile.
  --source-dir <path>   Built extension directory containing manifest.json.
  --firefox-bin <path>  Firefox executable to launch.
  --start-url <url>     Initial tab URL. Defaults to ${defaultStartUrl}.
  --skip-build          Reuse the current build output.
  --help                Show this help.

Environment:
  FIREFOX_PROFILE       Same as --profile.
  FIREFOX_BIN           Same as --firefox-bin.
  TWITTER_ARCHIVE_FIREFOX_SOURCE_DIR
                        Same as --source-dir.
  TWITTER_ARCHIVE_FIREFOX_START_URL
                        Same as --start-url.

  TWITTER_ARCHIVE_FIREFOX_PROFILE
                        Dedicated profile path. Defaults to ~/.twitter-archive-firefox.

Notes:
  - This runner uses web-ext temporary install with --keep-profile-changes.
  - By default it points web-ext at the dedicated ~/.twitter-archive-firefox profile
    and asks web-ext to create that profile directory if missing.
  - Use --profile to opt into an existing signed-in Firefox profile instead.
  - The dedicated web-ext profile is not safe for daily browsing use.
  - Permanent unsigned install is not guaranteed on release Firefox builds.
`);
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function takeOption(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    profile: process.env.FIREFOX_PROFILE ?? "",
    sourceDir: process.env.TWITTER_ARCHIVE_FIREFOX_SOURCE_DIR ?? "",
    firefoxBin: process.env.FIREFOX_BIN ?? "",
    startUrl: process.env.TWITTER_ARCHIVE_FIREFOX_START_URL ?? defaultStartUrl,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--profile") {
      options.profile = takeOption(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--source-dir") {
      options.sourceDir = takeOption(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--firefox-bin") {
      options.firefoxBin = takeOption(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--start-url") {
      options.startUrl = takeOption(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveSourceDir(configuredSourceDir) {
  const candidates = [];

  if (configuredSourceDir) {
    const expandedSourceDir = expandHome(configuredSourceDir);
    candidates.push(
      path.isAbsolute(expandedSourceDir)
        ? expandedSourceDir
        : path.resolve(extensionDir, expandedSourceDir),
    );
  }

  for (const candidate of sourceDirCandidates) {
    candidates.push(path.join(extensionDir, candidate));
  }

  for (const candidate of candidates) {
    const manifestPath = path.join(candidate, "manifest.json");
    if (existsSync(manifestPath)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a Firefox-loadable build artifact. Expected manifest.json under one of:\n${candidates.join("\n")}`,
  );
}

function resolveProfile(configuredProfile) {
  if (configuredProfile) {
    const resolvedProfile = expandHome(configuredProfile);
    if (!existsSync(resolvedProfile)) {
      throw new Error(`Firefox profile does not exist: ${resolvedProfile}`);
    }
    return {
      path: resolvedProfile,
      createIfMissing: false,
    };
  }

  const configuredDedicatedProfile = process.env.TWITTER_ARCHIVE_FIREFOX_PROFILE;
  const dedicatedProfile = expandHome(
    configuredDedicatedProfile ?? defaultDedicatedProfile,
  );

  return {
    path: dedicatedProfile,
    createIfMissing: true,
  };
}

function resolveWebExtCommand() {
  const candidates = [
    path.join(extensionDir, "node_modules", ".bin", "web-ext"),
    path.join(workspaceDir, "node_modules", ".bin", "web-ext"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: candidate, prefixArgs: [] };
    }
  }

  return { command: "bunx", prefixArgs: ["web-ext"] };
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!existsSync(extensionDir)) {
  throw new Error(`Expected extension directory at ${extensionDir}`);
}

if (!existsSync(path.join(extensionDir, "package.json"))) {
  throw new Error(`Expected package.json in ${extensionDir}`);
}

if (!options.skipBuild) {
  run("bun", ["run", "build"], extensionDir);
}

const sourceDir = resolveSourceDir(options.sourceDir);
const firefoxProfile = resolveProfile(options.profile);
const webExt = resolveWebExtCommand();
const webExtArgs = [
  ...webExt.prefixArgs,
  "run",
  "--source-dir",
  sourceDir,
  "--keep-profile-changes",
  "--start-url",
  options.startUrl,
];

if (firefoxProfile.path) {
  webExtArgs.push("--firefox-profile", firefoxProfile.path);
  if (firefoxProfile.createIfMissing) {
    webExtArgs.push("--profile-create-if-missing");
  }
}

if (options.firefoxBin) {
  webExtArgs.push("--firefox", expandHome(options.firefoxBin));
}

run(webExt.command, webExtArgs, extensionDir);
