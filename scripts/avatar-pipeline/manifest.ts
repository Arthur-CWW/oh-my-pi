/**
 * avatar-pipeline-manifest-v1 — Schema types, atomic IO, SHA-256 hashing, resume validation.
 *
 * Every JSON boundary is decoded through a strict validation function that
 * rejects unknown shapes with descriptive errors.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileHash = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

export type GateStatus = 'passed' | 'failed' | 'pending';

export type GateResult = {
  readonly name: string;
  /** Tri-state: `pending` means no direct current evidence exists yet — it is
   * neither success nor failure and blocks acceptance without rejecting. */
  readonly status: GateStatus;
  readonly threshold: string;
  readonly observed: string;
  readonly detail: string;
};

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type StageRecord = {
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  inputs: FileHash[];
  outputs: FileHash[];
  gates: GateResult[];
  error: string | null;
  blenderManifestPath: string | null;
};

export type Provenance = {
  readonly baseModel: { readonly slug: string; readonly source: string; readonly license: string; readonly licenseNotes: string };
  readonly donor: { readonly slug: string; readonly source: string; readonly license: string };
  readonly identityCorpus: { readonly reconstructionId: string; readonly clipCount: number; readonly frameCount: number } | null;
};

export type AvatarPipelineManifest = {
  schemaName: 'avatar-pipeline-manifest-v1';
  schemaVersion: 1;
  assetId: string;
  lane: 'production';
  createdAt: string;
  updatedAt: string;
  provenance: Provenance;
  stages: Record<string, StageRecord>;
  finalVerdict: 'accepted' | 'rejected' | 'pending';
  proofCard: string | null;
};

// ---------------------------------------------------------------------------
// Stage names (canonical order)
// ---------------------------------------------------------------------------

export const STAGE_NAMES = [
  'source-validation',
  'face-rig-transfer',
  'identity-bake',
  'coverage-gates',
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

// ---------------------------------------------------------------------------
// Strict decoders
// ---------------------------------------------------------------------------

function requireObject(raw: unknown, context: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${context} must be a JSON object, got ${raw === null ? 'null' : typeof raw}`);
  }
  return raw as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new Error(`${ctx}.${key} must be a string, got ${typeof v}`);
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${ctx}.${key} must be a finite number, got ${v}`);
  return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string, ctx: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') throw new Error(`${ctx}.${key} must be a boolean, got ${typeof v}`);
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string, ctx: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new Error(`${ctx}.${key} must be an array, got ${typeof v}`);
  return v;
}

function requireStringOrNull(obj: Record<string, unknown>, key: string, ctx: string): string | null {
  const v = obj[key];
  if (v === null) return null;
  if (typeof v !== 'string') throw new Error(`${ctx}.${key} must be a string or null, got ${typeof v}`);
  return v;
}

function decodeFileHash(raw: unknown, ctx: string): FileHash {
  const obj = requireObject(raw, ctx);
  return {
    path: requireString(obj, 'path', ctx),
    sha256: requireString(obj, 'sha256', ctx),
    bytes: requireNumber(obj, 'bytes', ctx),
  };
}

const VALID_GATE_STATUSES: readonly GateStatus[] = ['passed', 'failed', 'pending'];

function decodeGateResult(raw: unknown, ctx: string): GateResult {
  const obj = requireObject(raw, ctx);
  const status = requireString(obj, 'status', ctx);
  if (!VALID_GATE_STATUSES.includes(status as GateStatus)) {
    throw new Error(`${ctx}.status must be one of ${VALID_GATE_STATUSES.join('|')}, got ${status}`);
  }
  return {
    name: requireString(obj, 'name', ctx),
    status: status as GateStatus,
    threshold: requireString(obj, 'threshold', ctx),
    observed: requireString(obj, 'observed', ctx),
    detail: requireString(obj, 'detail', ctx),
  };
}

const VALID_STATUSES: readonly StageStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];

