import type { Keybinding } from "@oh-my-pi/pi-tui";
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
import type { LogoutAccount } from "../../slash-commands/helpers/logout";

export type LogoutAccountId = string & { readonly __logoutAccountId: unique symbol };
export type LogoutAccountAction = Keybinding;

export const makeLogoutAccountId = (credentialId: number): LogoutAccountId =>
	`credential:${credentialId}` as LogoutAccountId;

export interface LogoutAccountRow {
	readonly id: LogoutAccountId;
	readonly account: LogoutAccount;
	readonly label: string;
	readonly detail: string;
	readonly active: boolean;
	readonly searchText: string;
}

export interface LogoutAccountSelectorOptions {
	readonly providerName: string;
	readonly accounts: readonly LogoutAccount[];
	readonly componentId?: ComponentId;
	readonly sourceRevision?: number;
}

export interface LogoutAccountSelectorAdapter {
	readonly componentId: ComponentId;
	readonly providerName: string;
	readonly rows: ReadonlyMap<LogoutAccountId, LogoutAccountRow>;
	readonly selector: SelectorAdapter<LogoutAccountId, LogoutAccountRow, LogoutAccountRow, LogoutAccountRow, LogoutAccountAction>;
	readonly initialModel: SelectorModel<LogoutAccountId, LogoutAccountAction>;
	readonly sourceRevision: number;
	readonly update: (
		model: SelectorModel<LogoutAccountId, LogoutAccountAction>,
		message: SelectorMsg<LogoutAccountId, LogoutAccountAction>,
	) => Transition<SelectorModel<LogoutAccountId, LogoutAccountAction>, SelectorCommand<LogoutAccountAction, LogoutAccountId>>;
}

export interface LogoutAccountSelected extends SelectorActionStamp<LogoutAccountId, LogoutAccountAction> {
	readonly _tag: "LogoutAccountSelected";
	readonly provider: string;
	readonly account: LogoutAccount;
}

export interface LogoutAccountSelectorClosed {
	readonly _tag: "LogoutAccountSelectorClosed";
}

export type LogoutAccountSelectorOutput = LogoutAccountSelected | LogoutAccountSelectorClosed;

const CONFIRM_ACTION = "tui.select.confirm" as LogoutAccountAction;

export function makeLogoutAccountSelectorAdapter(options: LogoutAccountSelectorOptions): LogoutAccountSelectorAdapter {
	const sourceRevision = options.sourceRevision ?? 0;
	const componentId = options.componentId ?? makeComponentId(`logout-account-selector:${options.providerName}`);
	const rows = new Map(
		options.accounts.map(account => {
			const id = makeLogoutAccountId(account.credentialId);
			const row: LogoutAccountRow = {
				id,
				account,
				label: account.label,
				detail: account.detail,
				active: account.active,
				searchText: `${account.label} ${account.detail} ${account.type} ${account.provider}`,
			};
			return [id, row] as const;
		}),
	);
	const ids = options.accounts.map(account => makeLogoutAccountId(account.credentialId));
	const searchTextById = new Map(ids.map(id => [id, rows.get(id)?.searchText ?? id] as const));
	const activeAccount = options.accounts.find(account => account.active);
	const initialModel = makeSelectorModel<LogoutAccountId, LogoutAccountAction>(ids, sourceRevision, searchTextById);
	const initialSelectedId = activeAccount === undefined ? initialModel.selectedId : makeLogoutAccountId(activeAccount.credentialId);
	const selector: SelectorAdapter<LogoutAccountId, LogoutAccountRow, LogoutAccountRow, LogoutAccountRow, LogoutAccountAction> = {
		componentId,
		capabilities: new Set(["selector.filter"]),
		keyOf: row => row.id,
		searchText: row => row.searchText,
		row: row => row,
		preview: row => row,
		activate: (id, model): SelectorActivation<LogoutAccountAction, LogoutAccountId> =>
			model.selectedId === id && rows.has(id) ? { _tag: "Command", action: CONFIRM_ACTION, id } : { _tag: "Noop" },
	};
	return {
		componentId,
		providerName: options.providerName,
		rows,
		selector,
		initialModel: { ...initialModel, selectedId: initialSelectedId },
		sourceRevision,
		update: updateSelector,
	};
}

export function logoutAccountSelectorOutput(
	command: SelectorCommand<LogoutAccountAction, LogoutAccountId>,
	adapter: LogoutAccountSelectorAdapter,
): LogoutAccountSelectorOutput | undefined {
	if (command._tag === "CloseRequested") return { _tag: "LogoutAccountSelectorClosed" };
	if (command._tag !== "Activate" || command.action !== CONFIRM_ACTION) return undefined;
	const row = adapter.rows.get(command.id);
	return row === undefined
		? undefined
		: {
				_tag: "LogoutAccountSelected",
				provider: row.account.provider,
				account: row.account,
				id: command.id,
				action: command.action,
				sourceRevision: command.sourceRevision,
				requestGeneration: command.requestGeneration,
				nonce: command.nonce,
		  };
}

export function replaceLogoutAccounts(
	adapter: LogoutAccountSelectorAdapter,
	accounts: readonly LogoutAccount[],
	sourceRevision: number,
): SelectorMsg<LogoutAccountId, LogoutAccountAction> {
	void adapter;
	return {
		_tag: "SourceReplaced",
		sourceRevision,
		orderedIds: accounts.map(account => makeLogoutAccountId(account.credentialId)),
		searchTextById: new Map(
			accounts.map(account => [
				makeLogoutAccountId(account.credentialId),
				`${account.label} ${account.detail} ${account.type} ${account.provider}`,
			] as const),
		),
	};
}