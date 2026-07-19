import { Effect } from "effect";
import type { Keybinding } from "@oh-my-pi/pi-tui";
import type {
	ResetCreditAccountStatus,
	ResetCreditRedeemOutcome,
	ResetCreditTarget,
} from "../../session/auth-storage";
import type { ResetUsageAccount } from "../../slash-commands/helpers/reset-usage";
import {
	makeSelectorModel,
	type SelectorActivation,
	type SelectorActionStamp,
	type SelectorAdapter,
	type SelectorCommand,
	type SelectorModel,
	type SelectorMsg,
	updateSelector,
} from "./selector";
import { makeComponentId, type ComponentId, type Transition } from "./schema";

export type ResetUsageAccountId = string & { readonly __resetUsageAccountId: unique symbol };
export type ResetUsageAction = Keybinding;

export const RESET_USAGE_ACTION = "tui.select.confirm" as ResetUsageAction;

function canonicalTarget(target: ResetCreditTarget): string {
	if (target.credentialId !== undefined) return `credential:${target.credentialId}`;
	if (target.accountId !== undefined) return `account:${target.accountId}`;
	if (target.email !== undefined) return `email:${target.email}`;
	return "target:unidentified";
}

export const makeResetUsageAccountId = (target: ResetCreditTarget): ResetUsageAccountId =>
	`reset:${canonicalTarget(target)}` as ResetUsageAccountId;

export interface ResetUsageAccountRow {
	readonly id: ResetUsageAccountId;
	readonly account: ResetUsageAccount;
	readonly target: ResetCreditTarget;
	readonly label: string;
	readonly availableCount: number;
	readonly redeemable: boolean;
	readonly active: boolean;
	readonly searchText: string;
}

export interface ResetUsageSelectorOptions {
	readonly accounts: readonly ResetUsageAccount[];
	readonly sessionGeneration: string;
	readonly mountGeneration: number;
	readonly componentId?: ComponentId;
	readonly sourceRevision?: number;
}

export interface ResetUsageSelectorAdapter {
	readonly componentId: ComponentId;
	readonly rows: ReadonlyMap<ResetUsageAccountId, ResetUsageAccountRow>;
	readonly selector: SelectorAdapter<ResetUsageAccountId, ResetUsageAccountRow, ResetUsageAccountRow, ResetUsageAccountRow, ResetUsageAction>;
	readonly initialModel: SelectorModel<ResetUsageAccountId, ResetUsageAction>;
	readonly sourceRevision: number;
	readonly update: (
		model: SelectorModel<ResetUsageAccountId, ResetUsageAction>,
		message: SelectorMsg<ResetUsageAccountId, ResetUsageAction>,
	) => Transition<SelectorModel<ResetUsageAccountId, ResetUsageAction>, SelectorCommand<ResetUsageAction, ResetUsageAccountId>>;
	readonly redeemable: (id: ResetUsageAccountId) => boolean;
	readonly nonce: (id: ResetUsageAccountId, sourceRevision?: number) => string;
}

export interface ResetSpendCommand extends SelectorActionStamp<ResetUsageAccountId, ResetUsageAction> {
	readonly _tag: "SpendReset";
}

export interface ResetSpendReceipt extends SelectorActionStamp<ResetUsageAccountId, ResetUsageAction> {
	readonly _tag: "ResetSpendReceipt";
	readonly receiptId: string;
	readonly outcome?: ResetCreditRedeemOutcome;
	readonly duplicate: boolean;
}

export interface ResetSpendFailure extends SelectorActionStamp<ResetUsageAccountId, ResetUsageAction> {
	readonly _tag: "ResetSpendFailure";
	readonly receiptId: string;
	readonly error: string;
}

export type ResetSpendOutput = ResetSpendReceipt | ResetSpendFailure;

export interface ResetSpendDeduplication {
	claim(nonce: string): boolean;
}

export function makeResetSpendDeduplication(): ResetSpendDeduplication {
	const consumed = new Set<string>();
	return {
		claim(nonce) {
			if (consumed.has(nonce)) return false;
			consumed.add(nonce);
			return true;
		},
	};
}

export function resetSpendOutputToSelectorMsg(
	output: ResetSpendOutput,
): SelectorMsg<ResetUsageAccountId, ResetUsageAction> {
	const stamp = {
		action: output.action,
		id: output.id,
		sourceRevision: output.sourceRevision,
		requestGeneration: output.requestGeneration,
		nonce: output.nonce,
		receiptId: output.receiptId,
	};
	return output._tag === "ResetSpendReceipt"
		? { _tag: "ActionSucceeded", ...stamp }
		: { _tag: "ActionFailed", ...stamp, error: output.error };
}

