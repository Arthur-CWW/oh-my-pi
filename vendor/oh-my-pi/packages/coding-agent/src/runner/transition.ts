import type { RunnerState } from "./protocol.js";

/** Provider completion is serialized even though this representative slice has no completion state yet. */
export const transitionProviderCompletion = (state: RunnerState): RunnerState => state;
