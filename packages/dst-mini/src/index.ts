export interface DstRunOptions {
  seed: number
  steps?: number
  mode?: "buggy" | "fixed"
  networkDropRate?: number
  verbose?: boolean
}

export interface DstViolation {
  property: string
  message: string
  details: Record<string, unknown>
}

export interface DstRunResult {
  ok: boolean
  seed: number
  mode: "buggy" | "fixed"
  steps: number
  ackedWrites: number[]
  persistedByNode: Record<string, number[]>
  violations: DstViolation[]
  replay: string
  trace: string[]
}

type EventCallback = () => void

interface SimEvent {
  at: number
  order: number
  label: string
  callback: EventCallback
}

export class XorShift32 {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) this.state = 0x9e3779b9
  }

  nextUint32(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state
  }

  float(): number {
    return this.nextUint32() / 0x1_0000_0000
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error(`maxExclusive must be positive, got ${maxExclusive}`)
    return Math.floor(this.float() * maxExclusive)
  }

  chance(probability: number): boolean {
    return this.float() < probability
  }

  choose<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot choose from an empty array")
    return items[this.int(items.length)]
  }
}

export class DeterministicSim {
  readonly rng: XorShift32
  now = 0
  trace: string[] = []

  private events: SimEvent[] = []
  private nextOrder = 0

  constructor(readonly seed: number, readonly verbose = false) {
    this.rng = new XorShift32(seed)
  }

  schedule(delay: number, label: string, callback: EventCallback): void {
    if (!Number.isFinite(delay) || delay < 0) throw new Error(`Invalid delay ${delay}`)
    const event = {
      at: this.now + Math.floor(delay),
      order: this.nextOrder++,
      label,
      callback,
    }
    this.events.push(event)
    this.events.sort((a, b) => a.at - b.at || a.order - b.order)
  }

  runUntilIdle(maxEvents = 100_000): void {
    let processed = 0
    while (this.events.length > 0) {
      if (processed++ >= maxEvents) throw new Error(`Simulation exceeded ${maxEvents} events`)
      const event = this.events.shift()
      if (!event) break
      this.now = event.at
      this.log(`@${this.now} ${event.label}`)
      event.callback()
    }
  }

  runNext(): boolean {
    const event = this.events.shift()
    if (!event) return false
    this.now = event.at
    this.log(`@${this.now} ${event.label}`)
    event.callback()
    return true
  }

  pendingEvents(): number {
    return this.events.length
  }

  log(message: string): void {
    if (this.verbose) this.trace.push(message)
  }
}

type NodeId = "n0" | "n1" | "n2"

type Message =
  | { type: "append"; writeId: number }
  | { type: "append-ack"; writeId: number; from: NodeId }

interface NodeState {
  id: NodeId
  up: boolean
  persisted: Set<number>
}

interface PendingWrite {
  writeId: number
  acks: Set<NodeId>
  acked: boolean
}

class SimulatedNetwork {
  private blocked = new Set<string>()

  constructor(private readonly sim: DeterministicSim, private readonly dropRate: number) {}

  send(from: NodeId, to: NodeId, payload: Message, deliver: (to: NodeId, payload: Message) => void): void {
    if (this.isBlocked(from, to)) {
      this.sim.log(`net block ${from}->${to} ${payload.type}:${payload.writeId}`)
      return
    }
    if (this.sim.rng.chance(this.dropRate)) {
      this.sim.log(`net drop ${from}->${to} ${payload.type}:${payload.writeId}`)
      return
    }

    const delay = 1 + this.sim.rng.int(7)
    this.sim.schedule(delay, `deliver ${payload.type}:${payload.writeId} ${from}->${to}`, () => deliver(to, payload))

    if (this.sim.rng.chance(0.05)) {
      const duplicateDelay = delay + 1 + this.sim.rng.int(5)
      this.sim.schedule(duplicateDelay, `duplicate ${payload.type}:${payload.writeId} ${from}->${to}`, () => deliver(to, payload))
    }
  }