export function makeResetUsageSelectorAdapter(options: ResetUsageSelectorOptions): ResetUsageSelectorAdapter {
	if (options.sessionGeneration.length === 0) throw new RangeError("Reset usage session generation must not be empty");
	if (!Number.isSafeInteger(options.mountGeneration) || options.mountGeneration <= 0) {
		throw new RangeError(`Reset usage mount generation must be a positive integer: ${options.mountGeneration}`);
	}
	const sourceRevision = options.sourceRevision ?? 0;
	const componentId = options.componentId ?? makeComponentId("reset-usage-selector");
	const noncePrefix = `${options.sessionGeneration}:${options.mountGeneration}:${componentId}`;
	const rows = new Map(
		options.accounts.map(account => {
			const id = makeResetUsageAccountId(account.target);
			const row: ResetUsageAccountRow = {
				id,
				account,
				target: account.target,
				label: account.label,
				availableCount: account.availableCount,
				redeemable: account.availableCount > 0 && account.error === undefined,
				active: account.active,
				searchText: `${account.label} ${account.availableCount} ${account.error ?? ""}`,
			};
			return [id, row] as const;
		}),
	);
	const ids = options.accounts.map(account => makeResetUsageAccountId(account.target));
	const searchTextById = new Map(ids.map(id => [id, rows.get(id)?.searchText ?? id] as const));
	const selector: SelectorAdapter<ResetUsageAccountId, ResetUsageAccountRow, ResetUsageAccountRow, ResetUsageAccountRow, ResetUsageAction> = {
		componentId,
		capabilities: new Set(["selector.filter", "selector.confirm"]),
		keyOf: row => row.id,
		searchText: row => row.searchText,
		row: row => row,
		preview: row => row,
		activate: (id, model): SelectorActivation<ResetUsageAction, ResetUsageAccountId> => {
			if (model.selectedId !== id || !rows.has(id)) return { _tag: "Noop" };
			return { _tag: "Confirm", action: RESET_USAGE_ACTION, id, nonce: `${noncePrefix}:${sourceRevision}:${id}` };
		},
	};
	return {
		componentId,
		rows,
		selector,
		initialModel: makeSelectorModel<ResetUsageAccountId, ResetUsageAction>(ids, sourceRevision, searchTextById),
		sourceRevision,
		update: updateSelector,
		redeemable: id => rows.get(id)?.redeemable === true,
		nonce: (id, revision = sourceRevision) => `${noncePrefix}:${revision}:${id}`,
	};
}

export function resetUsageSelectorOutput(
	command: SelectorCommand<ResetUsageAction, ResetUsageAccountId>,
	adapter: ResetUsageSelectorAdapter,
): ResetSpendCommand | undefined {
	if (command._tag !== "SpendReset" || command.action !== RESET_USAGE_ACTION) return undefined;
	if (!adapter.rows.has(command.id)) return undefined;
	return command;
}

export function replaceResetUsageAccounts(
	accounts: readonly ResetUsageAccount[],
	sourceRevision: number,
): SelectorMsg<ResetUsageAccountId, ResetUsageAction> {
	return {
		_tag: "SourceReplaced",
		sourceRevision,
		orderedIds: accounts.map(account => makeResetUsageAccountId(account.target)),
		searchTextById: new Map(
			accounts.map(account => [
				makeResetUsageAccountId(account.target),
				`${account.label} ${account.availableCount} ${account.error ?? ""}`,
			] as const),
		),
	};
}

export function resetUsageAccountsFromStatus(statuses: readonly ResetCreditAccountStatus[]): ResetUsageAccount[] {
	return statuses.map(status => ({
		label: status.email ?? status.accountId ?? "account",
		availableCount: status.availableCount,
		target: {
			credentialId: status.credentialId,
			accountId: status.accountId,
			email: status.email,
		},
		active: status.active,
		error: status.error,
	}));
}

export interface SpendResetInterpreterOptions<R> {
	readonly adapter: ResetUsageSelectorAdapter;
	readonly deduplication: ResetSpendDeduplication;
	readonly redeem: (target: ResetCreditTarget) => Effect.Effect<ResetCreditRedeemOutcome, never, R>;
}

/**
 * The only reset-credit spend interpreter. Deduplication is owned by the
 * session/controller rather than a route mount, so remounting cannot redeem a
 * second credit for an already-claimed nonce.
 */
export function makeSpendResetInterpreter<R>(
	options: SpendResetInterpreterOptions<R>,
): (command: ResetSpendCommand) => Effect.Effect<readonly [ResetSpendOutput], never, R> {
	return command => {
		const receiptId = `reset:${command.nonce}`;
		if (!options.deduplication.claim(command.nonce)) {
			return Effect.succeed([
				{
					_tag: "ResetSpendReceipt",
					receiptId,
					id: command.id,
					action: command.action,
					sourceRevision: command.sourceRevision,
					requestGeneration: command.requestGeneration,
					nonce: command.nonce,
					duplicate: true,
				},
			] as const);
		}
		const row = options.adapter.rows.get(command.id);
		if (row === undefined || !row.redeemable) {
			return Effect.succeed([
				{
					_tag: "ResetSpendFailure",
					receiptId,
					id: command.id,
					action: command.action,
					sourceRevision: command.sourceRevision,
					requestGeneration: command.requestGeneration,
					nonce: command.nonce,
					error: "Reset target is no longer redeemable.",
				},
			] as const);
		}
		return options.redeem(row.target).pipe(
			Effect.match({
				onSuccess: outcome => [{
					_tag: "ResetSpendReceipt",
					receiptId,
					id: command.id,
					action: command.action,
					sourceRevision: command.sourceRevision,
					requestGeneration: command.requestGeneration,
					nonce: command.nonce,
					outcome,
					duplicate: false,
				}] as const,
				onFailure: error => [{
					_tag: "ResetSpendFailure",
					receiptId,
					id: command.id,
					action: command.action,
					sourceRevision: command.sourceRevision,
					requestGeneration: command.requestGeneration,
					nonce: command.nonce,
					error: String(error),
				}] as const,
			}),
		);
	};
}