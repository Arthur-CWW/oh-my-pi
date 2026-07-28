import type { Schema } from "effect";
import { type WireResyncReason, WireResyncRequiredError } from "./errors";
import type { EventFrame, SnapshotChunkFrame } from "./frames";

export interface ReassembledWireSnapshot {
	readonly correlationId: string;
	readonly snapshotId: string;
	readonly baselineSeq: number;
	readonly pages: readonly (typeof Schema.Json.Type)[];
}

interface SnapshotState {
	readonly correlationId: string;
	readonly snapshotId: string;
	readonly baselineSeq: number;
	readonly chunkTotal: number;
	readonly pages: (typeof Schema.Json.Type)[];
	nextChunkIndex: number;
}

function resync(reason: WireResyncReason, message: string, expectedSequence: number, observedSequence: number): never {
	throw new WireResyncRequiredError({ reason, message, expectedSequence, observedSequence });
}

export class WireSnapshotReassembler {
	#state: SnapshotState | undefined;

	push(chunk: SnapshotChunkFrame): ReassembledWireSnapshot | undefined {
		let state = this.#state;
		if (!state) {
			if (chunk.chunkIndex !== 0) {
				resync("snapshot-chunk-order", "Snapshot must begin with chunk zero", 0, chunk.chunkIndex);
			}
			state = {
				correlationId: chunk.correlationId,
				snapshotId: chunk.snapshotId,
				baselineSeq: chunk.baselineSeq,
				chunkTotal: chunk.chunkTotal,
				pages: [],
				nextChunkIndex: 0,
			};
			this.#state = state;
		}

		if (chunk.snapshotId !== state.snapshotId || chunk.correlationId !== state.correlationId) {
			resync(
				"snapshot-identity-mismatch",
				"Snapshot chunk identity changed during reassembly",
				state.nextChunkIndex,
				chunk.chunkIndex,
			);
		}
		if (chunk.baselineSeq !== state.baselineSeq) {
			resync(
				"snapshot-baseline-mismatch",
				"Snapshot baseline changed during reassembly",
				state.baselineSeq,
				chunk.baselineSeq,
			);
		}
		if (chunk.chunkTotal !== state.chunkTotal) {
			resync(
				"snapshot-size-mismatch",
				"Snapshot chunk count changed during reassembly",
				state.chunkTotal,
				chunk.chunkTotal,
			);
		}
		if (chunk.chunkIndex !== state.nextChunkIndex) {
			resync("snapshot-chunk-order", "Snapshot chunks arrived out of order", state.nextChunkIndex, chunk.chunkIndex);
		}

		state.pages.push(chunk.page);
		state.nextChunkIndex += 1;
		if (state.nextChunkIndex !== state.chunkTotal) return undefined;

		this.#state = undefined;
		return {
			correlationId: state.correlationId,
			snapshotId: state.snapshotId,
			baselineSeq: state.baselineSeq,
			pages: state.pages,
		};
	}

	reset(): void {
		this.#state = undefined;
	}
}

export class WireEventSequenceTracker {
	#lastSequence: number;

	constructor(baselineSeq: number) {
		if (!Number.isInteger(baselineSeq) || baselineSeq < 0) {
			throw new RangeError("baselineSeq must be a non-negative integer");
		}
		this.#lastSequence = baselineSeq;
	}

	get lastSequence(): number {
		return this.#lastSequence;
	}

	accept(event: EventFrame): void {
		const expectedSequence = this.#lastSequence + 1;
		if (event.sequence !== expectedSequence) {
			resync(
				"event-sequence-gap",
				"Event sequence does not immediately follow the accepted baseline",
				expectedSequence,
				event.sequence,
			);
		}
		this.#lastSequence = event.sequence;
	}
}
