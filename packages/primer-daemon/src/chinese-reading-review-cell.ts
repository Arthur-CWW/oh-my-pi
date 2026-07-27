import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Database } from "bun:sqlite"

import { addCard, openLedger } from "./ledger"
import type { ValidationCellReceipt } from "./validation-cell-contract"
import type { ValidationCellContext } from "./validation-cell-runner"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)))
const SERVER_SCRIPT = join(PACKAGE_ROOT, "scripts/validation-server.ts")
const SYNTHETIC_TITLE = "Primer validation：可验证的复习"
const SYNTHETIC_PARAGRAPHS = ["学习会留下可验证的痕迹。", "复习让记忆逐渐稳固。"] as const
const SYNTHETIC_TEXT = SYNTHETIC_PARAGRAPHS.join("\n")
const MARKED_WORD = "复习"
const MARK_PARAGRAPH_INDEX = 1
const MARK_START = 0
const MARK_END = MARK_START + MARKED_WORD.length
const CARD_BACK = "通过间隔提取，让记忆变得更稳固。"
const SOURCE_URL = "https://example.invalid/primer-validation/chinese-reading-review"
const RESTART_ADVANCE_MS = 366 * 86_400_000
const SERVER_CLEANUP_GRACE_MS = 1_000

interface AssertionReceipt {
  id: string
  status: "passed"
  detail: string
}

interface ReadyMessage {
  type: "primer-validation-ready"
  pid: number
  port: number
}

interface RunningValidationServer {
  child: Bun.Subprocess<"ignore", "pipe", "pipe">
  pid: number
  port: number
  stdoutDone: Promise<void>
  stderrDone: Promise<void>
  settled: boolean
}

interface CellRuntime {
  context: ValidationCellContext
  workspace: string
  deadline: number
  httpRequests: number
  sqliteWrites: number
  processStarts: number
  restarts: number
  stateAssertions: AssertionReceipt[]
  processAssertions: AssertionReceipt[]
  running: RunningValidationServer[]
}

interface CreatedDocResponse {
  id: number
  paragraphCount: number
}

interface QueueProvenanceResponse {
  docId: number
  docTitle: string
  markId: number | null
  paragraphIdx: number
  start: number
  end: number
  sentence: string
}

interface QueueItemResponse {
  id: number
  word: string
  status: string
  provenance: QueueProvenanceResponse | null
}

interface CreatedMarkResponse {
  markId: number
  queueItem: QueueItemResponse
}

interface CardResponse {
  id: number
  front: string
  sourceRef: string | null
  url: string | null
  status: string
  enrolled?: boolean
}

interface EnrollmentResponse {
  itemId: number
  itemKind: string
  due: string
  stateVersion: number
}

interface GradeResponse {
  itemId: number
  itemKind: string
  eventId: number
  due: string
  state: string
  reps: number
}

interface ReviewSessionItemResponse {
  queueItemId: number
  itemKind: string
  word: string
  phase: string
  due: string | null
  provenance: QueueProvenanceResponse | null
}

interface ReviewSessionResponse {
  items: ReviewSessionItemResponse[]
  mode: string
}

interface ReviewEventResponse {
  id: number
  itemKind: string
  itemId: number
  grade: string
  failReason: string | null
  eventTime: string
}

interface ReadingDocResponse {
  id: number
  title: string
  paragraphs: string[]
  marks: Array<{ id: number; paragraphIdx: number; start: number; end: number; surface: string }>
}

interface PersistedState {
  due: string
  state: string
  stateVersion: number
  eventGrades: string[]
  cardCount: number
}

type ValidationCellBudget = "timeoutMs" | "maxHttpRequests" | "maxProcessStarts" | "maxRestarts"

export class ValidationCellBudgetExceededError extends Error {
  readonly name = "ValidationCellBudgetExceededError"

  constructor(
    readonly budget: ValidationCellBudget,
    readonly limit: number,
    readonly observed: number,
    operation?: string,
  ) {
    super(`validation ${budget} budget exceeded (${observed} > ${limit})${operation === undefined ? "" : ` during ${operation}`}`)
  }
}

export class ValidationCellLayerNotImplementedError extends Error {
  readonly name = "ValidationCellLayerNotImplementedError"

  constructor(readonly layer: "browser") {
    super(`required validation layer is not implemented: ${layer}`)
  }
}

class CellInvariantError extends Error {
  constructor(readonly invariant: string) {
    super(invariant)
  }
}

