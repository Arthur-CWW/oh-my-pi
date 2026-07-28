import { DEFAULT_STREAM_CAP_BYTES } from "@oh-my-pi/pi-utils";
import { Effect } from "effect";
import { bunPsExecutor } from "../resource/ps-command";

export interface FleetResourceSample {
	readonly rssMb: number;
	readonly cpuPercent: number;
	readonly uptime: string;
}

export type FleetResourceSamples = ReadonlyMap<number, FleetResourceSample>;

/** Decode the whitespace-delimited schema emitted by `ps -o pid=,rss=,pcpu=,etime=`. */
export function decodeFleetResourceSamples(output: unknown): FleetResourceSamples {
	const samples = new Map<number, FleetResourceSample>();
	if (typeof output !== "string") return samples;
	for (const line of output.split(/\r?\n/)) {
		const fields = line.trim().split(/\s+/);
		if (fields.length !== 4) continue;
		const [pidText, rssText, cpuText, uptime] = fields;
		if (pidText === undefined || rssText === undefined || cpuText === undefined || uptime === undefined) continue;
		const pid = Number(pidText);
		const rssKb = Number(rssText);
		const cpuPercent = Number(cpuText);
		if (
			(!Number.isSafeInteger(pid) || pid <= 0) ||
			!Number.isFinite(rssKb) ||
			rssKb < 0 ||
			!Number.isFinite(cpuPercent) ||
			cpuPercent < 0 ||
			!/^(?:\d+-)?\d{1,3}:\d{2}(?::\d{2})?$/.test(uptime)
		)
			continue;
		samples.set(pid, { rssMb: rssKb / 1024, cpuPercent, uptime });
	}
	return samples;
}

/** Sample every requested process with one ps invocation; a failed query is an empty sample. */
export async function sampleFleetResources(pids: readonly number[]): Promise<FleetResourceSamples> {
	const uniquePids = [...new Set(pids.filter(value => Number.isSafeInteger(value) && value > 0))];
	if (uniquePids.length === 0) return new Map();
	try {
		const output = await Effect.runPromise(
			bunPsExecutor({
				args: ["-o", "pid=,rss=,pcpu=,etime=", "-p", uniquePids.join(",")],
				timeoutMs: 2_000,
				maxOutputBytes: DEFAULT_STREAM_CAP_BYTES,
			}),
		);
		return decodeFleetResourceSamples(output);
	} catch {
		return new Map();
	}
}
