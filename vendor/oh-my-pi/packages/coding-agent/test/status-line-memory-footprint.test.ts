import { describe, expect, it } from "bun:test";
import {
	MEMORY_SAMPLE_INTERVAL_MS,
	MemoryFootprintSampler,
} from "@oh-my-pi/pi-coding-agent/modes/components/status-line/memory-footprint";

const GIB = 1024 ** 3;

describe("status-line memory footprint view model", () => {
	it("is absent below the watermark", () => {
		const sampler = new MemoryFootprintSampler({ readRss: () => 4 * GIB - 1, now: () => 0 });
		expect(sampler.getBadge(4 * GIB)).toBeNull();
	});

	it("formats RSS at the watermark with one-decimal GiB rounding", () => {
		const sampler = new MemoryFootprintSampler({ readRss: () => 6.24 * GIB, now: () => 0 });
		expect(sampler.getBadge(4 * GIB)).toBe("mem 6.2G ↻ /restart reclaims");
	});

	it("is absent when disabled without sampling RSS", () => {
		let reads = 0;
		const sampler = new MemoryFootprintSampler({
			readRss: () => {
				reads++;
				return 20 * GIB;
			},
			now: () => 0,
		});
		expect(sampler.getBadge(0)).toBeNull();
		expect(reads).toBe(0);
	});

	it("reuses the sampled RSS until ten seconds have elapsed", () => {
		let now = 1_000;
		let rss = 3 * GIB;
		let reads = 0;
		const sampler = new MemoryFootprintSampler({
			readRss: () => {
				reads++;
				return rss;
			},
			now: () => now,
		});

		expect(sampler.getBadge(4 * GIB)).toBeNull();
		rss = 6.24 * GIB;
		now += MEMORY_SAMPLE_INTERVAL_MS - 1;
		expect(sampler.getBadge(4 * GIB)).toBeNull();
		expect(reads).toBe(1);

		now++;
		expect(sampler.getBadge(4 * GIB)).toBe("mem 6.2G ↻ /restart reclaims");
		expect(reads).toBe(2);
	});
});