export async function executeChineseReadingReviewCell(context: ValidationCellContext): Promise<ValidationCellReceipt> {
  const startedAt = performance.now()
  const workspace = mkdtempSync(join(tmpdir(), "primer-validation-cell-"))
  chmodSync(workspace, 0o700)
  const runtime: CellRuntime = {
    context,
    workspace,
    deadline: startedAt + context.manifest.budget.timeoutMs,
    httpRequests: 0,
    sqliteWrites: 0,
    processStarts: 0,
    restarts: 0,
    stateAssertions: [],
    processAssertions: [],
    running: [],
  }
  let firstPid = 1
  let restartPid = 2
  let finalDue = context.manifest.entropyControls.logicalClock.start
  let observedNegativeFailure = ""
  const browserLayer = context.manifest.layers.browser

  try {
    if (browserLayer.status === "required") throw new ValidationCellLayerNotImplementedError("browser")
    remainingTimeout(runtime)
    const positiveRoot = join(workspace, "positive")
    const positiveLedger = join(positiveRoot, "state", "primer.sqlite")
    const firstEnv = makeServerEnv(runtime, positiveRoot, positiveLedger, context.manifest.entropyControls.logicalClock.start)
    const firstServer = await startServer(runtime, firstEnv, "positive-before-restart")
    firstPid = firstServer.pid

    await requestJson(runtime, firstServer, "GET", context.manifest.scenario.server.readinessPath)
    const createdDoc = await requestJson<CreatedDocResponse>(runtime, firstServer, "POST", "/api/reader/docs", {
      title: SYNTHETIC_TITLE,
      text: SYNTHETIC_TEXT,
      lang: "zh-CN",
    })
    assertState(runtime, createdDoc.paragraphCount === 2, "reader-document-created", "The synthetic Chinese document has two durable paragraphs.")

    const createdMark = await requestJson<CreatedMarkResponse>(runtime, firstServer, "POST", "/api/reader/marks", {
      docId: createdDoc.id,
      paragraphIdx: MARK_PARAGRAPH_INDEX,
      start: MARK_START,
      end: MARK_END,
      surface: MARKED_WORD,
      sentence: SYNTHETIC_PARAGRAPHS[MARK_PARAGRAPH_INDEX],
      kind: "manual",
    })
    const provenance = createdMark.queueItem.provenance
    assertState(
      runtime,
      createdMark.queueItem.word === MARKED_WORD
        && provenance?.docId === createdDoc.id
        && provenance.markId === createdMark.markId
        && provenance.paragraphIdx === MARK_PARAGRAPH_INDEX
        && provenance.start === MARK_START
        && provenance.end === MARK_END
        && provenance.sentence === SYNTHETIC_PARAGRAPHS[MARK_PARAGRAPH_INDEX],
      "reader-provenance-created",
      "The queue item resolves to the synthetic document, mark, exact span, and source sentence.",
    )

    const queue = await requestJson<QueueItemResponse[]>(runtime, firstServer, "GET", "/api/queue?status=all&limit=10")
    assertState(runtime, queue.length === 1 && queue[0]?.id === createdMark.queueItem.id, "queue-deduplicated", "Exactly one queue item exists for the marked word.")
    const initialSession = await requestJson<ReviewSessionResponse>(runtime, firstServer, "GET", "/api/review/session?limit=10&explain=1")
    const initialQueueItem = initialSession.items.find((item) => item.itemKind === "queue_item" && item.queueItemId === createdMark.queueItem.id)
    assertState(
      runtime,
      initialQueueItem?.phase === "new" && initialQueueItem.provenance?.markId === createdMark.markId,
      "session-carries-provenance",
      "The real review-session API exposes the NEW queue item with reader provenance.",
    )

    const sourceRef = `reader:doc:${createdDoc.id}:mark:${createdMark.markId}`
    const seedDb = openLedger(positiveLedger)
    let cardId: number
    try {
      const seedTime = new Date(Date.parse(context.manifest.entropyControls.logicalClock.start) + 500)
      cardId = addCard(seedDb, { front: MARKED_WORD, back: CARD_BACK, sourceRef, url: SOURCE_URL }, seedTime).id
      runtime.sqliteWrites += 1
    } finally {
      seedDb.close()
    }
    const candidateCards = await requestJson<CardResponse[]>(runtime, firstServer, "GET", "/api/cards?status=candidate&limit=10")
    assertState(
      runtime,
      candidateCards.length === 1
        && candidateCards[0]?.id === cardId
        && candidateCards[0].sourceRef === sourceRef
        && candidateCards[0].url === SOURCE_URL,
      "card-intake-provenance",
      "The production card intake row retains the reader document/mark reference and synthetic source URL.",
    )

    const approved = await requestJson<CardResponse>(runtime, firstServer, "POST", "/api/cards/status", { id: cardId, status: "approved" })
    assertState(runtime, approved.status === "approved", "card-approved", "The candidate crosses the explicit approved state before enrollment.")
    const enrolled = await requestJson<EnrollmentResponse>(runtime, firstServer, "POST", "/api/review/enroll", { cardId })
    assertState(
      runtime,
      enrolled.itemId === cardId && enrolled.itemKind === "card_candidate" && enrolled.stateVersion === 0,
      "card-enrolled-once",
      "The approved card is enrolled once with a version-zero real scheduler row.",
    )

    const gradeInputs = [
      { grade: "again", failReason: "forgot" },
      { grade: "hard" },
      { grade: "good" },
    ] as const
    const grades: GradeResponse[] = []
    for (const gradeInput of gradeInputs) {
      grades.push(await requestJson<GradeResponse>(runtime, firstServer, "POST", "/api/review/grade", {
        queueItemId: cardId,
        itemKind: "card_candidate",
        ...gradeInput,
      }))
    }
    const dueTimes = grades.map((grade) => Date.parse(grade.due))
    assertState(
      runtime,
      dueTimes.every(Number.isFinite) && dueTimes.slice(1).every((due, index) => due > (dueTimes[index] ?? Number.POSITIVE_INFINITY)),
      "scheduler-due-monotonic",
      "Again, Hard, and Good produce strictly increasing finite due times under the fixed logical clock.",
    )
    assertState(
      runtime,
      grades.map((grade) => grade.reps).join(",") === "1,2,3" && grades.every((grade) => grade.itemKind === "card_candidate"),
      "scheduler-grade-transition",
      "The three scheduler branches advance review repetitions from one through three for the enrolled card.",
    )
    finalDue = grades[2]?.due ?? finalDue

    const eventsBeforeRestart = await requestJson<ReviewEventResponse[]>(runtime, firstServer, "GET", "/api/review/events?limit=10")
    assertState(
      runtime,
      [...eventsBeforeRestart].reverse().map((event) => event.grade).join(",") === "again,hard,good"
        && eventsBeforeRestart.some((event) => event.grade === "again" && event.failReason === "forgot"),
      "review-events-versioned",
      "Append-only review events preserve the Again/Hard/Good branch order and failure reason.",
    )
    const allCardsBeforeRestart = await requestJson<CardResponse[]>(runtime, firstServer, "GET", "/api/cards?status=all&limit=10")
    assertState(runtime, allCardsBeforeRestart.length === 1 && allCardsBeforeRestart[0]?.enrolled === true, "no-duplicate-card", "Approval, enrollment, and grading leave exactly one enrolled card candidate.")

    await stopServer(runtime, firstServer)
    appendServerErrors(runtime, firstEnv.PRIMER_ERROR_LOG, "positive-before-restart")

    const negativeRoot = join(workspace, "negative")
    const negativeLedger = join(negativeRoot, "state", "primer.sqlite")
    mkdirSync(dirname(negativeLedger), { recursive: true })
    checkpoint(positiveLedger)
    copyFileSync(positiveLedger, negativeLedger)
    const negativeDb = new Database(negativeLedger)
    try {
      const mutation = negativeDb.query("DELETE FROM review_state WHERE item_kind = 'card_candidate' AND item_id = ?").run(cardId)
      if (mutation.changes !== 1) throw new Error("negative control did not remove exactly one scheduler row")
      runtime.sqliteWrites += 1
    } finally {
      negativeDb.close()
    }

    const restartTime = new Date(Date.parse(context.manifest.entropyControls.logicalClock.start) + RESTART_ADVANCE_MS).toISOString()
    const restartEnv = makeServerEnv(runtime, positiveRoot, positiveLedger, restartTime)
    const restartedServer = await restartServer(runtime, restartEnv, "positive-after-restart")
    restartPid = restartedServer.pid
    await requestJson(runtime, restartedServer, "GET", context.manifest.scenario.server.readinessPath)
    const readerAfterRestart = await requestJson<ReadingDocResponse>(runtime, restartedServer, "GET", `/api/reader/docs/${createdDoc.id}`)
    assertState(
      runtime,
      readerAfterRestart.title === SYNTHETIC_TITLE
        && readerAfterRestart.paragraphs.join("\n") === SYNTHETIC_TEXT
        && readerAfterRestart.marks.some((mark) =>
          mark.id === createdMark.markId
            && mark.paragraphIdx === MARK_PARAGRAPH_INDEX
            && mark.start === MARK_START
            && mark.end === MARK_END
            && mark.surface === MARKED_WORD
        ),
      "reader-durable-after-restart",
      "The restarted reader API returns the original synthetic document and exact persisted mark span.",
    )
    const queueAfterRestart = await requestJson<QueueItemResponse[]>(runtime, restartedServer, "GET", "/api/queue?status=all&limit=10")
    const markedQueueItem = queueAfterRestart.find((item) => item.id === createdMark.queueItem.id)
    assertState(
      runtime,
      markedQueueItem?.word === MARKED_WORD
        && markedQueueItem.provenance?.docId === createdDoc.id
        && markedQueueItem.provenance.markId === createdMark.markId
        && markedQueueItem.provenance.paragraphIdx === MARK_PARAGRAPH_INDEX
        && markedQueueItem.provenance.start === MARK_START
        && markedQueueItem.provenance.end === MARK_END
        && markedQueueItem.provenance.sentence === SYNTHETIC_PARAGRAPHS[MARK_PARAGRAPH_INDEX],
      "queue-provenance-durable-after-restart",
      "The restarted queue API returns the exact document, mark, paragraph, span, and sentence provenance.",
    )
    const persisted = inspectPersistedState(
      runtime,
      positiveLedger,
      createdDoc.id,
      createdMark.markId,
      createdMark.queueItem.id,
      cardId,
      sourceRef,
      finalDue,
    )
    const enrolledAfterRestart = await requestJson<CardResponse[]>(runtime, restartedServer, "GET", "/api/cards?status=enrolled&limit=10")
    assertState(
      runtime,
      enrolledAfterRestart.length === 1 && enrolledAfterRestart[0]?.id === cardId && enrolledAfterRestart[0].sourceRef === sourceRef,
      "card-durable-after-restart",
      "The restarted API returns exactly one enrolled provenance-bearing card.",
    )
    const sessionAfterRestart = await requestJson<ReviewSessionResponse>(runtime, restartedServer, "GET", "/api/review/session?limit=10")
    const persistedCard = sessionAfterRestart.items.find((item) => item.itemKind === "card_candidate" && item.queueItemId === cardId)
    assertState(
      runtime,
      persistedCard?.due === persisted.due && persistedCard.phase === "due",
      "scheduler-durable-after-restart",
      "The restarted review-session API returns the exact committed scheduler due timestamp.",
    )
    if (persistedCard?.due === null || persistedCard?.due === undefined) throw new Error("restarted scheduler due timestamp is missing")
    const eventsAfterRestart = await requestJson<ReviewEventResponse[]>(runtime, restartedServer, "GET", "/api/review/events?limit=10")
    assertState(
      runtime,
      eventsAfterRestart.length === 3 && persisted.eventGrades.join(",") === "again,hard,good",
      "event-history-durable-after-restart",
      "The restarted API returns all three review events without duplication.",
    )
    await stopServer(runtime, restartedServer)
    appendServerErrors(runtime, restartEnv.PRIMER_ERROR_LOG, "positive-after-restart")

    const negativeEnv = makeServerEnv(runtime, negativeRoot, negativeLedger, restartTime)
    const negativeServer = await startServer(runtime, negativeEnv, "negative-control")
    await requestJson(runtime, negativeServer, "GET", context.manifest.scenario.server.readinessPath)
    const negativeSession = await requestJson<ReviewSessionResponse>(runtime, negativeServer, "GET", "/api/review/session?limit=10")
    try {
      const negativeCard = negativeSession.items.find((item) => item.itemKind === "card_candidate" && item.queueItemId === cardId)
      if (negativeCard?.due !== finalDue) throw new CellInvariantError(context.manifest.negativeControl.expectedInvariantFailure)
      throw new Error("negative control unexpectedly preserved scheduler state")
    } catch (error) {
      if (!(error instanceof CellInvariantError)) throw error
      observedNegativeFailure = error.invariant
    }
    await stopServer(runtime, negativeServer)
    appendServerErrors(runtime, negativeEnv.PRIMER_ERROR_LOG, "negative-control")
    assertProcess(
      runtime,
      runtime.processStarts === 3
        && runtime.restarts === 1
        && runtime.restarts <= context.manifest.budget.maxRestarts
        && firstPid !== restartPid
        && negativeServer.pid !== firstPid
        && negativeServer.pid !== restartPid,
      "bounded-process-restart",
      "Three bounded real server starts used distinct process identifiers, and the single positive restart stayed within its declared cap.",
    )
    assertProcess(runtime, runtime.httpRequests <= context.manifest.budget.maxHttpRequests, "bounded-http", `The cell completed ${runtime.httpRequests} loopback HTTP requests within its declared cap.`)
    assertProcess(runtime, statSync(context.artifacts.serverStderr).size === 0, "server-stderr-empty", "All three real server processes exited without stderr output.")
    assertProcess(runtime, statSync(context.artifacts.errors).size === 0, "errors-log-empty", "Primer errors.log was captured and remained empty.")
    assertProcess(
      runtime,
      observedNegativeFailure === context.manifest.negativeControl.expectedInvariantFailure,
      "negative-control-failed-at-invariant",
      "Deleting scheduler persistence made the restart oracle fail at the declared invariant.",
    )

    remainingTimeout(runtime)
    const completedAt = new Date(
      Date.parse(context.manifest.entropyControls.logicalClock.start) + context.manifest.entropyControls.logicalClock.stepMs * 100,
    ).toISOString()
    const assertionsPassed = runtime.stateAssertions.length + runtime.processAssertions.length
    return {
      schemaVersion: "primer.validation-cell-receipt.v1",
      manifest: {
        schemaVersion: context.manifest.schemaVersion,
        cellId: context.manifest.cell.id,
        cellVersion: context.manifest.cell.version,
      },
      scenario: {
        id: context.manifest.scenario.id,
        startedAt: context.manifest.entropyControls.logicalClock.start,
        completedAt,
      },
      outcome: "passed",
      layers: {
        state: { status: "passed", assertions: runtime.stateAssertions },
        process: { status: "passed", assertions: runtime.processAssertions },
        browser: {
          status: "skipped",
          assertions: [],
          reason: browserLayer.reason,
          nextLayer: "receipt",
        },
      },
      counts: {
        httpRequests: runtime.httpRequests,
        sqliteWrites: runtime.sqliteWrites,
        processStarts: runtime.processStarts,
        restarts: runtime.restarts,
        assertionsPassed,
        assertionsFailed: 0,
      },
      restartProof: {
        beforePid: firstPid,
        afterPid: restartPid,
        databasePath: context.manifest.scenario.database.path,
        persistedSchedulerDueAt: persisted.due,
        observedSchedulerDueAt: persistedCard.due,
      },
      negativeControl: {
        id: context.manifest.negativeControl.id,
        executed: true,
        expectedOutcome: context.manifest.negativeControl.expectedOutcome,
        expectedInvariantFailure: context.manifest.negativeControl.expectedInvariantFailure,
        observedInvariantFailure: observedNegativeFailure,
      },
      artifacts: [],
      errors: [],
    }
  } catch (error) {
    appendBounded(context.artifacts.errors, `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`, context.manifest.artifacts.maxTotalBytes)
    throw error
  } finally {
    for (const server of runtime.running) {
      if (server.settled) continue
      try {
        await stopServer(runtime, server)
      } catch {
        // stopServer does not reject until the owned child has exited and both output streams have settled.
      }
    }
    rmSync(workspace, { recursive: true, force: true })
  }
}