  partition(a: NodeId, b: NodeId): void {
    this.blocked.add(edge(a, b))
    this.blocked.add(edge(b, a))
    this.sim.log(`partition ${a}<->${b}`)
  }

  heal(): void {
    this.blocked.clear()
    this.sim.log("network healed")
  }

  private isBlocked(from: NodeId, to: NodeId): boolean {
    return this.blocked.has(edge(from, to))
  }
}

function edge(a: NodeId, b: NodeId): string {
  return `${a}->${b}`
}

class ReplicatedLogCluster {
  readonly nodeIds: NodeId[] = ["n0", "n1", "n2"]
  readonly nodes = new Map<NodeId, NodeState>()
  readonly pending = new Map<number, PendingWrite>()
  readonly ackedWrites: number[] = []
  readonly network: SimulatedNetwork

  private nextWriteId = 0
  private primary: NodeId = "n0"

  constructor(
    private readonly sim: DeterministicSim,
    private readonly mode: "buggy" | "fixed",
    networkDropRate: number,
  ) {
    for (const id of this.nodeIds) this.nodes.set(id, { id, up: true, persisted: new Set() })
    this.network = new SimulatedNetwork(sim, networkDropRate)
  }

  append(): void {
    const primary = this.getNode(this.primary)
    if (!primary.up) {
      this.sim.log("client write failed: primary down")
      return
    }

    const writeId = ++this.nextWriteId
    const pending: PendingWrite = { writeId, acks: new Set(), acked: false }
    this.pending.set(writeId, pending)

    if (this.mode === "buggy") {
      // Intentional brown M&M: acknowledge before the write is durable anywhere.
      this.ackClient(writeId, "buggy-pre-durable-ack")
    }

    this.persistLater(this.primary, writeId, () => this.onPersistedAtPrimary(writeId))
    for (const replica of this.nodeIds.filter((id) => id !== this.primary)) {
      this.network.send(this.primary, replica, { type: "append", writeId }, (to, payload) => this.receive(to, payload))
    }
  }

  crash(id: NodeId): void {
    const node = this.getNode(id)
    node.up = false
    this.sim.log(`crash ${id}`)
  }

  recover(id: NodeId): void {
    const node = this.getNode(id)
    node.up = true
    this.sim.log(`recover ${id}`)
  }

  healAndRecoverAll(): void {
    this.network.heal()
    for (const id of this.nodeIds) this.recover(id)
  }

  persistedByNode(): Record<string, number[]> {
    const result: Record<string, number[]> = {}
    for (const id of this.nodeIds) result[id] = [...this.getNode(id).persisted].sort((a, b) => a - b)
    return result
  }

  checkDurableAckInvariant(): DstViolation[] {
    const violations: DstViolation[] = []
    for (const writeId of this.ackedWrites) {
      const holders = this.nodeIds.filter((id) => this.getNode(id).persisted.has(writeId))
      if (holders.length < 2) {
        violations.push({
          property: "acked writes survive primary crash and partition faults",
          message: `acknowledged write ${writeId} exists on ${holders.length}/3 replicas`,
          details: { writeId, holders, ackedWrites: this.ackedWrites, persistedByNode: this.persistedByNode() },
        })
      }
    }
    return violations
  }

  private receive(to: NodeId, payload: Message): void {
    const node = this.getNode(to)
    if (!node.up) {
      this.sim.log(`message lost at down node ${to}: ${payload.type}:${payload.writeId}`)
      return
    }

    if (payload.type === "append") {
      this.persistLater(to, payload.writeId, () => {
        this.network.send(to, this.primary, { type: "append-ack", writeId: payload.writeId, from: to }, (target, ack) =>
          this.receive(target, ack),
        )
      })
      return
    }

    if (payload.type === "append-ack") {
      const pending = this.pending.get(payload.writeId)
      if (!pending) return
      pending.acks.add(payload.from)
      this.maybeAckFixed(pending)
    }
  }

