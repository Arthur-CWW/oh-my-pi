import { ensureArchiveLayout, type ArchivePaths } from "./paths"
import type { ArchiveRun } from "./schema"
import { upsertJsonlById, type UpsertJsonlResult } from "./jsonl"
import { createArchiveRun, type CreateArchiveRunInput } from "./normalize"

export interface PlannedArchiveRunRecord extends UpsertJsonlResult {
  run: ArchiveRun
  filePath: string
}

export async function writePlannedArchiveRun(
  paths: ArchivePaths,
  input: CreateArchiveRunInput,
): Promise<PlannedArchiveRunRecord> {
  const run = createArchiveRun(input)
  await ensureArchiveLayout(paths)
  const result = await upsertJsonlById(paths.entityFiles.archiveRuns, [run])

  return {
    ...result,
    run,
    filePath: paths.entityFiles.archiveRuns,
  }
}
