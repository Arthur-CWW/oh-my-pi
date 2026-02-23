#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

interface AdvancedProbeRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	postData: string | null;
}

interface AdvancedProbeResponse {
	url: string;
	status: number;
	headers: Record<string, string>;
}

interface AccessibilitySummary {
	nonEmptyNameCount: number;
	sampleNames: string[];
}

interface AdvancedProbeResult {
	runId: string;
	capturedAt: string;
	request: AdvancedProbeRequest | null;
	response: AdvancedProbeResponse | null;
	formValues: Record<string, string>;
	preSubmitFormData: Array<[string, string]>;
	preSubmitDateValues: { from: string; to: string };
	preSubmitDateMeta: {
		from: { disabled: boolean; readOnly: boolean; min: string; max: string };
		to: { disabled: boolean; readOnly: boolean; min: string; max: string };
	};
	finalUrl: string | null;
	a11y: AccessibilitySummary | null;
}

interface A11yNode {
	name?: string;
	children?: A11yNode[];
}

const outputPath = resolve(process.argv[2] ?? "packages/kagi/output/network/capture-advanced-submit-filled.json");
const browserUrl = process.argv[3] ?? "http://localhost:9222";

const result: AdvancedProbeResult = {
	runId: `advanced-filled-${Date.now()}`,
	capturedAt: new Date().toISOString(),
	request: null,
	response: null,
	formValues: {
		all_words: "alpha beta",
		exact_words: "exact phrase",
		any_words: "gamma delta",
		none_words: "epsilon",
		region: "be_fr",
		last_update: "4",
		from_date: "2024-01-01",
		to_date: "2026-01-31",
		site: "example.com",
		terms_appearing: "url",
		file_type: "open_spreadsheet",
	},
	preSubmitFormData: [],
	preSubmitDateValues: { from: "", to: "" },
	preSubmitDateMeta: {
		from: { disabled: false, readOnly: false, min: "", max: "" },
		to: { disabled: false, readOnly: false, min: "", max: "" },
	},
	finalUrl: null,
	a11y: null,
};

const browser = await puppeteer.connect({ browserURL: browserUrl, defaultViewport: null });

