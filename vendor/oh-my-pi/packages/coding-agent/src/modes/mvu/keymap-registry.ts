import * as Effect from "effect/Effect";
import {
	canonicalKeyId,
	type Keybinding,
	KeybindingsManager,
	type KeyId,
} from "@oh-my-pi/pi-tui";
import { KeybindingsManager as CodingAgentKeybindingsManager } from "../../config/keybindings";
import {
	type ActiveKeymapContext,
	type ActiveKeymapContextMatrix,
	type AdapterKeymapClaim,
	type AdapterKeymapClaims,
	type ContextId,
	KeymapConflictError,
	KeymapDecodeError,
	type KeymapBinding,
	type KeymapId,
	type LiteralContextKeySource,
	type KeymapTable,
	type KeymapWhen,
	type ResolvedBinding,
} from "./schema";

const layerOrder: Record<KeymapTable["layer"], number> = {
	global: 0,
	family: 1,
	adapter: 2,
};

type Claim = ResolvedBinding & {
	readonly replaced: boolean;
	readonly userConfigured: boolean;
	readonly supersedesContexts: readonly ContextId[];
};

const LITERAL_KEY_SOURCE: LiteralContextKeySource = { _tag: "Literal" };

function resolvedClaim(
	table: KeymapTable,
	binding: KeymapBinding,
	context: ContextId,
	key: KeyId,
	replaced: boolean,
	userConfigured: boolean,
): Claim {
	return {
		action: binding.action,
		when: binding.when,
		...(binding.override === undefined ? {} : { override: binding.override }),
		source: binding.source ?? LITERAL_KEY_SOURCE,
		key,
		tableId: table.id,
		layer: table.layer,
		context,
		replaced,
		userConfigured,
		supersedesContexts: table.supersedesContexts ?? [],
	};
}

