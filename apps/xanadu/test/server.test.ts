import { mkdir, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { appendFeedEntry, decodeFeedEntry, FEED_SCHEMA } from "../src/feed.ts"
import { createAnswerEntry, listRunRecords, readRunLog, RUNS_DIR } from "../src/server.ts"

const questionEntry = decodeFeedEntry({
  schema: FEED_SCHEMA,
  id: "question-for-answer-test",
  ts: "2026-07-03T08:00:00.000Z",
  stream: "companion",
  kind: "question",
  title: "Pick a lane",
  summary: "Which direction?",
  tags: ["choice"],
  needsInput: true,
})

describe("run log index", () => {
  test("lists and retrieves persisted run logs", async () => {
    const runId = `test-run-${crypto.randomUUID()}`
    const logPath = resolve(RUNS_DIR, `${runId}.log`)
    await mkdir(RUNS_DIR, { recursive: true })
    await writeFile(
      logPath,
      [
        `# run-id: ${runId}`,
        "# entry-id: test-entry",
        "# action-index: 0",
        "# argv: [\"bun\",\"test\"]",
        "# cwd: /tmp/xanadu",
        "# start: 2026-07-03T08:00:00.000Z",
        "",
        "hello from the action",
        "# end: 2026-07-03T08:00:01.000Z",
        "# exit-code: 0",
        "",
      ].join("\n"),
    )

    try {
      const records = await listRunRecords()
      const record = records.find((candidate) => candidate.id === runId)
      const log = await readRunLog(runId)

      expect(record?.entryId).toBe("test-entry")
      expect(record?.status).toBe("ok")
      expect(record?.exitCode).toBe(0)
      expect(log).toContain("hello from the action")
    } finally {
      await unlink(logPath)
    }
  })
})

describe("answer entries", () => {
  test("builds and appends a valid decision linked to the question", async () => {
    const feedPath = resolve(RUNS_DIR, `answer-feed-${crypto.randomUUID()}.jsonl`)
    const answer = createAnswerEntry(questionEntry, "Ship the realtime browser loop first.")

    try {
      await appendFeedEntry(questionEntry, feedPath)
      await appendFeedEntry(answer, feedPath)
      const text = await Bun.file(feedPath).text()
      const lines = text.trim().split("\n").map((line) => decodeFeedEntry(JSON.parse(line)))

      expect(answer.kind).toBe("decision")
      expect(answer.parentId).toBe(questionEntry.id)
      expect(answer.links[0]?.href).toBe(`#entry-${questionEntry.id}`)
      expect(lines.map((entry) => entry.id)).toEqual([questionEntry.id, answer.id])
    } finally {
      await unlink(feedPath)
    }
  })
})
