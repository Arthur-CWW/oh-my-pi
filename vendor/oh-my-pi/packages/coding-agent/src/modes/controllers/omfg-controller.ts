import * as path from "node:path";
import { Effect, Scope } from "effect";
import { CONFIG_DIR_NAME, prompt } from "@oh-my-pi/pi-utils";
import type { Rule } from "../../capability/rule";
import omfgUserPrompt from "../../prompts/system/omfg-user.md" with { type: "text" };
import { shortenPath } from "../../tools/render-utils";
import {
	makeOmfgPanelModel,
	OmfgPanelComponent,
	type OmfgPanelCommand,
	type OmfgPanelModel,
	type OmfgPanelMsg,
	type OmfgPanelState,
	updateOmfgPanel,
} from "../components/omfg-panel";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import { mountMvuChild, type MvuRouteHandle } from "../mvu/route-host";
import { mountMvuRuntime, type MvuRuntime, type MvuRuntimeConfig } from "../mvu/runtime";
import { makeComponentId, type ActiveKeymapContext, type KeyEvent, type Transition } from "../mvu/schema";
import type { InteractiveModeContext } from "../types";
import {
	buildOmfgRuleForPath,
	extractGeneratedRuleJson,
	type OmfgRuleSourceLevel,
	type ParsedGeneratedRule,
	parseGeneratedRule,
	validateParsedRuleAgainstAssistantHistory,
} from "./omfg-rule";

const OMFG_COMPONENT_ID = makeComponentId("omfg.panel");

type OmfgRuntimeMessage = MvuEnvelope;

interface OmfgRequest {
	component: OmfgPanelComponent;
	abortController: AbortController;
	complaint: string;
	runtime?: MvuRuntime<OmfgPanelModel, OmfgRuntimeMessage>;
	route?: MvuRouteHandle;
	pendingMessages: OmfgRuntimeMessage[];
	dispatchTail: Promise<void>;
	mountPromise?: Promise<void>;
}

interface OmfgCandidate extends ParsedGeneratedRule {
	validated: boolean;
}

interface GenerateCandidateOptions {
	initialFeedback?: string;
	previousRule?: string;
}

type SaveCandidateResult = { kind: "saved" | "aborted" | "rejected" } | { kind: "amend"; feedback: string };

const MAX_ATTEMPTS = 3;
const PROJECT_OPTION = "This project (.omp/rules)";
const GLOBAL_OPTION = "Global — all projects (~/.omp/agent/rules)";
const AMEND_OPTION = "Amend with feedback…";

function eventForText(text: string): KeyEvent {
	return { _tag: "Paste", text };
}

function envelope(action: string, text = ""): MvuEnvelope {
	return { _tag: "MvuInput", action: action as MvuEnvelope["action"], event: eventForText(text) };
}

function statusEnvelope(state: OmfgPanelState, status: string): MvuEnvelope {
	return envelope(`omfg.status.${state}`, status);
}

function messageFromEnvelope(value: MvuEnvelope): OmfgPanelMsg {
	const action = String(value.action);
	const text = value.event._tag === "Paste" ? value.event.text : "";
	if (action === "omfg.draft") return { _tag: "DraftDelta", delta: text };
	if (action === "omfg.rule") return { _tag: "Rule", text };
	if (action.startsWith("omfg.status.")) {
		const state = action.slice("omfg.status.".length) as OmfgPanelState;
		return { _tag: "Status", state, status: text };
	}
	if (action === "omfg.saved") return { _tag: "Saved", path: text };
	if (action === "omfg.rejected") return { _tag: "Rejected" };
	if (action === "omfg.aborted") return { _tag: "Aborted" };
	if (action === "omfg.error") return { _tag: "Error", message: text };
	return { _tag: "Input", envelope: value };
}

const routeContext = (_model: OmfgPanelModel): ActiveKeymapContext => ({
	contexts: ["omfg.panel"],
	mode: "Browse",
	focus: "body",
	capabilities: new Set(),
});

export class OmfgController {
	#activeRequest: OmfgRequest | undefined;

	constructor(private readonly ctx: InteractiveModeContext) {}

