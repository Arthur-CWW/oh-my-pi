import { Result, Schema } from "effect"
import { createConnection, type Socket } from "node:net"
import { CellProvisionError, ControlChannelError } from "./errors"
import { decodeQmpFrameLine, type JsonValue, type QmpKvm, QmpKvmSchema, type QmpVersion } from "./protocol"

const decodeKvm = Schema.decodeUnknownResult(QmpKvmSchema)

interface QmpPending {
	readonly resolve: (value: JsonValue) => void
	readonly reject: (error: Error) => void
}

/**
 * Minimal QMP client. Its only job in this package is to answer, from inside the running
 * machine, whether the run is hardware accelerated — QEMU falls back from KVM to TCG
 * silently, and a manifest that guesses from `/dev/kvm` would be lying.
 */
export class QmpClient {
	readonly #socket: Socket
	readonly #queue: QmpPending[] = []
	#buffer = ""
	#version: QmpVersion | undefined

	private constructor(socket: Socket) {
		this.#socket = socket
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
	}

	static connect(socketPath: string, timeoutMs: number): Promise<QmpClient> {
		const { promise, resolve, reject } = Promise.withResolvers<QmpClient>()
		const socket = createConnection({ path: socketPath })
		const timer = setTimeout(() => {
			socket.destroy()
			reject(
				new CellProvisionError({
					phase: "connect",
					message: `qmp socket ${socketPath} did not accept a connection`,
				}),
			)
		}, timeoutMs)
		socket.once("connect", () => {
			clearTimeout(timer)
			resolve(new QmpClient(socket))
		})
		socket.once("error", (error: Error) => {
			clearTimeout(timer)
			reject(new CellProvisionError({ phase: "connect", message: error.message }))
		})
		return promise
	}

	get qemuVersion(): QmpVersion | undefined {
		return this.#version
	}

	async handshake(timeoutMs: number): Promise<void> {
		await this.#execute("qmp_capabilities", timeoutMs)
	}

	/** Authoritative acceleration read: `enabled` is false whenever QEMU fell back to TCG. */
	async queryKvm(timeoutMs: number): Promise<QmpKvm> {
		const payload = await this.#execute("query-kvm", timeoutMs)
		const decoded = decodeKvm(payload)
		if (Result.isFailure(decoded)) {
			throw new ControlChannelError({
				reason: "undecodable",
				message: "qmp query-kvm returned an unexpected shape",
				frame: JSON.stringify(payload).slice(0, 256),
			})
		}
		return decoded.success
	}

	close(): void {
		this.#socket.destroy()
	}

	#execute(command: string, timeoutMs: number): Promise<JsonValue> {
		const { promise, resolve, reject } = Promise.withResolvers<JsonValue>()
		const timer = setTimeout(() => {
			reject(
				new ControlChannelError({
					reason: "timeout",
					message: `qmp ${command} did not answer within ${timeoutMs}ms`,
				}),
			)
		}, timeoutMs)
		this.#queue.push({
			resolve: (value) => {
				clearTimeout(timer)
				resolve(value)
			},
			reject: (error) => {
				clearTimeout(timer)
				reject(error)
			},
		})
		this.#socket.write(`${JSON.stringify({ execute: command })}\n`)
		return promise
	}

	#ingest(line: string): void {
		const decoded = decodeQmpFrameLine(line)
		if (Result.isFailure(decoded)) return
		const frame = decoded.success
		if ("QMP" in frame) {
			this.#version = frame.QMP.version
			return
		}
		if ("event" in frame) return
		const pending = this.#queue.shift()
		if (pending === undefined) return
		if ("error" in frame) {
			pending.reject(
				new ControlChannelError({
					reason: "protocol",
					message: `${frame.error.class}: ${frame.error.desc}`,
				}),
			)
			return
		}
		pending.resolve(frame.return)
	}
}
