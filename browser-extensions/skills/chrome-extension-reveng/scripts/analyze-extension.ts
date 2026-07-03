import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Manifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  background?: {
    service_worker?: string;
    scripts?: string[];
    page?: string;
  };
  action?: {
    default_popup?: string;
  };
  browser_action?: {
    default_popup?: string;
  };
  page_action?: {
    default_popup?: string;
  };
  options_page?: string;
  options_ui?: {
    page?: string;
  };
  devtools_page?: string;
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    css?: string[];
    run_at?: string;
  }>;
  web_accessible_resources?: Array<
    | string
    | {
        resources?: string[];
        matches?: string[];
      }
  >;
};

const targetArg = process.argv[2] ?? "reveng/vidiq-vision";

function findWorkspaceRoot(start: string) {
  let current = start;
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const root = path.isAbsolute(targetArg)
  ? targetArg
  : path.resolve(workspaceRoot, targetArg);
const manifestPath = path.join(root, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error(`No manifest.json found at ${manifestPath}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

const entrypoints = new Set<string>();

function add(file: string | undefined) {
  if (file) entrypoints.add(file);
}

add(manifest.background?.service_worker);
add(manifest.background?.page);
manifest.background?.scripts?.forEach(add);
add(manifest.action?.default_popup);
add(manifest.browser_action?.default_popup);
add(manifest.page_action?.default_popup);
add(manifest.options_page);
add(manifest.options_ui?.page);
add(manifest.devtools_page);

for (const script of manifest.content_scripts ?? []) {
  script.js?.forEach(add);
  script.css?.forEach(add);
}

for (const resource of manifest.web_accessible_resources ?? []) {
  if (typeof resource === "string") {
    add(resource);
  } else {
    resource.resources?.forEach(add);
  }
}

const summary = {
  root,
  name: manifest.name,
  version: manifest.version,
  manifestVersion: manifest.manifest_version,
  description: manifest.description,
  permissions: manifest.permissions ?? [],
  hostPermissions: manifest.host_permissions ?? [],
  contentScriptCount: manifest.content_scripts?.length ?? 0,
  entrypoints: [...entrypoints].sort(),
};

console.log(JSON.stringify(summary, null, 2));