function makeServerEnv(
  runtime: CellRuntime,
  root: string,
  ledgerPath: string,
  clockStart: string,
): Record<string, string | undefined> {
  const home = join(root, "home")
  const state = join(root, "state")
  const browser = join(state, "browser-context")
  const control = join(state, "control")
  const logs = join(root, "logs")
  const readerSite = join(root, "reader-site")
  for (const path of [home, state, browser, control, logs, readerSite, join(root, "tmp")]) mkdirSync(path, { recursive: true })
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(root, "xdg", "config"),
    XDG_CACHE_HOME: join(root, "xdg", "cache"),
    XDG_DATA_HOME: join(root, "xdg", "data"),
    XDG_STATE_HOME: join(root, "xdg", "state"),
    TMPDIR: join(root, "tmp"),
    OMP_CONFIG_ROOT: join(root, "omp-config"),
    OMP_IRC_DB: join(control, "irc.sqlite"),
    OMP_SESSION_CONTROL_DB: join(control, "session-control.sqlite"),
    OMP_FLEET_REGISTER: "0",
    PRIMER_BROWSER_DB: join(state, "browser.sqlite"),
    PRIMER_BROWSER_CONTEXT_DIR: browser,
    PRIMER_BROWSER_CONTEXT_DB: join(browser, "context.sqlite"),
    PRIMER_BROWSER_CONTEXT_SOCKET: join(browser, "context.sock"),
    PRIMER_BROWSER_CONTEXT_ARTIFACTS: join(browser, "artifacts"),
    PRIMER_BROWSER_CONTEXT_MANIFESTS: join(browser, "manifests"),
    PRIMER_TWITTER_DB: join(state, "twitter.sqlite"),
    PRIMER_READER_DB: join(state, "reader.sqlite"),
    PRIMER_CARDS_DB: join(state, "cards.sqlite"),
    PRIMER_READER_SITE: readerSite,
    PRIMER_LEDGER_DB: ledgerPath,
    PRIMER_REVIEW_FEED: join(state, "feed.jsonl"),
    PRIMER_ERROR_LOG: join(logs, "errors.log"),
    PRIMER_ANKI_PROFILE: join(state, "anki.json"),
    PRIMER_CEDICT_DB: join(state, "cedict.sqlite"),
    PRIMER_ZHDICT_DB: join(state, "zhdict.sqlite"),
    PRIMER_HANLY_DB: join(state, "hanly.sqlite"),
    PRIMER_GENERATION_STORE: join(state, "generation.sqlite"),
    PRIMER_SHADOWING_DIR: join(state, "shadowing"),
    PRIMER_READER_MEDIA_DIR: join(state, "reader-media"),
    PRIMER_ASK_SYNTHESIS: "0",
    PRIMER_MELTDOWN_ALIAS: "0",
    PRIMER_VALIDATION_CLOCK_START: clockStart,
    PRIMER_VALIDATION_CLOCK_STEP_MS: String(runtime.context.manifest.entropyControls.logicalClock.stepMs),
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1,localhost",
  }
}