function decodeStageRecord(raw: unknown, ctx: string): StageRecord {
  const obj = requireObject(raw, ctx);
  const status = requireString(obj, 'status', ctx);
  if (!VALID_STATUSES.includes(status as StageStatus)) throw new Error(`${ctx}.status must be one of ${VALID_STATUSES.join(',')}; got "${status}"`);
  return {
    status: status as StageStatus,
    startedAt: requireStringOrNull(obj, 'startedAt', ctx),
    completedAt: requireStringOrNull(obj, 'completedAt', ctx),
    inputs: requireArray(obj, 'inputs', ctx).map((v, i) => decodeFileHash(v, `${ctx}.inputs[${i}]`)),
    outputs: requireArray(obj, 'outputs', ctx).map((v, i) => decodeFileHash(v, `${ctx}.outputs[${i}]`)),
    gates: requireArray(obj, 'gates', ctx).map((v, i) => decodeGateResult(v, `${ctx}.gates[${i}]`)),
    error: requireStringOrNull(obj, 'error', ctx),
    blenderManifestPath: requireStringOrNull(obj, 'blenderManifestPath', ctx),
  };
}

function decodeProvenance(raw: unknown, ctx: string): Provenance {
  const obj = requireObject(raw, ctx);
  const base = requireObject(obj['baseModel'], `${ctx}.baseModel`);
  const donor = requireObject(obj['donor'], `${ctx}.donor`);
  const ic = obj['identityCorpus'];
  let identityCorpus: Provenance['identityCorpus'] = null;
  if (ic !== null && ic !== undefined) {
    const icObj = requireObject(ic, `${ctx}.identityCorpus`);
    identityCorpus = {
      reconstructionId: requireString(icObj, 'reconstructionId', `${ctx}.identityCorpus`),
      clipCount: requireNumber(icObj, 'clipCount', `${ctx}.identityCorpus`),
      frameCount: requireNumber(icObj, 'frameCount', `${ctx}.identityCorpus`),
    };
  }
  return {
    baseModel: {
      slug: requireString(base, 'slug', `${ctx}.baseModel`),
      source: requireString(base, 'source', `${ctx}.baseModel`),
      license: requireString(base, 'license', `${ctx}.baseModel`),
      licenseNotes: requireString(base, 'licenseNotes', `${ctx}.baseModel`),
    },
    donor: {
      slug: requireString(donor, 'slug', `${ctx}.donor`),
      source: requireString(donor, 'source', `${ctx}.donor`),
      license: requireString(donor, 'license', `${ctx}.donor`),
    },
    identityCorpus: identityCorpus,
  };
}

const VALID_VERDICTS = ['accepted', 'rejected', 'pending'] as const;
type FinalVerdict = (typeof VALID_VERDICTS)[number];

export function decodeManifest(raw: unknown): AvatarPipelineManifest {
  const obj = requireObject(raw, 'manifest');
  if (obj['schemaName'] !== 'avatar-pipeline-manifest-v1') {
    throw new Error(`manifest.schemaName must be "avatar-pipeline-manifest-v1", got "${obj['schemaName']}"`);
  }
  if (obj['schemaVersion'] !== 1) {
    throw new Error(`manifest.schemaVersion must be 1, got ${obj['schemaVersion']}`);
  }
  const verdict = requireString(obj, 'finalVerdict', 'manifest');
  if (!VALID_VERDICTS.includes(verdict as FinalVerdict)) {
    throw new Error(`manifest.finalVerdict must be one of ${VALID_VERDICTS.join(',')}; got "${verdict}"`);
  }
  const stagesRaw = requireObject(obj['stages'], 'manifest.stages');
  const stages: Record<string, StageRecord> = {};
  for (const [k, v] of Object.entries(stagesRaw)) {
    stages[k] = decodeStageRecord(v, `manifest.stages.${k}`);
  }
  return {
    schemaName: 'avatar-pipeline-manifest-v1',
    schemaVersion: 1,
    assetId: requireString(obj, 'assetId', 'manifest'),
    lane: 'production',
    createdAt: requireString(obj, 'createdAt', 'manifest'),
    updatedAt: requireString(obj, 'updatedAt', 'manifest'),
    provenance: decodeProvenance(obj['provenance'], 'manifest.provenance'),
    stages,
    finalVerdict: verdict as FinalVerdict,
    proofCard: requireStringOrNull(obj, 'proofCard', 'manifest'),
  };
}

