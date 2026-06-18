function normalizeEnvPath(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolvePythonReplHostExecutableFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    normalizeEnvPath(env.NCODE_PY_REPL_HOST_PATH) ??
    normalizeEnvPath(env.CLAUDE_CODE_PY_REPL_HOST_PATH)
  )
}

export async function resolveBundledPythonReplHostExecutable(
  _loadAssetModule?: unknown,
): Promise<string | null> {
  return null
}

export async function resolvePythonReplHostExecutable(
  env: NodeJS.ProcessEnv = process.env,
  _loadAssetModule?: unknown,
): Promise<string | null> {
  return resolvePythonReplHostExecutableFromEnv(env)
}

// Note: the bundled py_repl host lived in an internal native host that is not included in
// this OSS export. It was gated behind internal builds
// in practice, but the bundling import still blocked standalone source builds.
// via NCODE_PY_REPL_HOST_PATH when needed. OSS packages intentionally do not
// embed or materialize a py_repl host.
