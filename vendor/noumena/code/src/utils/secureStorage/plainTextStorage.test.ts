import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getExistingPlainTextStoragePath,
  getPlainTextStorageReadPaths,
  getPrimaryPlainTextStoragePath,
  plainTextStorage,
} from './plainTextStorage.js'

const ENV_VARS = ['NCODE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR'] as const

const ORIGINAL_ENV = Object.fromEntries(
  ENV_VARS.map(key => [key, process.env[key]]),
) as Record<(typeof ENV_VARS)[number], string | undefined>

afterEach(() => {
  for (const envVar of ENV_VARS) {
    const original = ORIGINAL_ENV[envVar]
    if (original === undefined) {
      delete process.env[envVar]
    } else {
      process.env[envVar] = original
    }
  }
})

describe('plainTextStorage compatibility fallback', () => {
  it('prefers the explicit NCODE_CONFIG_DIR credential file when present', async () => {
    const ncodeDir = await mkdtemp(join(tmpdir(), 'ncode-credentials-'))
    const legacyDir = await mkdtemp(join(tmpdir(), 'legacy-credentials-'))
    try {
      process.env.NCODE_CONFIG_DIR = ncodeDir
      process.env.CLAUDE_CONFIG_DIR = legacyDir
      await writeFile(
        join(ncodeDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'primary-token' } }),
        'utf8',
      )
      await writeFile(
        join(legacyDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'legacy-token' } }),
        'utf8',
      )

      expect(getPrimaryPlainTextStoragePath()).toBe(
        join(ncodeDir, '.credentials.json'),
      )
      expect(getExistingPlainTextStoragePath()).toBe(
        join(ncodeDir, '.credentials.json'),
      )
      expect(plainTextStorage.read()).toEqual({
        claudeAiOauth: { accessToken: 'primary-token' },
      })
    } finally {
      await rm(ncodeDir, { recursive: true, force: true })
      await rm(legacyDir, { recursive: true, force: true })
    }
  })

  it('falls back to the legacy Claude credential file when the explicit ncode dir is empty', async () => {
    const ncodeDir = await mkdtemp(join(tmpdir(), 'ncode-credentials-'))
    const legacyDir = await mkdtemp(join(tmpdir(), 'legacy-credentials-'))
    try {
      process.env.NCODE_CONFIG_DIR = ncodeDir
      process.env.CLAUDE_CONFIG_DIR = legacyDir
      await writeFile(
        join(legacyDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'legacy-token' } }),
        'utf8',
      )

      expect(getPlainTextStorageReadPaths()).toEqual([
        join(ncodeDir, '.credentials.json'),
        join(legacyDir, '.credentials.json'),
      ])
      expect(getExistingPlainTextStoragePath()).toBe(
        join(legacyDir, '.credentials.json'),
      )
      expect(plainTextStorage.read()).toEqual({
        claudeAiOauth: { accessToken: 'legacy-token' },
      })
    } finally {
      await rm(ncodeDir, { recursive: true, force: true })
      await rm(legacyDir, { recursive: true, force: true })
    }
  })
})
