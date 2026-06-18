import { afterEach, describe, expect, it } from 'bun:test'
import {
  isBareMode,
  shouldMaintainProjectWorkingDir,
} from './envUtils.js'

const envKeys = [
  'NCODE_SIMPLE',
  'CLAUDE_CODE_SIMPLE',
  'NCODE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
] as const

const originalEnv = Object.fromEntries(
  envKeys.map(key => [key, process.env[key]]),
) as Record<(typeof envKeys)[number], string | undefined>

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('envUtils product env aliases', () => {
  it('treats NCODE_SIMPLE as the default bare-mode env', () => {
    delete process.env.CLAUDE_CODE_SIMPLE
    process.env.NCODE_SIMPLE = '1'

    expect(isBareMode()).toBe(true)
  })

  it('keeps the legacy bare-mode env as a compatibility alias', () => {
    delete process.env.NCODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'

    expect(isBareMode()).toBe(true)
  })

  it('prefers the NCode working-dir env and falls back to the legacy alias', () => {
    delete process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    process.env.NCODE_BASH_MAINTAIN_PROJECT_WORKING_DIR = '1'
    expect(shouldMaintainProjectWorkingDir()).toBe(true)

    delete process.env.NCODE_BASH_MAINTAIN_PROJECT_WORKING_DIR
    process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR = '1'
    expect(shouldMaintainProjectWorkingDir()).toBe(true)
  })
})
