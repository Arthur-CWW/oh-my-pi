import { describe, expect, test } from "bun:test"
import { parseWorkflowScript, runWorkflow } from "../src/workflow"

describe("vendored dynamic workflow parser", () => {
  test("extracts literal meta and executable body", () => {
    const parsed = parseWorkflowScript(`
export const meta = {
  name: "adversarial_review",
  description: "Review a completed change",
  phases: [{ title: "Scope" }, { title: "Critique" }],
}

phase("Scope")
return { ok: true }
`)

    expect(parsed.meta.name).toBe("adversarial_review")
    expect(parsed.meta.description).toBe("Review a completed change")
    expect(parsed.meta.phases?.map((phase) => phase.title)).toEqual(["Scope", "Critique"])
    expect(parsed.body).not.toContain("export const meta")
  })

  test("requires meta as the first statement", () => {
    expect(() => parseWorkflowScript("phase('x')\nexport const meta = { name: 'x', description: 'x' }")).toThrow(
      /must be the first statement/,
    )
  })

  test("rejects obvious nondeterminism", () => {
    expect(() => parseWorkflowScript("export const meta = { name: 'x', description: 'x' }\nreturn Math.random()")).toThrow(
      /deterministic/,
    )
  })
})

describe("vendored dynamic workflow runtime", () => {
  test("runs phases, parallel subagents, callbacks, and returns structured data", async () => {
    const started: Array<{ label: string; phase?: string; prompt: string }> = []
    const ended: Array<{ label: string; phase?: string; result: unknown }> = []
    const phases: string[] = []

    const fakeAgent = {
      async run(prompt: string, options: { label?: string; instructions?: string }) {
        return `${options.label ?? "agent"}: ${prompt}${options.instructions ? ` [${options.instructions}]` : ""}`
      },
    }

    const result = await runWorkflow(
      `
export const meta = { name: 'review_flow', description: 'Exercise fan-out/fan-in' }

phase('Scope')
const scope = await agent('inventory files', { label: 'scope inventory' })

phase('Critique')
const critiques = await parallel([
  () => agent('critic A sees ' + scope, { label: 'critic a' }),
  () => agent('critic B sees ' + scope, { label: 'critic b' }),
])

return { verdict: 'issues_found', scope, critiques }
`,
      {
        agent: fakeAgent as any,
        concurrency: 2,
        onPhase: (phase) => phases.push(phase),
        onAgentStart: (event) => started.push(event),
        onAgentEnd: (event) => ended.push(event),
      },
    )

    expect(result.meta.name).toBe("review_flow")
    expect(result.agentCount).toBe(3)
    expect(result.phases).toEqual(["Scope", "Critique"])
    expect(phases).toEqual(["Scope", "Critique"])
    expect(started.map((event) => event.label)).toEqual(["scope inventory", "critic a", "critic b"])
    expect(ended.map((event) => event.label).sort()).toEqual(["critic a", "critic b", "scope inventory"])
    expect(result.result).toEqual({
      verdict: "issues_found",
      scope: "scope inventory: inventory files [Workflow phase: Scope]",
      critiques: [
        "critic a: critic A sees scope inventory: inventory files [Workflow phase: Scope] [Workflow phase: Critique]",
        "critic b: critic B sees scope inventory: inventory files [Workflow phase: Scope] [Workflow phase: Critique]",
      ],
    })
  })
})