try {
	const page = await browser.newPage();

	page.on("request", (request) => {
		if (request.method() !== "POST") {
			return;
		}
		if (!request.url().includes("/search/advanced")) {
			return;
		}

		const headers = redactHeaders(request.headers());
		result.request = {
			method: request.method(),
			url: request.url(),
			headers,
			postData: request.postData(),
		};
	});

	page.on("response", (response) => {
		if (!response.url().includes("/search/advanced")) {
			return;
		}
		result.response = {
			url: response.url(),
			status: response.status(),
			headers: redactHeaders(response.headers()),
		};
	});

	await page.goto("https://kagi.com/search?q=advanced+search+probe", {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	await page.click("#menu-advanced-search-toggle");
	await page.waitForSelector("#menu-advanced-search form", { timeout: 20_000 });

	await setInputValue(page, "input[name=\"all_words\"]", result.formValues.all_words);
	await setInputValue(page, "input[name=\"exact_words\"]", result.formValues.exact_words);
	await setInputValue(page, "input[name=\"any_words\"]", result.formValues.any_words);
	await setInputValue(page, "input[name=\"none_words\"]", result.formValues.none_words);
	await setInputValue(page, "input[name=\"site\"]", result.formValues.site);

	await setRadioValue(page, "region", "be_fr");
	await setRadioValue(page, "last_update", "4");
	await typeInputValue(page, "input[name=\"from_date\"]", result.formValues.from_date);
	await typeInputValue(page, "input[name=\"to_date\"]", result.formValues.to_date);
	await setRadioValue(page, "terms_appearing", "url");
	await setRadioValue(page, "file_type", "open_spreadsheet");

	const modalHandle = await page.$("#menu-advanced-search");
	const modalA11y = modalHandle
		? ((await page.accessibility.snapshot({ root: modalHandle, interestingOnly: false })) as A11yNode | null)
		: null;
	result.a11y = summarizeA11y(modalA11y);

	const preSubmit = await page.$eval("#menu-advanced-search form", (formElement) => {
		const form = formElement as HTMLFormElement;
		const formData: Array<[string, string]> = Array.from(new FormData(form).entries()).map(
			([key, value]) => [key, typeof value === "string" ? value : "[file]"] as [string, string],
		);
		const fromDateInput = form.querySelector('input[name="from_date"]') as HTMLInputElement | null;
		const toDateInput = form.querySelector('input[name="to_date"]') as HTMLInputElement | null;
		return {
			formData,
			fromDateValue: fromDateInput?.value ?? "",
			toDateValue: toDateInput?.value ?? "",
			fromDateMeta: {
				disabled: fromDateInput?.disabled ?? false,
				readOnly: fromDateInput?.readOnly ?? false,
				min: fromDateInput?.min ?? "",
				max: fromDateInput?.max ?? "",
			},
			toDateMeta: {
				disabled: toDateInput?.disabled ?? false,
				readOnly: toDateInput?.readOnly ?? false,
				min: toDateInput?.min ?? "",
				max: toDateInput?.max ?? "",
			},
		};
	});
	result.preSubmitFormData = preSubmit.formData;
	result.preSubmitDateValues = { from: preSubmit.fromDateValue, to: preSubmit.toDateValue };
	result.preSubmitDateMeta = { from: preSubmit.fromDateMeta, to: preSubmit.toDateMeta };

	await Promise.all([
		page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
		page.$eval("#menu-advanced-search form", (formElement) => {
			const form = formElement as HTMLFormElement;
			form.requestSubmit();
		}),
	]);

	result.finalUrl = page.url();

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

	console.log(
		JSON.stringify(
			{
				saved: outputPath,
				finalUrl: result.finalUrl,
				hasRequest: result.request !== null,
				hasResponse: result.response !== null,
				requestPostData: result.request?.postData ?? null,
				preSubmitDateValues: result.preSubmitDateValues,
				a11yNonEmptyNameCount: result.a11y?.nonEmptyNameCount ?? 0,
			},
			null,
			2,
		),
	);

	await page.close();
} finally {
	await browser.disconnect();
}

async function setInputValue(page: puppeteer.Page, selector: string, value: string): Promise<void> {
	await page.$eval(
		selector,
		(inputElement, inputValue) => {
			const input = inputElement as HTMLInputElement;
			input.value = inputValue;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
		value,
	);
}

async function setRadioValue(page: puppeteer.Page, name: string, value: string): Promise<void> {
	await page.$eval(
		`input[type=\"radio\"][name=\"${name}\"][value=\"${value}\"]`,
		(radioElement) => {
			const radio = radioElement as HTMLInputElement;
			radio.checked = true;
			radio.dispatchEvent(new Event("input", { bubbles: true }));
			radio.dispatchEvent(new Event("change", { bubbles: true }));
		},
	);
}

async function typeInputValue(page: puppeteer.Page, selector: string, value: string): Promise<void> {
	await page.focus(selector);
	await page.keyboard.down("Meta");
	await page.keyboard.press("KeyA");
	await page.keyboard.up("Meta");
	await page.keyboard.press("Backspace");
	await page.keyboard.type(value);
	await page.$eval(selector, (inputElement) => {
		const input = inputElement as HTMLInputElement;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

function summarizeA11y(root: A11yNode | null): AccessibilitySummary {
	if (!root) {
		return { nonEmptyNameCount: 0, sampleNames: [] };
	}
	const names: string[] = [];
	collectA11yNames(root, names);
	const unique = [...new Set(names.filter((name) => name.trim().length > 0))];
	return {
		nonEmptyNameCount: names.length,
		sampleNames: unique.slice(0, 100),
	};
}

function collectA11yNames(node: A11yNode, output: string[]): void {
	if (typeof node.name === "string" && node.name.trim().length > 0) {
		output.push(node.name.trim());
	}
	for (const child of node.children ?? []) {
		collectA11yNames(child, output);
	}
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const clone: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "cookie") {
			clone[key] = "<redacted-cookie-header>";
			continue;
		}
		if (key.toLowerCase() === "x-kagi-authorization") {
			clone[key] = "<redacted-session-token>";
			continue;
		}
		clone[key] = value;
	}
	return clone;
}
