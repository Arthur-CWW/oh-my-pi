/** Browser-specific settings definitions. */
export const BROWSER_SETTINGS_SCHEMA = {
	"browser.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "tools",
			group: "Available Tools",
			label: "Browser",
			description: "Enable the browser tool for scripted Chromium automation (puppeteer)",
		},
	},

	"browser.headless": {
		type: "boolean",
		default: true,
		ui: {
			tab: "tools",
			group: "Search & Browser",
			label: "Headless Browser",
			description: "Launch browser in headless mode (disable to show browser UI)",
		},
	},

	"browser.cmux": {
		type: "boolean",
		default: true,
		ui: {
			tab: "tools",
			group: "Search & Browser",
			label: "cmux Browser",
			description:
				"Use cmux WKWebView surfaces for browser automation when a cmux socket is available. Set PI_BROWSER_CMUX=0 or PI_BROWSER_CMUX=1 to override.",
		},
	},
	/**
	 * Tab budgets apply only to OMP-owned headless browser tabs. External backends
	 * (cmux, spawned apps, and connected CDP) are never counted, refused, or
	 * reclaimed. Per-session reclaim is process-local; a persisted lease held by
	 * another process produces a typed refusal with top-consumer attribution.
	 */
	"browser.maxTabsPerSession": {
		type: "number",
		default: 4,
		min: 1,
		integer: true,
	},
	"browser.maxGlobalTabs": {
		type: "number",
		default: 12,
		min: 1,
		integer: true,
	},
	"browser.maxOwnedPerSession": {
		type: "number",
		default: 2,
		min: 1,
		integer: true,
	},
	"browser.maxOwnedGlobal": {
		type: "number",
		default: 6,
		min: 1,
		integer: true,
	},
	"browser.tabIdleTtlMs": {
		type: "number",
		default: 600_000,
		min: 0,
		integer: true,
	},
	"browser.tabUrlQuerySensitive": {
		type: "boolean",
		default: false,
	},
	"browser.screenshotDir": {
		type: "string",
		default: undefined,
		ui: {
			tab: "tools",
			group: "Search & Browser",
			label: "Screenshot Directory",
			description:
				"Directory to save screenshots. If unset, screenshots go to a temp file. Supports ~. Examples: ~/Downloads, ~/Desktop, /sdcard/Download (Android)",
		},
	},
} as const;
