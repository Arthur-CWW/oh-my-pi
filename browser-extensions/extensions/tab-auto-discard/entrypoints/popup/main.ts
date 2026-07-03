import type { AutoDiscardSettings, AutoDiscardState, DiscardNowResponse } from "../../utils/settings";

const form = document.getElementById("settings-form") as HTMLFormElement;
const enabledInput = document.getElementById("enabled") as HTMLInputElement;
const idleMinutesInput = document.getElementById("idle-minutes") as HTMLInputElement;
const scopeInput = document.getElementById("scope") as HTMLSelectElement;
const includePatternsInput = document.getElementById("include-patterns") as HTMLTextAreaElement;
const includePatternsGroup = document.getElementById("include-patterns-group") as HTMLLabelElement;
const excludePatternsInput = document.getElementById("exclude-patterns") as HTMLTextAreaElement;
const skipPinnedInput = document.getElementById("skip-pinned") as HTMLInputElement;
const skipAudibleInput = document.getElementById("skip-audible") as HTMLInputElement;
const statusText = document.getElementById("status") as HTMLParagraphElement;
const discardNowButton = document.getElementById("discard-now") as HTMLButtonElement;

type StatusKind = "working" | "success" | "error";

function setStatus(message: string, kind: StatusKind): void {
  statusText.textContent = message;
  statusText.className = `status status--${kind}`;
}

function linesToPatterns(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function patternsToLines(patterns: string[]): string {
  return patterns.join("\n");
}

function setFormDisabled(disabled: boolean): void {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.disabled = disabled;
    }
  }
  discardNowButton.disabled = disabled;
}

function renderState(state: AutoDiscardState): void {
  enabledInput.checked = state.settings.enabled;
  idleMinutesInput.value = String(state.settings.idleMinutes);
  scopeInput.value = state.settings.scope;
  includePatternsInput.value = patternsToLines(state.settings.includePatterns);
  excludePatternsInput.value = patternsToLines(state.settings.excludePatterns);
  skipPinnedInput.checked = state.settings.skipPinned;
  skipAudibleInput.checked = state.settings.skipAudible;
  includePatternsGroup.classList.toggle("is-disabled", state.settings.scope !== "match-patterns");

  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleTimeString() : "not run yet";
  const suffix = state.lastError ? ` Last error: ${state.lastError}` : "";
  setStatus(`Last run: ${lastRun}; discarded ${state.lastDiscardCount} tab(s).${suffix}`, state.lastError ? "error" : "success");
}

function readSettingsFromForm(): AutoDiscardSettings {
  return {
    enabled: enabledInput.checked,
    idleMinutes: Number(idleMinutesInput.value),
    scope: scopeInput.value as AutoDiscardSettings["scope"],
    includePatterns: linesToPatterns(includePatternsInput.value),
    excludePatterns: linesToPatterns(excludePatternsInput.value),
    skipPinned: skipPinnedInput.checked,
    skipAudible: skipAudibleInput.checked,
  };
}

function requestState(): void {
  setFormDisabled(true);
  setStatus("Loading settings…", "working");
  chrome.runtime.sendMessage({ type: "getState" }, (response: AutoDiscardState | undefined) => {
    setFormDisabled(false);
    if (!response) {
      setStatus("Could not load settings.", "error");
      return;
    }
    renderState(response);
  });
}

function saveSettings(): void {
  setFormDisabled(true);
  setStatus("Saving settings…", "working");
  chrome.runtime.sendMessage({ type: "setSettings", settings: readSettingsFromForm() }, (response: AutoDiscardState | undefined) => {
    setFormDisabled(false);
    if (!response) {
      setStatus("Could not save settings.", "error");
      return;
    }
    renderState(response);
  });
}

let saveTimer: number | null = null;
function scheduleSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveSettings();
  }, 250);
}

form.addEventListener("input", () => {
  includePatternsGroup.classList.toggle("is-disabled", scopeInput.value !== "match-patterns");
  scheduleSave();
});

form.addEventListener("change", () => {
  includePatternsGroup.classList.toggle("is-disabled", scopeInput.value !== "match-patterns");
  scheduleSave();
});

discardNowButton.addEventListener("click", () => {
  setFormDisabled(true);
  setStatus("Discarding matching inactive tabs…", "working");
  chrome.runtime.sendMessage({ type: "discardNow" }, (response: DiscardNowResponse | undefined) => {
    setFormDisabled(false);
    if (!response) {
      setStatus("Discard request failed.", "error");
      return;
    }
    renderState(response);
    setStatus(`Discarded ${response.discardedCount} matching inactive tab(s).`, response.lastError ? "error" : "success");
  });
});

requestState();