  private persistLater(id: NodeId, writeId: number, afterPersist: () => void): void {
    const delay = 1 + this.sim.rng.int(5)
    this.sim.schedule(delay, `persist ${writeId} on ${id}`, () => {
      const node = this.getNode(id)
      if (!node.up) {
        this.sim.log(`persist lost: ${id} down for write ${writeId}`)
        return
      }
      node.persisted.add(writeId)
      this.sim.log(`persisted ${writeId} on ${id}`)
      afterPersist()
    })
  }

  private onPersistedAtPrimary(writeId: number): void {
    const pending = this.pending.get(writeId)
    if (!pending) return
    pending.acks.add(this.primary)
    this.maybeAckFixed(pending)
  }

  private maybeAckFixed(pending: PendingWrite): void {
    if (this.mode !== "fixed") return
    if (pending.acked) return
    if (!this.getNode(this.primary).up) return
    if (pending.acks.size >= 2) this.ackClient(pending.writeId, "fixed-quorum-ack")
  }

  private ackClient(writeId: number, reason: string): void {
    const pending = this.pending.get(writeId)
    if (pending) pending.acked = true
    if (!this.ackedWrites.includes(writeId)) this.ackedWrites.push(writeId)
    this.sim.log(`ack ${writeId} ${reason}`)
  }

  private getNode(id: NodeId): NodeState {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`unknown node ${id}`)
    return node
  }
}

export function runReplicatedLogSimulation(options: DstRunOptions): DstRunResult {
  const mode = options.mode ?? "buggy"
  const steps = options.steps ?? 80
  const sim = new DeterministicSim(options.seed, options.verbose ?? false)
  const cluster = new ReplicatedLogCluster(sim, mode, options.networkDropRate ?? 0.03)

  for (let i = 0; i < steps; i++) {
    const delay = 1 + sim.rng.int(4)
    sim.schedule(delay, `workload step ${i}`, () => {
      const choice = sim.rng.int(100)
      if (choice < 45) {
        cluster.append()
      } else if (choice < 62) {
        cluster.crash(sim.rng.choose(cluster.nodeIds))
      } else if (choice < 79) {
        cluster.recover(sim.rng.choose(cluster.nodeIds))
      } else if (choice < 91) {
        const a = sim.rng.choose(cluster.nodeIds)
        const b = sim.rng.choose(cluster.nodeIds.filter((id) => id !== a))
        cluster.network.partition(a, b)
      } else {
        cluster.network.heal()
      }
    })
    sim.runNext()
  }

  sim.runUntilIdle()
  cluster.healAndRecoverAll()
  sim.runUntilIdle()

  const violations = cluster.checkDurableAckInvariant()
  return {
    ok: violations.length === 0,
    seed: options.seed,
    mode,
    steps,
    ackedWrites: [...cluster.ackedWrites].sort((a, b) => a - b),
    persistedByNode: cluster.persistedByNode(),
    violations,
    replay: `bun packages/dst-mini/src/cli.ts --${mode} --seed ${options.seed} --steps ${steps} --verbose`,
    trace: sim.trace,
  }
}

export interface DstSearchOptions extends Omit<DstRunOptions, "seed"> {
  seeds: number
  startSeed?: number
}

export interface DstSearchResult {
  ok: boolean
  checked: number
  firstFailure?: DstRunResult
}

export function searchReplicatedLog(options: DstSearchOptions): DstSearchResult {
  const startSeed = options.startSeed ?? 1
  for (let i = 0; i < options.seeds; i++) {
    const seed = startSeed + i
    const result = runReplicatedLogSimulation({ ...options, seed, verbose: false })
    if (!result.ok) return { ok: false, checked: i + 1, firstFailure: result }
  }
  return { ok: true, checked: options.seeds }
}