function asKeys(value: KeyId | KeyId[] | undefined): readonly KeyId[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function canonicalKeybindingsManager(keybindings: KeybindingsManager): KeybindingsManager {
	// Direct route fixtures can reach the TUI-only global manager before
	// InteractiveMode installs the coding-agent definitions. Preserve any
	// user bindings while completing that manager with the canonical app
	// definitions so resolved actions still outrank whenUnclaimed literals.
	return keybindings.getDefinition("ui.dismiss") === undefined
		? CodingAgentKeybindingsManager.inMemory(keybindings.getUserBindings())
		: keybindings;
}

function tupleKey(context: ContextId, binding: KeymapBinding | ResolvedBinding, key: KeyId): string {
	return `${context}\u0000${binding.when.mode}\u0000${binding.when.focus}\u0000${binding.when.capability ?? ""}\u0000${canonicalKeyId(key)}`;
}

function decodeError(table: KeymapTable, reason: string): KeymapDecodeError {
	return new KeymapDecodeError({ tableId: String(table.id), reason });
}

function conflictError(
	table: KeymapTable,
	context: ContextId,
	binding: KeymapBinding,
	key: KeyId,
	reason: KeymapConflictError["reason"],
): KeymapConflictError {
	return new KeymapConflictError({
		tableId: String(table.id),
		context,
		mode: binding.when.mode,
		focus: binding.when.focus,
		key: String(key),
		action: String(binding.action),
		reason,
	});
}

function claimConflictError(claim: Claim, reason: KeymapConflictError["reason"]): KeymapConflictError {
	return new KeymapConflictError({
		tableId: String(claim.tableId),
		context: claim.context,
		mode: claim.when.mode,
		focus: claim.when.focus,
		key: String(claim.key),
		action: String(claim.action),
		reason,
	});
}

function expandedKeys(
	binding: KeymapBinding,
	manager: KeybindingsManager,
	resolvedBindings: ReturnType<KeybindingsManager["getResolvedBindings"]>,
): readonly KeyId[] {
	if (binding.source?._tag !== "ResolvedAction") return binding.key === undefined ? [] : [binding.key];
	// Validate the action independently of its current binding. An explicitly
	// unbound action is valid and may still retain declared contextual literals.
	manager.getDefinition(binding.action);
	const keys = [...asKeys(resolvedBindings[binding.action]), ...(binding.source.literals ?? [])];
	const seen = new Set<string>();
	return keys.filter(key => {
		const canonical = canonicalKeyId(key);
		if (seen.has(canonical)) return false;
		seen.add(canonical);
		return true;
	});
}

function capabilitiesOverlap(left: KeymapWhen, right: KeymapWhen): boolean {
	return left.capability === undefined || right.capability === undefined || left.capability === right.capability;
}

function claimsOverlap(left: Claim, right: Claim): boolean {
	return (
		left.when.mode === right.when.mode &&
		left.when.focus === right.when.focus &&
		canonicalKeyId(left.key) === canonicalKeyId(right.key) &&
		capabilitiesOverlap(left.when, right.when)
	);
}

function canSupersede(winner: Claim, loser: Claim): boolean {
	return (
		layerOrder[winner.layer] > layerOrder[loser.layer] &&
		winner.supersedesContexts.includes(loser.context)
	);
}

function stableClaim(left: Claim, right: Claim): Claim {
	const contextCompare = String(left.context).localeCompare(String(right.context));
	if (contextCompare !== 0) return contextCompare < 0 ? left : right;
	return String(left.tableId).localeCompare(String(right.tableId)) <= 0 ? left : right;
}

function selectCombinedClaim(claims: readonly Claim[]): Claim | undefined {
	const claimedContexts = new Set(
		claims
			.filter(claim => claim.source._tag !== "Literal" || claim.source.whenUnclaimed !== true)
			.map(claim => claim.context),
	);
	const candidates = claims.filter(
		claim =>
			claim.source._tag !== "Literal" ||
			claim.source.whenUnclaimed !== true ||
			!claimedContexts.has(claim.context),
	);
	const byAction = new Map<string, Claim[]>();
	for (const claim of candidates) {
		const action = String(claim.action);
		const actionClaims = byAction.get(action) ?? [];
		actionClaims.push(claim);
		byAction.set(action, actionClaims);
	}
	const groups = [...byAction.values()];
	if (groups.length === 0) return undefined;
	if (groups.length === 1) return groups[0].reduce(stableClaim);
	const winningGroups = groups.filter(group =>
		group.some(candidate =>
			groups.every(otherGroup => otherGroup === group || otherGroup.every(other => canSupersede(candidate, other))),
		),
	);
	if (winningGroups.length === 1) return winningGroups[0].reduce(stableClaim);
	// Without a declared supersession, one explicit user remap may displace only
	// default semantic bindings. Literal route grammar remains authoritative.
	const configuredGroups = groups.filter(group => group.some(claim => claim.userConfigured));
	if (configuredGroups.length !== 1) return undefined;
	const configuredGroup = configuredGroups[0];
	if (
		!groups.every(
			group =>
				group === configuredGroup ||
				group.every(claim => claim.source._tag === "ResolvedAction" && !claim.userConfigured),
		)
	) {
		return undefined;
	}
	return configuredGroup.reduce(stableClaim);
}

function matchesClaim(claim: Claim, active: ActiveKeymapContext): boolean {
	return (
		claim.when.mode === active.mode &&
		claim.when.focus === active.focus &&
		(claim.when.capability === undefined || active.capabilities.has(claim.when.capability))
	);
}

function validateTable(table: KeymapTable): KeymapDecodeError | undefined {
	if (String(table.id).length === 0) return decodeError(table, "table id must not be empty");
	if (table.contexts.length === 0) return decodeError(table, "table must declare at least one context");
	if (table.bindings.length === 0) return decodeError(table, "table must declare at least one binding");
	if (
		table.supersedesContexts?.some(
			context => String(context).length === 0 || table.contexts.includes(context),
		)
	) {
		return decodeError(table, "table supersedesContexts must name non-empty other contexts");
	}
	for (const binding of table.bindings) {
		if (binding.source?._tag !== "ResolvedAction") {
			if (binding.key === undefined || String(binding.key).length === 0) return decodeError(table, "binding key must not be empty");
		} else if (binding.source.literals?.some(key => String(key).length === 0)) {
			return decodeError(table, "resolved binding literal must not be empty");
		}
		if (String(binding.action).length === 0) return decodeError(table, "binding action must not be empty");
		if (binding.override !== undefined && binding.override.reason.trim().length === 0) {
			return decodeError(table, `override for ${String(binding.action)} needs a reason`);
		}
	}
	return undefined;
}

function addClaimIndexes(
	claim: Claim,
	claims: Map<string, Claim>,
	byContext: Map<ContextId, Claim[]>,
): void {
	claims.set(tupleKey(claim.context, claim, claim.key), claim);
	const contextClaims = byContext.get(claim.context) ?? [];
	contextClaims.push(claim);
	byContext.set(claim.context, contextClaims);
}

function removeClaimIndexes(
	claim: Claim,
	claims: Map<string, Claim>,
	byContext: Map<ContextId, Claim[]>,
): void {
	claims.delete(tupleKey(claim.context, claim, claim.key));
	const contextClaims = byContext.get(claim.context);
	if (contextClaims !== undefined) {
		const index = contextClaims.indexOf(claim);
		if (index >= 0) contextClaims.splice(index, 1);
		if (contextClaims.length === 0) byContext.delete(claim.context);
	}
}


function validateActiveContextMatrix(
	matrix: ActiveKeymapContextMatrix,
	byContext: ReadonlyMap<ContextId, readonly Claim[]>,
): KeymapConflictError | undefined {
	for (const active of matrix) {
		const claimsByKey = new Map<string, Claim[]>();
		for (const context of active.contexts) {
			for (const claim of byContext.get(context) ?? []) {
				if (!matchesClaim(claim, active)) continue;
				const key = canonicalKeyId(claim.key);
				const matching = claimsByKey.get(key) ?? [];
				matching.push(claim);
				claimsByKey.set(key, matching);
			}
		}
		for (const claims of claimsByKey.values()) {
			if (selectCombinedClaim(claims) !== undefined) continue;
			const first = claims[0];
			if (first !== undefined) return claimConflictError(first, "active-context-collision");
		}
	}
	return undefined;
}

export interface AdapterKeymapDeclaration {
	readonly action: Keybinding;
	readonly keys: readonly KeyId[];
	readonly context: ContextId;
	readonly tableId: KeymapId;
}

/**
 * Compile exact constructor adapter keys once. Later declarations win so a
 * route can give its interrupt claim precedence over its ordinary close key.
 */
export function compileAdapterKeymapClaims(
	declarations: readonly AdapterKeymapDeclaration[],
): AdapterKeymapClaims {
	const claims = new Map<string, AdapterKeymapClaim>();
	for (const declaration of declarations) {
		for (const key of declaration.keys) {
			claims.set(canonicalKeyId(key), {
				action: declaration.action,
				key,
				context: declaration.context,
				tableId: declaration.tableId,
			});
		}
	}
	return claims;
}

export interface KeymapRegistry {
	resolve(active: ActiveKeymapContext, key: KeyId): Keybinding | undefined;
	bindings(active: ActiveKeymapContext): readonly ResolvedBinding[];
}

class CompiledKeymapRegistry implements KeymapRegistry {
	readonly #claims: ReadonlyMap<string, Claim>;
	readonly #byContext: ReadonlyMap<ContextId, readonly Claim[]>;
	readonly #byContextKey: ReadonlyMap<ContextId, ReadonlyMap<string, readonly Claim[]>>;

	constructor(claims: ReadonlyMap<string, Claim>, byContext: ReadonlyMap<ContextId, readonly Claim[]>) {
		this.#claims = claims;
		this.#byContext = byContext;
		const byContextKey = new Map<ContextId, ReadonlyMap<string, readonly Claim[]>>();
		for (const [context, contextClaims] of byContext) {
			const byKey = new Map<string, Claim[]>();
			for (const claim of contextClaims) {
				const key = canonicalKeyId(claim.key);
				const matching = byKey.get(key);
				if (matching === undefined) byKey.set(key, [claim]);
				else matching.push(claim);
			}
			byContextKey.set(context, byKey);
		}
		this.#byContextKey = byContextKey;
	}

	resolve(active: ActiveKeymapContext, key: KeyId): Keybinding | undefined {
		const canonical = canonicalKeyId(key);
		const adapterClaim = active.adapterClaims?.get(canonical);
		if (adapterClaim !== undefined && active.contexts.includes(adapterClaim.context)) {
			return adapterClaim.action;
		}
		let first: Claim | undefined;
		let matches: Claim[] | undefined;
		for (const context of active.contexts) {
			for (const claim of this.#byContextKey.get(context)?.get(canonical) ?? []) {
				if (!matchesClaim(claim, active)) continue;
				if (first === undefined) first = claim;
				else {
					matches ??= [first];
					matches.push(claim);
				}
			}
		}
		return matches === undefined ? first?.action : selectCombinedClaim(matches)?.action;
	}

	bindings(active: ActiveKeymapContext): readonly ResolvedBinding[] {
		const claimsByKey = new Map<string, Claim[]>();
		for (const context of active.contexts) {
			for (const claim of this.#byContext.get(context) ?? []) {
				if (!matchesClaim(claim, active)) continue;
				const key = canonicalKeyId(claim.key);
				const matching = claimsByKey.get(key) ?? [];
				matching.push(claim);
				claimsByKey.set(key, matching);
			}
		}
		const adapterClaims = active.adapterClaims;
		const adapterOverrides = (key: string): boolean => {
			const claim = adapterClaims?.get(key);
			return claim !== undefined && active.contexts.includes(claim.context);
		};
		const resolved: ResolvedBinding[] = [...claimsByKey.entries()]
			.filter(([key]) => !adapterOverrides(key))
			.map(([, claims]) => selectCombinedClaim(claims))
			.filter((claim): claim is Claim => claim !== undefined);
		if (adapterClaims !== undefined) {
			for (const claim of adapterClaims.values()) {
				if (!active.contexts.includes(claim.context)) continue;
				resolved.push({
					action: claim.action,
					when: { mode: active.mode, focus: active.focus },
					source: { _tag: "Literal" },
					key: claim.key,
					tableId: claim.tableId,
					layer: "adapter",
					context: claim.context,
				});
			}
		}
		return resolved.sort((left, right) => {
			const keyCompare = canonicalKeyId(left.key).localeCompare(canonicalKeyId(right.key));
			return keyCompare !== 0 ? keyCompare : String(left.action).localeCompare(String(right.action));
		});
	}

	// Keeps the immutable map observable for diagnostics without exposing it.
	get size(): number {
		return this.#claims.size;
	}
}

/**
 * Compiles each context independently, then validates cross-context claims
 * against concrete route states. Contexts absent from the same matrix entry
 * are mutually exclusive and therefore cannot collide at runtime.
 */
export const compileKeymapRegistry = (
	tables: readonly KeymapTable[],
	keybindings: KeybindingsManager,
	activeContextMatrix: ActiveKeymapContextMatrix = [],
): Effect.Effect<KeymapRegistry, KeymapConflictError | KeymapDecodeError> =>
	Effect.suspend((): Effect.Effect<CompiledKeymapRegistry, KeymapConflictError | KeymapDecodeError> => {
		const claims = new Map<string, Claim>();
		const byContext = new Map<ContextId, Claim[]>();
		const manager = canonicalKeybindingsManager(keybindings);
		const resolvedBindings = manager.getResolvedBindings();
		const userBindings = manager.getUserBindings();
		const isUserConfigured = (binding: KeymapBinding, key: KeyId): boolean => {
			if (binding.source?._tag !== "ResolvedAction") return false;
			const configured = userBindings[String(binding.action)];
			return asKeys(configured).some(configuredKey => canonicalKeyId(configuredKey) === canonicalKeyId(key));
		};
		const orderedTables = [...tables].sort((left, right) => layerOrder[left.layer] - layerOrder[right.layer]);

		for (const table of orderedTables) {
			const decodeFailure = validateTable(table);
			if (decodeFailure !== undefined) return Effect.fail(decodeFailure);
			for (const binding of table.bindings) {
				let keys: readonly KeyId[];
				try {
					keys = expandedKeys(binding, manager, resolvedBindings);
				} catch {
					return Effect.fail(decodeError(table, `action ${String(binding.action)} is not configured`));
				}
				for (const context of table.contexts) {
					for (const key of keys) {
						const tuple = tupleKey(context, binding, key);
						const current = claims.get(tuple);
						if (current === undefined) {
							if (binding.override !== undefined) {
								return Effect.fail(conflictError(table, context, binding, key, "missing-override-target"));
							}
							const claim = resolvedClaim(table, binding, context, key, false, isUserConfigured(binding, key));
							addClaimIndexes(claim, claims, byContext);
							continue;
						}

						if (binding.source?._tag === "Literal" && binding.source.whenUnclaimed === true) {
							continue;
						}
						if (current.source._tag === "Literal" && current.source.whenUnclaimed === true) {
							if (binding.override !== undefined) {
								return Effect.fail(conflictError(table, context, binding, key, "missing-override-target"));
							}
							const replacement = resolvedClaim(
								table,
								binding,
								context,
								key,
								false,
								isUserConfigured(binding, key),
							);
							removeClaimIndexes(current, claims, byContext);
							addClaimIndexes(replacement, claims, byContext);
							continue;
						}

						const incomingUserConfigured = isUserConfigured(binding, key);
						if (
							binding.source?._tag === "ResolvedAction" &&
							current.source._tag === "ResolvedAction" &&
							incomingUserConfigured !== current.userConfigured &&
							binding.override === undefined
						) {
							if (current.userConfigured) continue;
							const replacement = resolvedClaim(table, binding, context, key, false, true);
							removeClaimIndexes(current, claims, byContext);
							addClaimIndexes(replacement, claims, byContext);
							continue;
						}

						if (binding.override === undefined) {
							return Effect.fail(
								conflictError(
									table,
									context,
									binding,
									key,
									current.action === binding.action ? "duplicate" : "implicit-replacement",
								),
							);
						}
						if (binding.override.replaces !== current.action) {
							return Effect.fail(conflictError(table, context, binding, key, "missing-override-target"));
						}
						if (current.replaced) {
							return Effect.fail(conflictError(table, context, binding, key, "override-chain"));
						}
						if (layerOrder[table.layer] <= layerOrder[current.layer]) {
							return Effect.fail(conflictError(table, context, binding, key, "implicit-replacement"));
						}
						const replacement = resolvedClaim(table, binding, context, key, true, isUserConfigured(binding, key));
						removeClaimIndexes(current, claims, byContext);
						addClaimIndexes(replacement, claims, byContext);
					}
				}
			}
		}
		const matrixConflict = validateActiveContextMatrix(activeContextMatrix, byContext);
		if (matrixConflict !== undefined) return Effect.fail(matrixConflict);
		return Effect.succeed(new CompiledKeymapRegistry(claims, byContext));
	});