async function restartServer(
  runtime: CellRuntime,
  env: Record<string, string | undefined>,
  label: string,
): Promise<RunningValidationServer> {
  const nextRestart = runtime.restarts + 1
  if (nextRestart > runtime.context.manifest.budget.maxRestarts) {
    throw new ValidationCellBudgetExceededError(
      "maxRestarts",
      runtime.context.manifest.budget.maxRestarts,
      nextRestart,
      label,
    )
  }
  runtime.restarts = nextRestart
  return startServer(runtime, env, label)
}

async function startServer(
  runtime: CellRuntime,
  env: Record<string, string | undefined>,
  label: string,
): Promise<RunningValidationServer> {
  remainingTimeout(runtime)
  runtime.processStarts += 1
  if (runtime.processStarts > runtime.context.manifest.budget.maxProcessStarts) {
    throw new ValidationCellBudgetExceededError(
      "maxProcessStarts",
      runtime.context.manifest.budget.maxProcessStarts,
      runtime.processStarts,
      label,
    )
  }
  appendBounded(runtime.context.artifacts.serverStdout, `--- ${label} ---\n`, runtime.context.manifest.artifacts.maxTotalBytes)
  const child = Bun.spawn([process.execPath, SERVER_SCRIPT], {
    cwd: PACKAGE_ROOT,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const ready = deferred<ReadyMessage>()
  const stdoutDone = captureStream(child.stdout, runtime.context.artifacts.serverStdout, runtime.context.manifest.artifacts.maxTotalBytes, (line) => {
    try {
      const value = JSON.parse(line) as Partial<ReadyMessage>
      if (value.type === "primer-validation-ready" && typeof value.pid === "number" && typeof value.port === "number") {
        ready.resolve(value as ReadyMessage)
      }
    } catch {
      // Server log lines that are not readiness frames remain ordinary captured output.
    }
  })
  const stderrDone = captureStream(child.stderr, runtime.context.artifacts.serverStderr, runtime.context.manifest.artifacts.maxTotalBytes)
  let message: ReadyMessage
  try {
    message = await withTimeout(
      ready.promise,
      remainingTimeout(runtime),
      () => timeoutBudgetError(runtime, `${label} readiness`),
    )
  } catch (error) {
    child.kill("SIGKILL")
    await Promise.allSettled([stdoutDone, stderrDone, child.exited])
    throw error
  }
  if (message.pid !== child.pid || message.port <= 0 || message.port > 65_535) {
    child.kill("SIGKILL")
    throw new Error("validation server emitted an invalid readiness frame")
  }
  const server = { child, pid: message.pid, port: message.port, stdoutDone, stderrDone, settled: false }
  runtime.running.push(server)
  return server
}

async function stopServer(runtime: CellRuntime, server: RunningValidationServer): Promise<void> {
  if (server.settled) return
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM")
    try {
      await withTimeout(
        server.child.exited,
        SERVER_CLEANUP_GRACE_MS,
        () => new Error(`validation server ${server.pid} exceeded the ${SERVER_CLEANUP_GRACE_MS}ms cleanup grace`),
      )
    } catch {
      server.child.kill("SIGKILL")
    }
  }

  const [exitResult, stdoutResult, stderrResult] = await Promise.allSettled([
    server.child.exited,
    server.stdoutDone,
    server.stderrDone,
  ])
  server.settled = true
  if (exitResult.status === "rejected") throw exitResult.reason
  if (stdoutResult.status === "rejected") throw stdoutResult.reason
  if (stderrResult.status === "rejected") throw stderrResult.reason
  if (exitResult.value !== 0) throw new Error(`validation server exited with code ${exitResult.value}`)
  assertProcess(runtime, true, `server-exit-${server.pid}`, `Server process ${server.pid} stopped cleanly before the next process used its state.`)
}

async function requestJson<T = Record<string, unknown>>(
  runtime: CellRuntime,
  server: RunningValidationServer,
  method: "GET" | "POST",
  path: string,
  body?: object,
): Promise<T> {
  runtime.httpRequests += 1
  if (runtime.httpRequests > runtime.context.manifest.budget.maxHttpRequests) {
    throw new ValidationCellBudgetExceededError(
      "maxHttpRequests",
      runtime.context.manifest.budget.maxHttpRequests,
      runtime.httpRequests,
      `${method} ${path}`,
    )
  }
  const url = new URL(path, `http://127.0.0.1:${server.port}`)
  if (url.hostname !== "127.0.0.1") throw new Error("validation HTTP request escaped loopback")
  if (method === "POST") runtime.sqliteWrites += 1
  const signal = AbortSignal.timeout(remainingTimeout(runtime))
  let response: Response
  let text: string
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    text = await response.text()
  } catch (error) {
    if (signal.aborted) throw timeoutBudgetError(runtime, `${method} ${url.pathname}`)
    throw error
  }
  appendBounded(
    runtime.context.artifacts.network,
    `${runtime.httpRequests}\t${method}\t${url.pathname}${url.search}\t${response.status}\t${Buffer.byteLength(text)}\n`,
    runtime.context.manifest.artifacts.maxTotalBytes,
  )
  if (!response.ok) throw new Error(`${method} ${url.pathname} returned ${response.status}`)
  return JSON.parse(text) as T
}

