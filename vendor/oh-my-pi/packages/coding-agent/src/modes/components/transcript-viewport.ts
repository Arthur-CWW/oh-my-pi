/**
 * Scroll state for a transcript whose backing rows remain fully reachable while
 * each render materializes only the current viewport window.
 */
export class TranscriptViewportModel<Row> {
	#rows: readonly Row[] = [];
	#offset = 0;
	#height = 1;
	#followTail = true;

	get offset(): number {
		return this.#offset;
	}

	get height(): number {
		return this.#height;
	}

	get totalRows(): number {
		return this.#rows.length;
	}

	get maxOffset(): number {
		return Math.max(0, this.#rows.length - this.#height);
	}

	get atBottom(): boolean {
		return this.#offset >= this.maxOffset;
	}

	get followsTail(): boolean {
		return this.#followTail;
	}

	get visibleRowCount(): number {
		return Math.min(this.#height, Math.max(0, this.#rows.length - this.#offset));
	}

	layout(rows: readonly Row[], height: number, followBottom: boolean): void {
		this.#rows = rows;
		this.#height = Math.max(1, height);
		const maxOffset = this.maxOffset;
		this.#offset = followBottom && this.#followTail ? maxOffset : Math.min(this.#offset, maxOffset);
	}

	reset(): void {
		this.#rows = [];
		this.#offset = 0;
		this.#height = 1;
		this.#followTail = true;
	}

	setOffset(offset: number): void {
		this.#offset = Math.max(0, Math.min(offset, this.maxOffset));
		this.#followTail = false;
	}

	scrollBy(delta: number): void {
		this.#offset = Math.max(0, Math.min(this.#offset + delta, this.maxOffset));
		this.#followTail = delta > 0 && this.#offset >= this.maxOffset;
	}

	scrollToTop(): void {
		this.#offset = 0;
		this.#followTail = false;
	}

	scrollToBottom(): void {
		this.#offset = this.maxOffset;
		this.#followTail = true;
	}

	visibleRows(): readonly Row[] {
		return this.#rows.slice(this.#offset, this.#offset + this.#height);
	}
}