// ---------------------------------------------------------------------------
// SHA-256 hashing
// ---------------------------------------------------------------------------

export async function hashFile(filePath: string): Promise<FileHash> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  const info = await stat(filePath);
  return { path: filePath, sha256: hash.digest('hex'), bytes: info.size };
}

// ---------------------------------------------------------------------------
// Atomic IO
// ---------------------------------------------------------------------------

export async function readManifest(manifestPath: string): Promise<AvatarPipelineManifest> {
  const text = await readFile(manifestPath, 'utf8');
  return decodeManifest(JSON.parse(text));
}

let atomicCounter = 0;
export async function atomicWriteManifest(manifestPath: string, manifest: AvatarPipelineManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  const tmp = `${manifestPath}.${process.pid}.${++atomicCounter}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tmp, manifestPath);
}

// ---------------------------------------------------------------------------
// Resume validation
// ---------------------------------------------------------------------------

export async function validateResume(stage: StageRecord): Promise<boolean> {
  if (stage.status !== 'completed') return false;
  for (const file of [...stage.inputs, ...stage.outputs]) {
    try {
      const current = await hashFile(file.path);
      if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function freshStage(): StageRecord {
  return {
    status: 'pending',
    startedAt: null,
    completedAt: null,
    inputs: [],
    outputs: [],
    gates: [],
    error: null,
    blenderManifestPath: null,
  };
}

export function freshManifest(assetId: string, provenance: Provenance): AvatarPipelineManifest {
  const now = new Date().toISOString();
  const stages: Record<string, StageRecord> = {};
  for (const name of STAGE_NAMES) stages[name] = freshStage();
  return {
    schemaName: 'avatar-pipeline-manifest-v1',
    schemaVersion: 1,
    assetId,
    lane: 'production',
    createdAt: now,
    updatedAt: now,
    provenance,
    stages,
    finalVerdict: 'pending',
    proofCard: null,
  };
}

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

export function computeVerdict(manifest: AvatarPipelineManifest): 'accepted' | 'rejected' | 'pending' {
  let anyPending = false;
  for (const name of STAGE_NAMES) {
    const stage = manifest.stages[name];
    if (!stage) return 'pending';
    if (stage.status === 'failed') return 'rejected';
    if (stage.status !== 'completed') anyPending = true;
    for (const gate of stage.gates) {
      // Observed failure rejects outright; missing evidence only blocks acceptance.
      if (gate.status === 'failed') return 'rejected';
      if (gate.status === 'pending') anyPending = true;
    }
  }
  return anyPending ? 'pending' : 'accepted';
}

// ---------------------------------------------------------------------------
// GLB / VRM helpers
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546C67; // "glTF" in little-endian
const JSON_CHUNK_TYPE = 0x4E4F534A; // "JSON" in little-endian

export function parseGlbJsonChunk(buffer: Buffer): Record<string, unknown> {
  if (buffer.byteLength < 20) throw new Error('File too small to be a valid GLB');
  const magic = buffer.readUInt32LE(0);
  if (magic !== GLB_MAGIC) throw new Error(`Not a GLB file: magic 0x${magic.toString(16)} !== 0x${GLB_MAGIC.toString(16)}`);
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== JSON_CHUNK_TYPE) throw new Error(`First GLB chunk is not JSON: type 0x${chunkType.toString(16)}`);
  if (buffer.byteLength < 20 + chunkLength) throw new Error('GLB file truncated: JSON chunk extends past end of buffer');
  const json = buffer.subarray(20, 20 + chunkLength).toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

export function hasVrmExtension(gltf: Record<string, unknown>): boolean {
  const ext = gltf['extensions'] as Record<string, unknown> | undefined;
  if (!ext) return false;
  return 'VRMC_vrm' in ext || 'VRM' in ext;
}