	hasActiveRequest(): boolean {
		return this.#activeRequest !== undefined;
	}

	handleEscape(): boolean {
		const request = this.#activeRequest;
		if (!request) return false;
		void this.#closeActiveRequest(request, true);
		return true;
	}

	dispose(): void {
		const request = this.#activeRequest;
		if (request) void this.#closeActiveRequest(request, true);
	}

	async start(complaint: string): Promise<void> {
		const trimmedComplaint = complaint.trim();
		if (!trimmedComplaint) {
			this.ctx.showStatus("Usage: /omfg <complaint>");
			return;
		}
		if (!this.ctx.session.model) {
			this.ctx.showError("No active model available for /omfg.");
			return;
		}

		const previous = this.#activeRequest;
		const previousClosed = previous ? this.#closeActiveRequest(previous, true) : Promise.resolve();
		const model = makeOmfgPanelModel(trimmedComplaint);
		const request: OmfgRequest = {
			component: new OmfgPanelComponent(
				{ requestComponentRender: component => this.ctx.ui.requestComponentRender(component) },
				model,
			),
			abortController: new AbortController(),
			complaint: trimmedComplaint,
			pendingMessages: [],
			dispatchTail: Promise.resolve(),
		};
		this.#activeRequest = request;
		this.ctx.omfgContainer.clear();
		this.ctx.omfgContainer.addChild(request.component);
		this.ctx.ui.requestRender();

		request.mountPromise = this.#mountRequest(request, model, previousClosed);
		void this.#runRequest(request);
	}

