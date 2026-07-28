import { Result, Schema } from "effect"
import { createConnection, type Socket } from "node:net"
import { ControlChannelError } from "./errors"
import {
	type BarrierEvent,
	decodeGuestFrameLine,
	encodeGuestRequestLine,
	type GuestRequest,
	type GuestRequestBody,
	type JsonValue,
	type LogEvent,
	type ProcessExit,
	type ReadyEvent,
} from "./protocol"

interface PendingReply {
	readonly op: string
	readonly resolve: (result: JsonValue) => void
	readonly reject: (error: Error) => void
	readonly timer: ReturnType<typeof setTimeout>
}

/** The guest agent executed an operation and answered with a typed failure. */
export class GuestReplyFailure extends Error {
	readonly op: string
	readonly code: string
	readonly detail: string
	constructor(op: string, code: string, message: string, detail: string) {
		super(message)
		this.name = "GuestReplyFailure"
		this.op = op
		this.code = code
		this.detail = detail
	}
}

export interface ChannelWaiters {
	readonly onBarrier: (event: BarrierEvent) => void
	readonly onExit: (exit: ProcessExit) => void
	readonly onLog: (event: LogEvent) => void
}

export type ResultDecoder<A> = (value: JsonValue) => Result.Result<A, Schema.SchemaError>

/**
 * Newline-delimited JSON control channel to the in-guest agent over a virtio-serial port.
 *
 * The channel deliberately avoids the guest network: a scenario that partitions the guest's
 * links must not lose the ability to observe or steer the cell.
 */
export class GuestChannel {
	readonly #socket: Socket
	readonly #pending = new Map<number, PendingReply>()
	readonly #waiters: ChannelWaiters
	#ready: ReadyEvent | undefined
	#buffer = ""
	#nextId = 1
	#closed: ControlChannelError | undefined

	private constructor(socket: Socket, waiters: ChannelWaiters) {
		this.#socket = socket
		this.#waiters = waiters
		socket.setEncoding("utf8")
		socket.on("data", (chunk: string) => {
			this.#buffer += chunk
			let newline = this.#buffer.indexOf("\n")
			while (newline >= 0) {
				const line = this.#buffer.slice(0, newline).trim()
				this.#buffer = this.#buffer.slice(newline + 1)
				if (line.length > 0) this.#ingest(line)
				newline = this.#buffer.indexOf("\n")
			}
		})
		socket.on("close", () => {
			this.#fail(
				new ControlChannelError({ reason: "closed", message: "control channel closed by peer" }),
			)
		})
		socket.on("error", (error: Error) => {
			this.#fail(new ControlChannelError({ reason: "closed", message: error.message }))
		})
	}

	static connect(
		socketPath: string,
		waiters: ChannelWaiters,
		timeoutMs: number,
	): Promise<GuestChannel> {
		const { promise, resolve, reject } = Promise.withResolvers<GuestChannel>()
		const socket = createConnection({ path: socketPath })
		const timer = setTimeout(() => {
			socket.destroy()
			reject(
				new ControlChannelError({
					reason: "timeout",
					message: `control socket ${socketPath} did not accept a connection`,
				}),
			)
		}, timeoutMs)
		socket.once("connect", () => {
			clearTimeout(timer)
			resolve(new GuestChannel(socket, waiters))
		})
		socket.once("error", (error: Error) => {
			clearTimeout(timer)
			reject(new ControlChannelError({ reason: "closed", message: error.message }))
		})
		return promise
	}

	get ready(): ReadyEvent | undefined {
		return this.#ready
	}

	get closedWith(): ControlChannelError | undefined {
		return this.#closed
	}

	/**
	 * Issues one typed request and decodes the reply payload with the decoder the caller
	 * declared for that operation. A payload that does not match is a protocol error, never a
	 * partially populated value.
	 */
	async request<A>(
		body: GuestRequestBody,
		decode: ResultDecoder<A>,
		timeoutMs: number,
	): Promise<A> {
		if (this.#closed !== undefined) throw this.#closed
		const id = this.#nextId
		this.#nextId += 1
		const { promise, resolve, reject } = Promise.withResolvers<JsonValue>()
		const timer = setTimeout(() => {
			this.#pending.delete(id)
			reject(
				new ControlChannelError({
					reason: "timeout",
					message: `guest did not answer ${body.op} within ${timeoutMs}ms`,
				}),
			)
		}, timeoutMs)
		this.#pending.set(id, { op: body.op, resolve, reject, timer })
		this.#socket.write(`${encodeGuestRequestLine({ ...body, id } as GuestRequest)}\n`)
		const payload = await promise
		const decoded = decode(payload)
		if (Result.isFailure(decoded)) {
			throw new ControlChannelError({
				reason: "undecodable",
				message: `guest result for ${body.op} does not match its declared schema`,
				frame: JSON.stringify(payload).slice(0, 512),
			})
		}
		return decoded.success
	}

	close(): void {
		this.#socket.destroy()
	}

	#fail(error: ControlChannelError): void {
		if (this.#closed !== undefined) return
		this.#closed = error
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(error)
		}
		this.#pending.clear()
	}

	#ingest(line: string): void {
		const decoded = decodeGuestFrameLine(line)
		if (Result.isFailure(decoded)) {
			this.#fail(
				new ControlChannelError({
					reason: "undecodable",
					message: "guest emitted a frame that does not match the control protocol",
					frame: line.slice(0, 512),
				}),
			)
			return
		}
		const frame = decoded.success
		if (frame.kind === "event") {
			if (frame.event === "barrier") this.#waiters.onBarrier(frame)
			else if (frame.event === "exit") this.#waiters.onExit(frame.exit)
			else if (frame.event === "log") this.#waiters.onLog(frame)
			else this.#ready = frame
			return
		}
		const pending = this.#pending.get(frame.id)
		if (pending === undefined) {
			this.#fail(
				new ControlChannelError({
					reason: "protocol",
					message: `guest replied to unknown request id ${frame.id}`,
					frame: line.slice(0, 512),
				}),
			)
			return
		}
		this.#pending.delete(frame.id)
		clearTimeout(pending.timer)
		if (frame.ok) pending.resolve(frame.result)
		else
			pending.reject(
				new GuestReplyFailure(frame.op, frame.error.code, frame.error.message, frame.error.detail),
			)
	}
}
