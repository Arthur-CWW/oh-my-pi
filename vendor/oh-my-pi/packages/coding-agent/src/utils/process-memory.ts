/**
 * Cadence for sampling coordinator RSS. Shared by the status-line footprint
 * badge and the async-job memory-pressure sweep so the two levers observe the
 * same process at the same rate.
 */
export const MEMORY_SAMPLE_INTERVAL_MS = 10_000;
