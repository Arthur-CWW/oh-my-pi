import { Exit } from "effect";
import type { DurableDispatchState } from "./protocol";

/** Only a successful provider return proves completion; every other exit is side-effect-uncertain. */
export const providerExitDispatchState = <A, E>(
	exit: Exit.Exit<A, E>,
): Extract<DurableDispatchState, "completed" | "uncertain"> =>
	Exit.isSuccess(exit) ? "completed" : "uncertain";