	async #mountRequest(
		request: OmfgRequest,
		model: OmfgPanelModel,
		previousClosed: Promise<void>,
	): Promise<void> {
		await previousClosed;
		if (!this.#isActiveRequest(request)) return;
		const controller = this;
		try {
			const mounted = await Effect.runPromise(
				Scope.provide(this.ctx.mvuScope)(
					Effect.gen(function* () {
						const parentScope = yield* Effect.service(Scope.Scope);
						const routeScope = yield* Scope.fork(parentScope, "sequential");
						yield* Scope.provide(routeScope)(
							Effect.addFinalizer(() => Effect.sync(() => request.abortController.abort())),
						);
						const route: MvuInputRoute<OmfgPanelModel> = {
							componentId: OMFG_COMPONENT_ID,
							focusedRoot: request.component,
							context: routeContext,
							actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
						};
						const runtimeConfig: MvuRuntimeConfig<OmfgPanelModel, MvuEnvelope, OmfgPanelCommand, never> = {
							componentId: OMFG_COMPONENT_ID,
							initialModel: model,
							update: (current: OmfgPanelModel, value: MvuEnvelope): Transition<OmfgPanelModel, OmfgPanelCommand> =>
								updateOmfgPanel(current, messageFromEnvelope(value)),
							interpret: (command: OmfgPanelCommand) =>
								Effect.sync(() => {
									if (command._tag === "Render") request.component.apply(command.model);
									else if (command._tag === "CancelRequested") void controller.#closeActiveRequest(request, true);
									else void controller.#closeActiveRequest(request, false);
									return [] as readonly MvuEnvelope[];
								}),
							inputCapacity: 256,
							messageCapacity: 256,
							commandCapacity: 256,
						};
						const runtime = yield* Scope.provide(routeScope)(mountMvuRuntime(runtimeConfig));
						const handle = yield* mountMvuChild<OmfgPanelModel, MvuEnvelope, OmfgPanelCommand, never>({
							tui: controller.ctx.ui,
							leaseManager: controller.ctx.mvuInputLeaseManager,
							route,
							component: request.component,
							runtime,
							runtimeScope: routeScope,
						});
						return { runtime, handle };
					}),
				),
			);
			request.runtime = mounted.runtime;
			request.route = mounted.handle;
			if (!this.#isActiveRequest(request)) {
				await Effect.runPromise(mounted.handle.close());
				return;
			}
			const pending = request.pendingMessages;
			request.pendingMessages = [];
			for (const message of pending) this.#send(request, message);
		} catch (error) {
			if (this.#isActiveRequest(request)) {
				void this.#closeActiveRequest(request, true);
				this.ctx.showError(error instanceof Error ? error.message : String(error));
			}
		}
	}
	async #runRequest(request: OmfgRequest): Promise<void> {
		try {
			let candidate = await this.#generateCandidate(request);
			for (;;) {
				if (!this.#isActiveRequest(request)) return;
				if (!candidate) {
					this.#send(request, envelope("omfg.error", "The model did not return a valid TTSR rule."));
					return;
				}

				if (!candidate.validated) {
					this.#setStatus(request, "confirming", "Couldn't confirm a conversation match.");
					const shouldSave = await this.ctx.showHookConfirm(
						"Validation",
						"Couldn't confirm this rule matches the conversation. Save anyway?",
					);
					if (!this.#isActiveRequest(request)) return;
					if (!shouldSave) {
						this.#send(request, envelope("omfg.rejected"));
						return;
					}
				}

				const saveResult = await this.#saveCandidate(request, candidate);
				if (!this.#isActiveRequest(request)) return;
				if (saveResult.kind !== "amend") return;
				candidate = await this.#generateCandidate(request, {
					initialFeedback: `User requested this amendment before saving:\n${saveResult.feedback}`,
					previousRule: candidate.fileContent,
				});
			}
		} catch (error) {
			if (!this.#isActiveRequest(request)) return;
			this.#send(
				request,
				request.abortController.signal.aborted
					? envelope("omfg.aborted")
					: envelope("omfg.error", error instanceof Error ? error.message : String(error)),
			);
		}
	}

	async #generateCandidate(request: OmfgRequest, options: GenerateCandidateOptions = {}): Promise<OmfgCandidate | undefined> {
		const failedAttempts = options.initialFeedback ? [options.initialFeedback] : [];
		let previousRule = options.previousRule;
		let lastCandidate: ParsedGeneratedRule | undefined;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			if (this.#shouldStop(request)) return undefined;
			this.#send(request, envelope("omfg.rule", ""));
			this.#setStatus(request, "generating", `Attempt ${attempt}/${MAX_ATTEMPTS} · generating…`);
			const promptText = prompt.render(omfgUserPrompt, {
				complaint: request.complaint,
				feedback: failedAttempts.length > 0 ? failedAttempts.join("\n\n") : undefined,
				previousRule,
			});
			const { replyText } = await this.ctx.session.runEphemeralTurn({
				promptText,
				dedupeReply: false,
				onTextDelta: delta => this.#send(request, envelope("omfg.draft", delta)),
				signal: request.abortController.signal,
			});
			if (this.#shouldStop(request)) return undefined;

			const parsed = parseGeneratedRule(replyText);
			if ("error" in parsed) {
				const failedRule = extractGeneratedRuleJson(replyText) ?? replyText.trim();
				failedAttempts.push(`Attempt ${attempt} failed: invalid rule (${parsed.error}).\nFailed candidate:\n${failedRule}`);
				previousRule = failedRule;
				this.#setStatus(request, "validating", `Attempt ${attempt}/${MAX_ATTEMPTS} · ${parsed.error}`);
				continue;
			}

			this.#send(request, envelope("omfg.rule", parsed.fileContent));
			this.#setStatus(request, "validating", `Attempt ${attempt}/${MAX_ATTEMPTS} · validating…`);
			const validated = validateParsedRuleAgainstAssistantHistory(parsed, this.ctx.session.messages);
			if (validated.repairedCondition) this.#send(request, envelope("omfg.rule", validated.candidate.fileContent));
			if (validated.validation.matched) return { ...validated.candidate, validated: true };

			lastCandidate = validated.candidate;
			const failure = validated.validation.feedback ?? "The rule condition did not match any earlier assistant output.";
			failedAttempts.push(`Attempt ${attempt} failed validation:\n${failure}\nFailed candidate:\n${validated.candidate.fileContent}`);
			previousRule = validated.candidate.fileContent;
		}
		return lastCandidate ? { ...lastCandidate, validated: false } : undefined;
	}

	async #saveCandidate(request: OmfgRequest, candidate: OmfgCandidate): Promise<SaveCandidateResult> {
		if (this.#shouldStop(request)) return { kind: "aborted" };
		this.#setStatus(request, "saving", "Choose where to save or amend the TTSR rule…");
		const location = await this.ctx.showHookSelector("Save TTSR rule where?", [PROJECT_OPTION, GLOBAL_OPTION, AMEND_OPTION]);
		if (!this.#isActiveRequest(request)) return { kind: "aborted" };
		if (!location) {
			this.#send(request, envelope("omfg.aborted"));
			void this.#closeActiveRequest(request, false);
			return { kind: "aborted" };
		}

		if (location === AMEND_OPTION) {
			this.#setStatus(request, "confirming", "Describe how to amend the rule…");
			const amendment = await this.ctx.showHookInput("Amend TTSR rule", "e.g. Make it specific to Ruby string eval in tool:write(*.rb)");
			if (!this.#isActiveRequest(request)) return { kind: "aborted" };
			const feedback = amendment?.trim();
			if (!feedback) {
				this.#send(request, envelope("omfg.aborted"));
				void this.#closeActiveRequest(request, false);
				return { kind: "aborted" };
			}
			return { kind: "amend", feedback };
		}

		const target = this.#resolveTarget(location, candidate.rule.name);
		if (await Bun.file(target.filePath).exists()) {
			const shouldOverwrite = await this.ctx.showHookConfirm(
				"Overwrite TTSR rule?",
				`${shortenPath(target.filePath)} already exists. Overwrite it?`,
			);
			if (!this.#isActiveRequest(request)) return { kind: "aborted" };
			if (!shouldOverwrite) {
				this.#send(request, envelope("omfg.rejected"));
				return { kind: "rejected" };
			}
		}

		this.#setStatus(request, "saving", `Saving ${candidate.rule.name}…`);
		await Bun.write(target.filePath, candidate.fileContent);
		if (!this.#isActiveRequest(request)) return { kind: "aborted" };
		const savedRule = buildOmfgRuleForPath(candidate.rule.name, candidate.fileContent, target.filePath, target.level);
		this.#registerLive(savedRule);
		this.#send(request, envelope("omfg.saved", shortenPath(target.filePath)));
		return { kind: "saved" };
	}

	#resolveTarget(location: string, ruleName: string): { filePath: string; level: OmfgRuleSourceLevel } {
		if (location === GLOBAL_OPTION) {
			return { filePath: path.join(this.ctx.settings.getAgentDir(), "rules", `${ruleName}.md`), level: "user" };
		}
		return { filePath: path.join(this.ctx.sessionManager.getCwd(), CONFIG_DIR_NAME, "rules", `${ruleName}.md`), level: "project" };
	}

	#registerLive(rule: Rule): void {
		this.ctx.session.ttsrManager?.addRule(rule);
	}

	#setStatus(request: OmfgRequest, state: OmfgPanelState, status: string): void {
		this.#send(request, statusEnvelope(state, status));
	}

	#send(request: OmfgRequest, message: MvuEnvelope): void {
		if (!this.#isActiveRequest(request)) return;
		if (request.runtime === undefined) {
			request.pendingMessages.push(message);
			return;
		}
		const runtime = request.runtime;
		request.dispatchTail = request.dispatchTail.then(() => Effect.runPromise(runtime.dispatch(message))).catch(() => undefined);
	}

	#closeActiveRequest(request: OmfgRequest, abort: boolean): Promise<void> {
		if (!this.#isActiveRequest(request)) return Promise.resolve();
		this.#activeRequest = undefined;
		if (abort) request.abortController.abort();
		this.ctx.omfgContainer.clear();
		this.ctx.ui.requestRender();
		return (async () => {
			await request.mountPromise;
			if (request.route !== undefined) {
				await Effect.runPromise(request.route.close()).catch(() => undefined);
			} else {
				request.component.dispose();
			}
		})();
	}

	#isActiveRequest(request: OmfgRequest): boolean {
		return this.#activeRequest === request;
	}

	#shouldStop(request: OmfgRequest): boolean {
		return !this.#isActiveRequest(request) || request.abortController.signal.aborted;
	}
}