function inspectPersistedState(
  runtime: CellRuntime,
  databasePath: string,
  docId: number,
  markId: number,
  queueItemId: number,
  cardId: number,
  sourceRef: string,
  expectedDue: string,
): PersistedState {
  const db = new Database(databasePath)
  try {
    const state = db.query<{ due: string; state: string; state_version: number }, [number]>(
      "SELECT due, state, state_version FROM review_state WHERE item_kind = 'card_candidate' AND item_id = ?",
    ).get(cardId)
    const events = db.query<{ grade: string; prior_state_version: number; derived_state_version: number }, [number]>(
      "SELECT grade, prior_state_version, derived_state_version FROM review_events WHERE item_kind = 'card_candidate' AND item_id = ? ORDER BY id ASC",
    ).all(cardId)
    const cardCount = db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM card_candidates WHERE front = ?").get(MARKED_WORD)?.count ?? 0
    const provenance = db.query<{
      doc_id: number
      mark_id: number
      queue_id: number
      paragraph_idx: number
      start: number
      end: number
      sentence: string
      source_ref: string | null
    }, [number, number, number]>(
      `SELECT rd.id AS doc_id,
              rm.id AS mark_id,
              qi.id AS queue_id,
              rm.paragraph_idx,
              rm.start,
              rm.end,
              rm.sentence,
              cc.source_ref AS source_ref
       FROM reading_docs rd
       JOIN reading_marks rm ON rm.doc_id = rd.id
       JOIN queue_items qi ON qi.mark_id = rm.id
       JOIN card_candidates cc ON cc.id = ?
       WHERE rd.id = ? AND rm.id = ?`,
    ).get(cardId, docId, markId)
    const integrity = db.query<Record<string, string>, []>("PRAGMA integrity_check").get()
    const foreignKeyFailures = db.query<Record<string, unknown>, []>("PRAGMA foreign_key_check").all()
    const eventVersionsValid = events.every((event, index) => event.prior_state_version === index && event.derived_state_version === index + 1)
    assertState(
      runtime,
      state?.due === expectedDue && state.state_version === 3 && events.length === 3 && eventVersionsValid,
      "sqlite-scheduler-state",
      "SQLite stores one version-three scheduler row and three contiguous prior/derived review events.",
    )
    assertState(
      runtime,
      provenance?.doc_id === docId
        && provenance.mark_id === markId
        && provenance.queue_id === queueItemId
        && provenance.paragraph_idx === MARK_PARAGRAPH_INDEX
        && provenance.start === MARK_START
        && provenance.end === MARK_END
        && provenance.sentence === SYNTHETIC_PARAGRAPHS[MARK_PARAGRAPH_INDEX]
        && provenance.source_ref === sourceRef,
      "sqlite-provenance-chain",
      "After restart, the SQLite join resolves the card through the exact queue item, mark paragraph/span/sentence, and synthetic document.",
    )
    assertState(
      runtime,
      cardCount === 1 && Object.values(integrity ?? {}).includes("ok") && foreignKeyFailures.length === 0,
      "sqlite-integrity-no-duplicate",
      "SQLite integrity and foreign-key checks pass and the synthetic card is unique.",
    )
    if (state === null) throw new Error("persisted scheduler state disappeared before restart")
    return {
      due: state.due,
      state: state.state,
      stateVersion: state.state_version,
      eventGrades: events.map((event) => event.grade),
      cardCount,
    }
  } finally {
    db.close()
  }
}

