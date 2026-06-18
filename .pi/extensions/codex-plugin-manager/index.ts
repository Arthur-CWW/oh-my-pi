import type { Component, Theme } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VENDOR_ROOT = process.env.PI_CODEX_PLUGIN_VENDOR_ROOT ?? "/Users/arthur/agents/web-access/vendor/openai";
const CATALOG_PATH = join(VENDOR_ROOT, "codex-plugin-catalog.json");
const ROUTER_SKILLS_ROOT = join(VENDOR_ROOT, "codex-plugin-router-skills");
const DIRECT_SKILLS_ROOT = join(VENDOR_ROOT, "codex-pi-skills");
const CONFIG_PATH = process.env.PI_CODEX_PLUGIN_CONFIG ?? join(process.env.HOME ?? ".", ".pi/agent/codex-plugin-manager.json");

type PluginMode = "router" | "skills";

interface CatalogFile {
  version: number;
  plugins: PluginCatalogEntry[];
}

interface PluginCatalogEntry {
  id: string;
  displayName: string;
  category: string;
  description: string;
  defaultMode: PluginMode;
}

interface EnabledPluginConfig {
  mode: PluginMode;
}

interface ManagerConfig {
  version: number;
  vendorRoot: string;
  enabled: Record<string, EnabledPluginConfig>;
}

interface SelectionResult {
  enabled: Record<string, EnabledPluginConfig>;
}

function readCatalog(): PluginCatalogEntry[] {
  if (!existsSync(CATALOG_PATH)) return [];
  const parsed = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as CatalogFile;
  return parsed.plugins;
}

function defaultConfig(catalog: PluginCatalogEntry[]): ManagerConfig {
  const enabled: Record<string, EnabledPluginConfig> = {};
  for (const plugin of catalog) {
    if (plugin.id === "build-macos-apps" || plugin.id === "build-ios-apps") {
      enabled[plugin.id] = { mode: "router" };
    }
  }
  return { version: 1, vendorRoot: VENDOR_ROOT, enabled };
}

function readConfig(catalog: PluginCatalogEntry[]): ManagerConfig {
  if (!existsSync(CONFIG_PATH)) {
    const cfg = defaultConfig(catalog);
    writeConfig(cfg);
    return cfg;
  }
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ManagerConfig;
  return {
    version: 1,
    vendorRoot: parsed.vendorRoot ?? VENDOR_ROOT,
    enabled: parsed.enabled ?? {},
  };
}

function writeConfig(config: ManagerConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function skillPathsFor(catalog: PluginCatalogEntry[], config: ManagerConfig): string[] {
  const ids = new Set(catalog.map((plugin) => plugin.id));
  const paths: string[] = [];
  for (const [id, entry] of Object.entries(config.enabled)) {
    if (!ids.has(id)) continue;
    const root = entry.mode === "skills" ? join(DIRECT_SKILLS_ROOT, id) : join(ROUTER_SKILLS_ROOT, id);
    if (existsSync(root)) paths.push(root);
  }
  return paths;
}

class PluginManagerComponent implements Component {
  private selected = 0;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly catalog: PluginCatalogEntry[],
    private readonly enabled: Record<string, EnabledPluginConfig>,
    private readonly done: (result: SelectionResult | null) => void,
    private readonly theme: Theme,
  ) {}

  handleInput(data: string): void {
    if ((matchesKey(data, Key.up) || data === "k") && this.selected > 0) {
      this.selected -= 1;
      this.invalidate();
      return;
    }
    if ((matchesKey(data, Key.down) || data === "j") && this.selected < this.catalog.length - 1) {
      this.selected += 1;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.space)) {
      const plugin = this.catalog[this.selected];
      if (!plugin) return;
      if (this.enabled[plugin.id]) {
        delete this.enabled[plugin.id];
      } else {
        this.enabled[plugin.id] = { mode: plugin.defaultMode };
      }
      this.invalidate();
      return;
    }
    if (data === "m" || data === "a") {
      const plugin = this.catalog[this.selected];
      if (!plugin || !this.enabled[plugin.id]) return;
      this.enabled[plugin.id].mode = this.enabled[plugin.id].mode === "router" ? "skills" : "router";
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.done({ enabled: this.enabled });
      return;
    }
    if (matchesKey(data, Key.escape) || data === "q") {
      this.done(null);
    }
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
    const lines: string[] = [];
    const title = this.theme.fg("accent", "Codex plugin manager");
    lines.push(truncateToWidth(title, width));
    lines.push(truncateToWidth("j/k or arrows move · space enable/disable · m mode(router/skills) · enter save+reload · q cancel", width));
    lines.push(truncateToWidth(`Config: ${CONFIG_PATH}`, width));
    lines.push("");

    const maxRows = Math.max(5, Math.min(14, this.catalog.length));
    const start = Math.max(0, Math.min(this.selected - Math.floor(maxRows / 2), this.catalog.length - maxRows));
    const visible = this.catalog.slice(start, start + maxRows);

    for (let offset = 0; offset < visible.length; offset += 1) {
      const index = start + offset;
      const plugin = visible[offset];
      if (!plugin) continue;
      const selected = index === this.selected;
      const entry = this.enabled[plugin.id];
      const mark = entry ? "●" : "○";
      const mode = entry ? entry.mode : "off";
      const prefix = selected ? "›" : " ";
      let row = `${prefix} ${mark} ${plugin.displayName} [${mode}] — ${plugin.description}`;
      if (selected) row = this.theme.bg("selectedBg", row);
      lines.push(truncateToWidth(row, width));
    }
    lines.push("");
    lines.push(truncateToWidth("Mode: router = one plugin-level nested skill; skills = all direct subskills for that plugin.", width));
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function registerCodexPluginManager(pi: ExtensionAPI) {
  pi.on("resources_discover", async () => {
    const catalog = readCatalog();
    const config = readConfig(catalog);
    return { skillPaths: skillPathsFor(catalog, config) };
  });

  pi.registerCommand("codex-plugins", {
    description: "Enable or disable vendored OpenAI Codex plugin skills for Pi",
    handler: async (_args, ctx) => {
      const catalog = readCatalog();
      if (catalog.length === 0) {
        ctx.ui.notify(`No Codex plugin catalog found at ${CATALOG_PATH}`, "error");
        return;
      }
      const config = readConfig(catalog);
      const enabledCopy: Record<string, EnabledPluginConfig> = JSON.parse(JSON.stringify(config.enabled)) as Record<string, EnabledPluginConfig>;
      const result = await ctx.ui.custom<SelectionResult | null>(
        (_tui, theme, _keybindings, done) => new PluginManagerComponent(catalog, enabledCopy, done, theme),
        {
          overlay: true,
          overlayOptions: { width: "90%", maxHeight: "80%", minWidth: 70, anchor: "center" },
        },
      );
      if (!result) {
        ctx.ui.notify("Codex plugin selection cancelled", "info");
        return;
      }
      writeConfig({ version: 1, vendorRoot: VENDOR_ROOT, enabled: result.enabled });
      ctx.ui.notify(`Saved ${CONFIG_PATH}; reloading Pi resources`, "success");
      await ctx.reload();
    },
  });

  pi.registerCommand("codex-plugins-config", {
    description: "Show the Codex plugin manager config file path",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Codex plugin config: ${CONFIG_PATH}`, "info");
    },
  });
}
