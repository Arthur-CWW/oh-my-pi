import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  createAssistantMessage,
  createUserMessage,
} from './messages.js'
import { isResultSuccessful, normalizeMessage } from './queryHelpers.js'

function createBashProgressMessage({
  parentToolUseID,
  toolUseID,
  elapsedTimeSeconds = 12,
  taskId = 'task-1',
}: {
  parentToolUseID: string
  toolUseID: string
  elapsedTimeSeconds?: number
  taskId?: string
}) {
  return {
    type: 'progress' as const,
    data: {
      type: 'bash_progress' as const,
      elapsedTimeSeconds,
      taskId,
    },
    toolUseID,
    parentToolUseID,
    uuid: `uuid-${toolUseID}`,
    timestamp: new Date().toISOString(),
  }
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_CONTAINER_ID
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_CONTAINER_ID
})

describe('isResultSuccessful', () => {
  it('treats assistant text responses as successful results', () => {
    expect(isResultSuccessful(createAssistantMessage({ content: 'done' }))).toBe(
      true,
    )
  })

  it('rejects thinking-only assistant responses as silent turn output', () => {
    expect(
      isResultSuccessful(
        createAssistantMessage({
          content: [
            {
              type: 'thinking',
              thinking: 'step by step',
              signature: 'sig',
            } as never,
          ],
        }),
      ),
    ).toBe(false)
    expect(
      isResultSuccessful(
        createAssistantMessage({
          content: [
            {
              type: 'redacted_thinking',
              data: 'opaque',
            } as never,
          ],
        }),
      ),
    ).toBe(false)
  })

  it('accepts tool-result-only user messages as successful turn output', () => {
    expect(
      isResultSuccessful(
        createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: 'ok',
              tool_use_id: 'tool-1',
            } as never,
          ],
        }),
      ),
    ).toBe(true)
  })

  it('keeps the empty end_turn carve-out without treating ordinary prompts as success', () => {
    const prompt = createUserMessage({ content: 'continue' })

    expect(isResultSuccessful(prompt)).toBe(false)
    expect(isResultSuccessful(prompt, 'end_turn')).toBe(true)
  })

  it('rejects missing results and non-terminal assistant tool-use blocks', () => {
    expect(
      isResultSuccessful(
        createAssistantMessage({
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: {},
            } as never,
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('normalizeMessage', () => {
  it('suppresses empty assistant messages that only carry the no-content sentinel', () => {
    expect([...normalizeMessage(createAssistantMessage({ content: '' }))]).toEqual(
      [],
    )
  })

  it('does not emit bash progress updates outside remote/container sessions', () => {
    expect(
      [
        ...normalizeMessage(
          createBashProgressMessage({
            parentToolUseID: 'parent-local',
            toolUseID: 'progress-local',
          }) as never,
        ),
      ],
    ).toEqual([])
  })

  it('throttles bash progress updates per parent tool use in remote sessions', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'

    const first = [
      ...normalizeMessage(
        createBashProgressMessage({
          parentToolUseID: 'parent-remote',
          toolUseID: 'progress-1',
          elapsedTimeSeconds: 33,
          taskId: 'task-remote',
        }) as never,
      ),
    ]
    const second = [
      ...normalizeMessage(
        createBashProgressMessage({
          parentToolUseID: 'parent-remote',
          toolUseID: 'progress-2',
          elapsedTimeSeconds: 34,
          taskId: 'task-remote',
        }) as never,
      ),
    ]

    expect(first).toEqual([
      expect.objectContaining({
        type: 'tool_progress',
        tool_use_id: 'progress-1',
        tool_name: 'Bash',
        parent_tool_use_id: 'parent-remote',
        elapsed_time_seconds: 33,
        task_id: 'task-remote',
      }),
    ])
    expect(second).toEqual([])
  })
})
