import { Effect } from "effect";
import { getKeybindings } from "@oh-my-pi/pi-tui";
import {
	AgentHubOverlayComponent,
	createAgentHubMvuMountSpec,
	type AgentHubMvuMountSpec,
	type AgentHubMvuRouteModel,
	type AgentHubMvuCommand,
	type AgentHubMvuInput,
	type AgentHubMvuMessage,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import {
	compileKeymapRegistry,
	type KeymapRegistry,
} from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import {
	MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
	MVU_KEYMAP_TABLES,
} from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";

interface HubInputState {
	spec: AgentHubMvuMountSpec;
	model: AgentHubMvuRouteModel;
}

const adapter = makeTerminalInputAdapter();
const registries = new WeakMap<object, KeymapRegistry>();
const registryForActiveBindings = (): KeymapRegistry => {
	const keybindings = getKeybindings();
	const existing = registries.get(keybindings);
	if (existing !== undefined) return existing;
	const registry = Effect.runSync(
		compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings, MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX),
	);
	registries.set(keybindings, registry);
	return registry;
};
const states = new WeakMap<AgentHubOverlayComponent, HubInputState>();

const stateFor = (hub: AgentHubOverlayComponent): HubInputState => {
	const existing = states.get(hub);
	if (existing !== undefined) return existing;
	const spec = createAgentHubMvuMountSpec(hub);
	const state = { spec, model: spec.initialModel } satisfies HubInputState;
	states.set(hub, state);
	return state;
};
function applyHubMessage(state: HubInputState, message: AgentHubMvuMessage): void {
	const transition = state.spec.update(state.model, message);
	state.model = transition.model;
	for (const command of transition.commands) {
		if ((command as AgentHubMvuCommand)._tag === "CommitAttention") {
			void Effect.runPromise(state.spec.interpret(command)).then(messages => {
				for (const settled of messages) applyHubMessage(state, settled);
			});
			continue;
		}
		for (const settled of Effect.runSync(state.spec.interpret(command))) applyHubMessage(state, settled);
	}
}

/** Read the same immutable model that subsequent routed input will reduce. */
export function getHubModel(hub: AgentHubOverlayComponent): AgentHubMvuRouteModel {
	return stateFor(hub).model;
}

/** Decode a terminal sequence and send it through the Hub's route/keymap mount. */
export function pressHub(hub: AgentHubOverlayComponent, sequence: string): void {
	const event = adapter.decode(sequence);
	if (event === undefined) throw new Error(`Could not decode ${JSON.stringify(sequence)}`);

	const state = stateFor(hub);
	if (event._tag === "Paste") {
		const message = state.spec.route.pasteToMsg?.(event) as AgentHubMvuInput | undefined;
		if (message !== undefined) applyHubMessage(state, message);
		return;
	}
	if (event._tag !== "Press" && event._tag !== "Release") return;
	const action = registryForActiveBindings().resolve(state.spec.route.context(state.model), event.key);
	if (action === undefined) throw new Error(`Unmapped Hub key ${JSON.stringify(sequence)}`);
	const message = state.spec.route.actionToMsg(action, event) as AgentHubMvuInput | undefined;
	if (message === undefined) return;
	applyHubMessage(state, message);
}