function checkpoint(path: string): void {
  const db = new Database(path)
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    db.close()
  }
}

function appendServerErrors(runtime: CellRuntime, source: string | undefined, label: string): void {
  if (source === undefined || !existsSync(source) || statSync(source).size === 0) return
  appendBounded(runtime.context.artifacts.errors, `--- ${label} ---\n`, runtime.context.manifest.artifacts.maxTotalBytes)
  const remaining = runtime.context.manifest.artifacts.maxTotalBytes - statSync(runtime.context.artifacts.errors).size
  if (remaining <= 0) return
  const content = readFileSync(source)
  appendFileSync(runtime.context.artifacts.errors, content.subarray(0, remaining))
}

async function captureStream(
  stream: ReadableStream<Uint8Array>,
  path: string,
  maxBytes: number,
  onLine?: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let textBuffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value !== undefined) {
        appendBounded(path, value, maxBytes)
        if (onLine !== undefined) {
          textBuffer += decoder.decode(value, { stream: true })
          if (textBuffer.length > 16_384) textBuffer = textBuffer.slice(-16_384)
          for (;;) {
            const newline = textBuffer.indexOf("\n")
            if (newline < 0) break
            const line = textBuffer.slice(0, newline)
            textBuffer = textBuffer.slice(newline + 1)
            onLine(line)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function appendBounded(path: string, value: string | Uint8Array, maxBytes: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const current = existsSync(path) ? statSync(path).size : 0
  const remaining = maxBytes - current
  if (remaining <= 0) return
  const bytes = typeof value === "string" ? Buffer.from(value) : value
  appendFileSync(path, bytes.subarray(0, remaining))
}

function assertState(runtime: CellRuntime, condition: boolean, id: string, detail: string): void {
  if (!condition) throw new CellInvariantError(`${id}: ${detail}`)
  runtime.stateAssertions.push({ id, status: "passed", detail })
}

function assertProcess(runtime: CellRuntime, condition: boolean, id: string, detail: string): void {
  if (!condition) throw new CellInvariantError(`${id}: ${detail}`)
  runtime.processAssertions.push({ id, status: "passed", detail })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue
  })
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new Error("deferred promise was not initialized")
      resolvePromise(value)
    },
  }
}

function remainingTimeout(runtime: CellRuntime): number {
  const remaining = Math.ceil(runtime.deadline - performance.now())
  if (remaining <= 0) throw timeoutBudgetError(runtime, "cell execution")
  return remaining
}

function timeoutBudgetError(runtime: CellRuntime, operation: string): ValidationCellBudgetExceededError {
  const timeoutMs = runtime.context.manifest.budget.timeoutMs
  const startedAt = runtime.deadline - timeoutMs
  const elapsed = Math.max(timeoutMs + 1, Math.ceil(performance.now() - startedAt))
  return new ValidationCellBudgetExceededError("timeoutMs", timeoutMs, elapsed, operation)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
