export type SessionLocator =
	| { readonly kind: "id"; readonly id: string }
	| { readonly kind: "path"; readonly path: string };

/** Every host-level session/process transition. Kept closed so new transitions must choose an ownership policy. */
export type InteractiveHostIntent =
	| { readonly kind: "exit" }
	| { readonly kind: "newSession"; readonly parent?: SessionLocator }
	| { readonly kind: "freshSession" }
	| { readonly kind: "resume"; readonly session: SessionLocator }
	| { readonly kind: "fork"; readonly entryId: string }
	| { readonly kind: "branch"; readonly entryId: string }
	| { readonly kind: "navigate"; readonly targetId: string; readonly summarize: boolean }
	| { readonly kind: "switchSession"; readonly session: SessionLocator }
	| { readonly kind: "moveSession"; readonly newDir: string }
	| { readonly kind: "restartProcess" };

export type SessionTransitionLineage = "none" | "same" | "new";

export function transitionLineage(intent: InteractiveHostIntent): SessionTransitionLineage {
	switch (intent.kind) {
		case "exit":
		case "restartProcess":
			return "none";
		case "resume":
		case "navigate":
		case "moveSession":
			return "same";
		case "newSession":
		case "freshSession":
		case "fork":
		case "branch":
		case "switchSession":
			return "new";
	}
}
