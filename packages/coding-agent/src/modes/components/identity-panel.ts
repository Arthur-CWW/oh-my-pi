import { Container, Text } from "@oh-my-pi/pi-tui";
import { formatSessionIdentity, type SessionIdentity, sessionIdentityHandle } from "../session-identity";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

export class IdentityPanelState {
	readonly identity: SessionIdentity;
	#activation: Promise<void> | undefined;
	#copied = false;
	#dismissed = false;

	constructor(identity: SessionIdentity) {
		this.identity = identity;
	}

	get copied(): boolean {
		return this.#copied;
	}

	get dismissed(): boolean {
		return this.#dismissed;
	}

	get content(): string {
		return formatSessionIdentity(this.identity, this.#copied);
	}

	activate(copy: (handle: string) => void | Promise<void>): Promise<void> {
		this.#activation ??= Promise.resolve(copy(sessionIdentityHandle(this.identity))).then(() => {
			this.#copied = true;
		});
		return this.#activation;
	}

	handleInput(data: string): boolean {
		if (this.#dismissed || !matchesUiDismiss(data)) return false;
		this.#dismissed = true;
		return true;
	}
}

export class IdentityPanelComponent extends Container {
	constructor(
		readonly state: IdentityPanelState,
		private readonly dismiss: () => void,
	) {
		super();
	}

	handleInput(data: string): void {
		if (this.state.handleInput(data)) this.dismiss();
	}

	override render(width: number): readonly string[] {
		const border = new DynamicBorder().render(width);
		return [...border, ...new Text(this.state.content, 1, 0).render(Math.max(10, width)), ...border];
	}
}
