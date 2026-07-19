import { Effect, Scope } from "effect";
import { prompt } from "@oh-my-pi/pi-utils";
import btwUserPrompt from "../../prompts/system/btw-user.md" with { type: "text" };
import { BtwPanelComponent, makeBtwPanelModel, type BtwPanelCommand, type BtwPanelModel, type BtwPanelMsg, updateBtwPanel } from "../components/btw-panel";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import { mountMvuChild, type MvuRouteHandle } from "../mvu/route-host";
import { mountMvuRuntime, type MvuRuntime, type MvuRuntimeConfig } from "../mvu/runtime";
import { makeComponentId, type ActiveKeymapContext, type KeyEvent, type Transition } from "../mvu/schema";
import type { InteractiveModeContext } from "../types";

const BTW_COMPONENT_ID = makeComponentId("btw.panel");
const dirtyKeys = new Set(["btw.panel"]);
type BtwRuntimeMessage = MvuEnvelope;

interface BtwRequest {
	component: BtwPanelComponent;
	abortController: AbortController;
	question: string;
	runtime?: MvuRuntime<BtwPanelModel, BtwRuntimeMessage>;
	route?: MvuRouteHandle;
	pendingMessages: BtwRuntimeMessage[];
	dispatchTail: Promise<void>;
	mountPromise?: Promise<void>;
}

function eventForText(text: string): KeyEvent {
	return { _tag: "Paste", text };
}

function runtimeEnvelope(action: string, text?: string): MvuEnvelope {
	return {
		_tag: "MvuInput",
		action: action as MvuEnvelope["action"],
		event: eventForText(text ?? ""),
	};
}

function messageFromEnvelope(envelope: MvuEnvelope): BtwPanelMsg {
	const action = String(envelope.action);
	if (action === "btw.stream") return { _tag: "StreamDelta", delta: envelope.event._tag === "Paste" ? envelope.event.text : "" };
	if (action === "btw.answer") return { _tag: "Answer", text: envelope.event._tag === "Paste" ? envelope.event.text : "" };
	if (action === "btw.complete") return { _tag: "Complete" };
	if (action === "btw.aborted") return { _tag: "Aborted" };
	if (action === "btw.error") return { _tag: "Error", message: envelope.event._tag === "Paste" ? envelope.event.text : "Unknown error" };
	return { _tag: "Input", envelope };
}

const routeContext = (_model: BtwPanelModel): ActiveKeymapContext => ({
	contexts: ["btw.panel"],
	mode: "Browse",
	focus: "body",
	capabilities: new Set(),
});

export class BtwController {
	#activeRequest: BtwRequest | undefined;

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

	async start(question: string): Promise<void> {
		const trimmedQuestion = question.trim();
		if (!trimmedQuestion) {
			this.ctx.showStatus("Usage: /btw <question>");
			return;
		}

		if (!this.ctx.session.model) {
			this.ctx.showError("No active model available for /btw.");
			return;
		}

		const previous = this.#activeRequest;
		const previousClosed = previous ? this.#closeActiveRequest(previous, true) : Promise.resolve();
		const model = makeBtwPanelModel(trimmedQuestion);
		const request: BtwRequest = {
			component: new BtwPanelComponent(
				{ requestComponentRender: component => this.ctx.ui.requestComponentRender(component) },
				model,
			),
			abortController: new AbortController(),
			question: trimmedQuestion,
			pendingMessages: [],
			dispatchTail: Promise.resolve(),
		};
		this.#activeRequest = request;
		this.ctx.btwContainer.clear();
		this.ctx.btwContainer.addChild(request.component);
		this.ctx.ui.requestRender();

		request.mountPromise = this.#mountRequest(request, model, previousClosed);
		void this.#runRequest(request);
	}

	async #mountRequest(
		request: BtwRequest,
		model: BtwPanelModel,
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
						const route: MvuInputRoute<BtwPanelModel> = {
							componentId: BTW_COMPONENT_ID,
							focusedRoot: request.component,
							context: routeContext,
							actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
						};
						const runtimeConfig: MvuRuntimeConfig<BtwPanelModel, MvuEnvelope, BtwPanelCommand, never> = {
							componentId: BTW_COMPONENT_ID,
							initialModel: model,
							update: (current: BtwPanelModel, value: MvuEnvelope): Transition<BtwPanelModel, BtwPanelCommand> =>
								updateBtwPanel(current, messageFromEnvelope(value)),
							interpret: (command: BtwPanelCommand) =>
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
						const handle = yield* mountMvuChild<BtwPanelModel, MvuEnvelope, BtwPanelCommand, never>({
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
			for (const message of pending) this.#dispatch(request, message);
		} catch (error) {
			if (this.#isActiveRequest(request)) {
				void this.#closeActiveRequest(request, true);
				this.ctx.showError(error instanceof Error ? error.message : String(error));
			}
		}
	}

	async #runRequest(request: BtwRequest): Promise<void> {
		try {
			const promptText = prompt.render(btwUserPrompt, { question: request.question });
			const { replyText } = await this.ctx.session.runEphemeralTurn({
				promptText,
				onTextDelta: delta => this.#dispatch(request, runtimeEnvelope("btw.stream", delta)),
				signal: request.abortController.signal,
			});
			if (!this.#isActiveRequest(request)) return;
			if (replyText) this.#dispatch(request, runtimeEnvelope("btw.answer", replyText));
			this.#dispatch(request, runtimeEnvelope("btw.complete"));
		} catch (error) {
			if (!this.#isActiveRequest(request)) return;
			this.#dispatch(
				request,
				request.abortController.signal.aborted
					? runtimeEnvelope("btw.aborted")
					: runtimeEnvelope("btw.error", error instanceof Error ? error.message : String(error)),
			);
		}
	}
	#dispatch(request: BtwRequest, message: BtwRuntimeMessage): void {
		if (!this.#isActiveRequest(request)) return;
		if (request.runtime === undefined) {
			request.pendingMessages.push(message);
			return;
		}
		const runtime = request.runtime;
		request.dispatchTail = request.dispatchTail.then(() => Effect.runPromise(runtime.dispatch(message))).catch(() => undefined);
	}

	#closeActiveRequest(request: BtwRequest, abort: boolean): Promise<void> {
		if (!this.#isActiveRequest(request)) return Promise.resolve();
		this.#activeRequest = undefined;
		if (abort) request.abortController.abort();
		this.ctx.btwContainer.clear();
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

	#isActiveRequest(request: BtwRequest): boolean {
		return this.#activeRequest === request;
	}
}
