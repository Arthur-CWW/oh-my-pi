import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"

const RECEIPT_VERSION = 1 as const
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024
const MAX_RECEIPT_BYTES = 16 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/
const SAFE_REMOTE_TOKEN_PATTERN = /^[A-Za-z0-9_./:-]+$/

const REMOTE_PREFLIGHT_SCRIPT = String.raw`set -eu
LC_ALL=C
export LC_ALL
dir=$1
final=$2
expected_digest=$3
expected_bytes=$4
expected_identity=$5
reserve_bytes=$6
fail() { printf '%s\n' "$1" >&2; exit "$2"; }
remote_identity=$(hostname 2>/dev/null) || fail identity-unavailable 20
[ "$remote_identity" = "$expected_identity" ] || fail identity-mismatch 21
[ -d "$dir" ] && [ ! -L "$dir" ] || fail destination-not-directory 22
remote_uid=$(id -u) || fail uid-unavailable 23
if stat -c %u "$dir" >/dev/null 2>&1; then
  dir_uid=$(stat -c %u "$dir")
  dir_mode=$(stat -c %a "$dir")
else
  dir_uid=$(stat -f %u "$dir")
  dir_mode=$(stat -f %Lp "$dir")
fi
[ "$dir_uid" = "$remote_uid" ] || fail destination-not-owned 24
[ "$dir_mode" = 700 ] || fail destination-not-owner-only 25
[ -w "$dir" ] && [ -x "$dir" ] || fail destination-not-writable 26
free_kib=$(df -Pk "$dir" | awk 'NR == 2 { print $4 }')
case "$free_kib" in ''|*[!0-9]*) fail free-space-unavailable 27;; esac
free_bytes=$((free_kib * 1024))
required_bytes=$((expected_bytes + reserve_bytes))
[ "$free_bytes" -ge "$required_bytes" ] || fail insufficient-free-space 28
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail sha256-unavailable 29
  fi
}
if [ -e "$final" ] || [ -L "$final" ]; then
  [ -f "$final" ] && [ ! -L "$final" ] || fail final-not-regular 30
  if stat -c %u "$final" >/dev/null 2>&1; then
    final_uid=$(stat -c %u "$final")
    final_mode=$(stat -c %a "$final")
  else
    final_uid=$(stat -f %u "$final")
    final_mode=$(stat -f %Lp "$final")
  fi
  [ "$final_uid" = "$remote_uid" ] || fail final-not-owned 31
  [ "$final_mode" = 600 ] || fail final-not-owner-only 32
  final_digest=$(hash_file "$final")
  final_bytes=$(wc -c < "$final" | tr -d '[:space:]')
  [ "$final_digest" = "$expected_digest" ] || fail final-digest-conflict 33
  [ "$final_bytes" = "$expected_bytes" ] || fail final-size-conflict 34
  state=EXACT
else
  state=MISSING
fi
printf 'PREFLIGHT\t%s\t%s\t%s\n' "$remote_identity" "$free_bytes" "$state"`

const REMOTE_PROMOTE_SCRIPT = String.raw`set -eu
LC_ALL=C
export LC_ALL
dir=$1
temp=$2
final=$3
expected_digest=$4
expected_bytes=$5
fail() { printf '%s\n' "$1" >&2; exit "$2"; }
remote_uid=$(id -u) || fail uid-unavailable 40
[ -d "$dir" ] && [ ! -L "$dir" ] || fail destination-not-directory 41
[ -f "$temp" ] && [ ! -L "$temp" ] || fail temp-not-regular 42
if stat -c %u "$temp" >/dev/null 2>&1; then
  temp_uid=$(stat -c %u "$temp")
else
  temp_uid=$(stat -f %u "$temp")
fi
[ "$temp_uid" = "$remote_uid" ] || fail temp-not-owned 43
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail sha256-unavailable 44
  fi
}
temp_digest=$(hash_file "$temp")
temp_bytes=$(wc -c < "$temp" | tr -d '[:space:]')
[ "$temp_digest" = "$expected_digest" ] || fail temp-digest-mismatch 45
[ "$temp_bytes" = "$expected_bytes" ] || fail temp-size-mismatch 46
chmod 600 "$temp" || fail temp-chmod-failed 47
if [ -e "$final" ] || [ -L "$final" ]; then
  [ -f "$final" ] && [ ! -L "$final" ] || fail final-not-regular 48
  final_digest=$(hash_file "$final")
  final_bytes=$(wc -c < "$final" | tr -d '[:space:]')
  [ "$final_digest" = "$expected_digest" ] || fail final-digest-conflict 49
  [ "$final_bytes" = "$expected_bytes" ] || fail final-size-conflict 50
  rm -f "$temp" || fail temp-cleanup-failed 51
  state=EXACT
else
  ln "$temp" "$final" || fail atomic-promote-failed 52
  rm "$temp" || fail temp-unlink-failed 53
  state=PROMOTED
fi
printf 'PROMOTE\t%s\t%s\t%s\n' "$expected_digest" "$expected_bytes" "$state"`

const REMOTE_VERIFY_SCRIPT = String.raw`set -eu
LC_ALL=C
export LC_ALL
dir=$1
final=$2
expected_digest=$3
expected_bytes=$4
expected_identity=$5
fsync_requested=$6
fail() { printf '%s\n' "$1" >&2; exit "$2"; }
remote_identity=$(hostname 2>/dev/null) || fail identity-unavailable 60
[ "$remote_identity" = "$expected_identity" ] || fail identity-mismatch 61
[ -d "$dir" ] && [ ! -L "$dir" ] || fail destination-not-directory 62
remote_uid=$(id -u) || fail uid-unavailable 63
if stat -c %u "$dir" >/dev/null 2>&1; then
  dir_uid=$(stat -c %u "$dir")
  dir_mode=$(stat -c %a "$dir")
else
  dir_uid=$(stat -f %u "$dir")
  dir_mode=$(stat -f %Lp "$dir")
fi
[ "$dir_uid" = "$remote_uid" ] || fail destination-not-owned 64
[ "$dir_mode" = 700 ] || fail destination-not-owner-only 65
[ -f "$final" ] && [ ! -L "$final" ] || fail final-not-regular 66
if stat -c %u "$final" >/dev/null 2>&1; then
  final_uid=$(stat -c %u "$final")
  final_mode=$(stat -c %a "$final")
else
  final_uid=$(stat -f %u "$final")
  final_mode=$(stat -f %Lp "$final")
fi
[ "$final_uid" = "$remote_uid" ] || fail final-not-owned 67
[ "$final_mode" = 600 ] || fail final-not-owner-only 68
if [ "$fsync_requested" = yes ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, sys
for path in sys.argv[1:]:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)' "$final" "$dir" || fail fsync-failed 69
  elif command -v sync >/dev/null 2>&1; then
    sync -f "$final" >/dev/null 2>&1 || sync || fail fsync-failed 69
  fi
fi
if command -v sha256sum >/dev/null 2>&1; then
  final_digest=$(sha256sum "$final" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  final_digest=$(shasum -a 256 "$final" | awk '{ print $1 }')
else
  fail sha256-unavailable 70
fi
final_bytes=$(wc -c < "$final" | tr -d '[:space:]')
[ "$final_digest" = "$expected_digest" ] || fail final-digest-mismatch 71
[ "$final_bytes" = "$expected_bytes" ] || fail final-size-mismatch 72
printf 'VERIFY\t%s\t%s\t%s\n' "$remote_identity" "$final_digest" "$final_bytes"`

export type ColdTierMode = "dry-run" | "apply"

export interface ColdTierCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type ColdTierCommandExecutor = (argv: readonly string[]) => Promise<ColdTierCommandResult>

export interface ColdTierConfig {
  /** An ssh config alias or DNS-style host token. Defaults to `desktop`. */
  readonly host?: string
  /** Exact output expected from `hostname` on the remote. Defaults to `host`. */
  readonly expectedRemoteIdentity?: string
  /** A pre-existing absolute owner-only directory on the remote. */
  readonly remoteDirectory: string
  /** A pre-existing OpenSSH known_hosts file. */
  readonly knownHostsFile?: string
  /** Free bytes which must remain in addition to the object size. */
  readonly reserveBytes?: number
  /** Test/embedding seam. Dry-run never calls it. */
  readonly executor?: ColdTierCommandExecutor
  /** Test/embedding seam used only for a committed receipt. */
  readonly now?: () => Date
  /** Test/embedding seam used to make a unique remote temporary name. */
  readonly nonce?: () => string
}

export interface TransferColdTierObjectInput {
  readonly mode: ColdTierMode
  readonly sourcePath: string
  readonly receiptPath?: string
  readonly config: ColdTierConfig
}

export interface DeleteColdTierLocalObjectInput {
  readonly mode: ColdTierMode
  readonly sourcePath: string
  readonly receiptPath?: string
  readonly config: ColdTierConfig
}

export interface ColdTierReceipt {
  readonly version: typeof RECEIPT_VERSION
  readonly sourcePath: string
  readonly host: string
  readonly hostIdentity: string
  readonly knownHostEvidenceSha256: string
  readonly remotePath: string
  readonly sha256: string
  readonly bytes: number
  readonly verifiedAt: string
}

export type ColdTierAction =
  | {
      readonly kind: "command"
      readonly stage: ColdTierStage
      readonly mutates: boolean
      readonly condition?: "if-remote-object-missing"
      /** Exact argv passed to the local process launcher. */
      readonly argv: readonly string[]
      /** Exact display argv with local authentication/source paths redacted. */
      readonly redactedArgv: readonly string[]
    }
  | {
      readonly kind: "local-receipt"
      readonly stage: "write-receipt"
      readonly mutates: true
      readonly path: string
      readonly operation: "atomic-create-owner-only"
    }
  | {
      readonly kind: "local-delete"
      readonly stage: "delete-local"
      readonly mutates: true
      readonly path: string
      readonly operation: "unlink-after-reverification"
    }

export type ColdTierStage =
  | "known-host-proof"
  | "remote-preflight"
  | "copy-temp"
  | "verify-promote"
  | "remote-final-verify"
  | "known-host-reverify"

export interface ColdTierTransferResult {
  readonly status: "planned" | "transferred" | "already-complete" | "remote-already-exact"
  readonly sourcePath: string
  readonly receiptPath: string
  readonly remotePath: string
  readonly sha256: string
  readonly bytes: number
  readonly actions: readonly ColdTierAction[]
  readonly receipt?: ColdTierReceipt
}

export interface ColdTierDeletionResult {
  readonly status: "planned" | "deleted" | "already-deleted"
  readonly sourcePath: string
  readonly receiptPath: string
  readonly remotePath: string
  readonly sha256: string
  readonly bytes: number
  readonly actions: readonly ColdTierAction[]
}

export class ColdTierError extends Error {
  readonly stage: string
  readonly exitCode?: number
  readonly redactedArgv?: readonly string[]

  constructor(stage: string, message: string, options: { exitCode?: number; redactedArgv?: readonly string[]; cause?: unknown } = {}) {
    super(`${stage}: ${message}`, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "ColdTierError"
    this.stage = stage
    this.exitCode = options.exitCode
    this.redactedArgv = options.redactedArgv
  }
}

interface ResolvedConfig {
  readonly host: string
  readonly expectedRemoteIdentity: string
  readonly remoteDirectory: string
  readonly knownHostsFile: string
  readonly reserveBytes: number
  readonly executor: ColdTierCommandExecutor
  readonly now: () => Date
  readonly nonce: () => string
}

interface LocalObject {
  readonly sha256: string
  readonly bytes: number
  readonly device: number
  readonly inode: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

interface TransferPlan {
  readonly receiptPath: string
  readonly remotePath: string
  readonly remoteTempPath: string
  readonly knownHostArgv: readonly string[]
  readonly preflightArgv: readonly string[]
  readonly copyArgv: readonly string[]
  readonly promoteArgv: readonly string[]
  readonly finalVerifyArgv: readonly string[]
  readonly actions: readonly ColdTierAction[]
}

export async function transferColdTierObject(input: TransferColdTierObjectInput): Promise<ColdTierTransferResult> {
  const config = resolveConfig(input.config)
  const sourcePath = validateLocalArchivePath(input.sourcePath)
  const receiptPath = validateReceiptPath(input.receiptPath ?? `${sourcePath}.cold-tier-receipt.json`)
  ensureDistinctPaths(sourcePath, receiptPath)
  validateKnownHostsFile(config.knownHostsFile)

  const localObject = await inspectLocalObject(sourcePath)
  const remotePath = `${config.remoteDirectory}/${localObject.sha256}.zst`
  const remoteTempPath = `${config.remoteDirectory}/.${localObject.sha256}.tmp-${config.nonce()}`
  validateRemotePath(remotePath, "remote object path")
  validateRemotePath(remoteTempPath, "remote temporary path")

  const existingReceipt = existsSync(receiptPath) ? readReceipt(receiptPath) : undefined
  if (existingReceipt !== undefined) {
    assertReceiptBinding(existingReceipt, {
      sourcePath,
      host: config.host,
      hostIdentity: config.expectedRemoteIdentity,
      remotePath,
      sha256: localObject.sha256,
      bytes: localObject.bytes,
    })
  }

  const plan = makeTransferPlan(config, sourcePath, receiptPath, remotePath, remoteTempPath, localObject)
  if (input.mode === "dry-run") {
    return {
      status: "planned",
      sourcePath,
      receiptPath,
      remotePath,
      sha256: localObject.sha256,
      bytes: localObject.bytes,
      actions: plan.actions,
      ...(existingReceipt === undefined ? {} : { receipt: existingReceipt }),
    }
  }

  const knownHostEvidenceSha256 = await proveKnownHost(config, plan.knownHostArgv, "known-host-proof", sourcePath)
  const preflight = await runChecked(config, plan.preflightArgv, "remote-preflight", sourcePath)
  const remoteState = parsePreflight(preflight.stdout, config.expectedRemoteIdentity)

  if (remoteState === "MISSING") {
    await runChecked(config, plan.copyArgv, "copy-temp", sourcePath)
    const promoted = await runChecked(config, plan.promoteArgv, "verify-promote", sourcePath)
    parsePromote(promoted.stdout, localObject)
  }

  const finalVerification = await runChecked(config, plan.finalVerifyArgv, "remote-final-verify", sourcePath)
  parseVerify(finalVerification.stdout, config.expectedRemoteIdentity, localObject)
  const repeatedKnownHostEvidence = await proveKnownHost(config, plan.knownHostArgv, "known-host-reverify", sourcePath)
  if (knownHostEvidenceSha256 !== repeatedKnownHostEvidence) {
    throw new ColdTierError("known-host-reverify", "known-host evidence changed during transfer")
  }

  const receipt = existingReceipt ?? makeReceipt(config, sourcePath, remotePath, localObject, knownHostEvidenceSha256)
  if (existingReceipt !== undefined) {
    if (existingReceipt.knownHostEvidenceSha256 !== knownHostEvidenceSha256) {
      throw new ColdTierError("receipt", "existing receipt known-host evidence does not match current proof")
    }
  } else {
    writeReceiptAtomically(receiptPath, receipt)
  }

  return {
    status: existingReceipt !== undefined
      ? "already-complete"
      : remoteState === "EXACT"
        ? "remote-already-exact"
        : "transferred",
    sourcePath,
    receiptPath,
    remotePath,
    sha256: localObject.sha256,
    bytes: localObject.bytes,
    actions: plan.actions,
    receipt,
  }
}

export async function deleteColdTierLocalObject(input: DeleteColdTierLocalObjectInput): Promise<ColdTierDeletionResult> {
  const config = resolveConfig(input.config)
  const sourcePath = validateLocalArchivePath(input.sourcePath, true)
  const receiptPath = validateReceiptPath(input.receiptPath ?? `${sourcePath}.cold-tier-receipt.json`)
  ensureDistinctPaths(sourcePath, receiptPath)
  validateKnownHostsFile(config.knownHostsFile)
  const receipt = readReceipt(receiptPath)
  const expectedRemotePath = `${config.remoteDirectory}/${receipt.sha256}.zst`
  validateRemotePath(expectedRemotePath, "remote object path")
  assertReceiptBinding(receipt, {
    sourcePath,
    host: config.host,
    hostIdentity: config.expectedRemoteIdentity,
    remotePath: expectedRemotePath,
    sha256: receipt.sha256,
    bytes: receipt.bytes,
  })

  const objectBefore = existsSync(sourcePath) ? await inspectLocalObject(sourcePath) : undefined
  if (objectBefore !== undefined && (objectBefore.sha256 !== receipt.sha256 || objectBefore.bytes !== receipt.bytes)) {
    throw new ColdTierError("delete-local", "local object does not match its receipt")
  }

  const knownHostArgv = makeKnownHostArgv(config)
  const verifyArgv = makeRemoteVerifyArgv(config, expectedRemotePath, receipt.sha256, receipt.bytes, false)
  const commandActions: ColdTierAction[] = [
    commandAction("known-host-proof", false, knownHostArgv, sourcePath, config.knownHostsFile),
    commandAction("remote-final-verify", false, verifyArgv, sourcePath, config.knownHostsFile),
    commandAction("known-host-reverify", false, knownHostArgv, sourcePath, config.knownHostsFile),
  ]
  const actions: readonly ColdTierAction[] = [
    ...commandActions,
    { kind: "local-delete", stage: "delete-local", mutates: true, path: sourcePath, operation: "unlink-after-reverification" },
  ]

  if (input.mode === "dry-run") {
    return {
      status: "planned",
      sourcePath,
      receiptPath,
      remotePath: expectedRemotePath,
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      actions,
    }
  }

  const knownHostEvidence = await proveKnownHost(config, knownHostArgv, "known-host-proof", sourcePath)
  if (knownHostEvidence !== receipt.knownHostEvidenceSha256) {
    throw new ColdTierError("receipt", "receipt known-host evidence does not match current proof")
  }
  const finalVerification = await runChecked(config, verifyArgv, "remote-final-verify", sourcePath)
  parseVerify(finalVerification.stdout, config.expectedRemoteIdentity, { sha256: receipt.sha256, bytes: receipt.bytes })
  const repeatedKnownHostEvidence = await proveKnownHost(config, knownHostArgv, "known-host-reverify", sourcePath)
  if (repeatedKnownHostEvidence !== knownHostEvidence) {
    throw new ColdTierError("known-host-reverify", "known-host evidence changed during deletion verification")
  }

  if (!existsSync(sourcePath)) {
    return {
      status: "already-deleted",
      sourcePath,
      receiptPath,
      remotePath: expectedRemotePath,
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      actions,
    }
  }

  const objectAfter = await inspectLocalObject(sourcePath)
  if (
    objectAfter.sha256 !== receipt.sha256
    || objectAfter.bytes !== receipt.bytes
    || (objectBefore !== undefined && !sameLocalObject(objectBefore, objectAfter))
  ) {
    throw new ColdTierError("delete-local", "local object changed during deletion verification")
  }

  try {
    unlinkSync(sourcePath)
  } catch (cause) {
    throw new ColdTierError("delete-local", "could not unlink the verified local object", { cause })
  }

  return {
    status: "deleted",
    sourcePath,
    receiptPath,
    remotePath: expectedRemotePath,
    sha256: receipt.sha256,
    bytes: receipt.bytes,
    actions,
  }
}

function resolveConfig(config: ColdTierConfig): ResolvedConfig {
  const host = config.host ?? "desktop"
  if (!HOST_PATTERN.test(host) || host.includes("..")) throw new ColdTierError("config", "host must be a DNS-style ssh alias")
  const expectedRemoteIdentity = config.expectedRemoteIdentity ?? host
  if (!IDENTITY_PATTERN.test(expectedRemoteIdentity)) throw new ColdTierError("config", "expected remote identity is unsafe")
  const remoteDirectory = validateRemotePath(config.remoteDirectory, "remote directory")
  const knownHostsFile = validateLocalPath(config.knownHostsFile ?? join(homedir(), ".ssh", "known_hosts"), "known_hosts file")
  const reserveBytes = config.reserveBytes ?? 0
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw new ColdTierError("config", "reserveBytes must be a non-negative safe integer")
  return {
    host,
    expectedRemoteIdentity,
    remoteDirectory,
    knownHostsFile,
    reserveBytes,
    executor: config.executor ?? executeCommand,
    now: config.now ?? (() => new Date()),
    nonce: config.nonce ?? randomUUID,
  }
}

function validateRemotePath(path: string, label: string): string {
  if (!isAbsolute(path) || path.length > 1_024 || path === "/" || path.endsWith("/")) {
    throw new ColdTierError("config", `${label} must be a non-root absolute path without a trailing slash`)
  }
  const segments = path.split("/").slice(1)
  if (segments.some((segment) => segment === "." || segment === ".." || !REMOTE_SEGMENT_PATTERN.test(segment))) {
    throw new ColdTierError("config", `${label} contains an unsafe segment`)
  }
  if (!SAFE_REMOTE_TOKEN_PATTERN.test(path)) throw new ColdTierError("config", `${label} is not safe for remote argv transport`)
  return path
}

function validateLocalPath(path: string, label: string): string {
  if (!isAbsolute(path) || path.length > 4_096 || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new ColdTierError("config", `${label} must be an absolute path without control characters`)
  }
  return path
}

function validateLocalArchivePath(path: string, allowMissing = false): string {
  const checked = validateLocalPath(path, "source path")
  if (!basename(checked).endsWith(".zst")) throw new ColdTierError("source", "source must have a .zst suffix")
  if (!allowMissing && !existsSync(checked)) throw new ColdTierError("source", "source archive does not exist")
  return checked
}

function validateReceiptPath(path: string): string {
  const checked = validateLocalPath(path, "receipt path")
  if (!basename(checked).endsWith(".json")) throw new ColdTierError("config", "receipt path must have a .json suffix")
  return checked
}

function ensureDistinctPaths(sourcePath: string, receiptPath: string): void {
  if (sourcePath === receiptPath) throw new ColdTierError("config", "source and receipt paths must differ")
}

function validateKnownHostsFile(path: string): void {
  let info
  try {
    info = lstatSync(path)
  } catch (cause) {
    throw new ColdTierError("known-host-proof", "known_hosts file does not exist", { cause })
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new ColdTierError("known-host-proof", "known_hosts must be a regular non-symlink file")
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new ColdTierError("known-host-proof", "known_hosts is not owned by the current user")
  if ((info.mode & 0o022) !== 0) throw new ColdTierError("known-host-proof", "known_hosts is group- or world-writable")
}

async function inspectLocalObject(path: string): Promise<LocalObject> {
  const before = localStat(path)
  const digest = createHash("sha256")
  try {
    for await (const chunk of createReadStream(path)) digest.update(chunk)
  } catch (cause) {
    throw new ColdTierError("source", "could not hash source archive", { cause })
  }
  const after = localStat(path)
  if (!sameLocalObject(before, after)) throw new ColdTierError("source", "source archive changed while it was being hashed")
  return { ...after, sha256: digest.digest("hex") }
}

function localStat(path: string): Omit<LocalObject, "sha256"> {
  let info
  try {
    info = lstatSync(path)
  } catch (cause) {
    throw new ColdTierError("source", "source archive is unavailable", { cause })
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new ColdTierError("source", "source archive must be a regular non-symlink file")
  if (!Number.isSafeInteger(info.size) || info.size < 0) throw new ColdTierError("source", "source archive size is invalid")
  return {
    bytes: info.size,
    device: info.dev,
    inode: info.ino,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
  }
}

function sameLocalObject(left: Omit<LocalObject, "sha256">, right: Omit<LocalObject, "sha256">): boolean {
  return left.bytes === right.bytes
    && left.device === right.device
    && left.inode === right.inode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

function makeTransferPlan(
  config: ResolvedConfig,
  sourcePath: string,
  receiptPath: string,
  remotePath: string,
  remoteTempPath: string,
  object: LocalObject,
): TransferPlan {
  const knownHostArgv = makeKnownHostArgv(config)
  const preflightArgv = makeSshArgv(config, REMOTE_PREFLIGHT_SCRIPT, [
    config.remoteDirectory,
    remotePath,
    object.sha256,
    String(object.bytes),
    config.expectedRemoteIdentity,
    String(config.reserveBytes),
  ])
  const copyArgv = [
    "scp",
    "-q",
    "-B",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${config.knownHostsFile}`,
    sourcePath,
    `${config.host}:${remoteTempPath}`,
  ] as const
  const promoteArgv = makeSshArgv(config, REMOTE_PROMOTE_SCRIPT, [
    config.remoteDirectory,
    remoteTempPath,
    remotePath,
    object.sha256,
    String(object.bytes),
  ])
  const finalVerifyArgv = makeRemoteVerifyArgv(config, remotePath, object.sha256, object.bytes, true)
  const actions: readonly ColdTierAction[] = [
    commandAction("known-host-proof", false, knownHostArgv, sourcePath, config.knownHostsFile),
    commandAction("remote-preflight", false, preflightArgv, sourcePath, config.knownHostsFile),
    commandAction("copy-temp", true, copyArgv, sourcePath, config.knownHostsFile, "if-remote-object-missing"),
    commandAction("verify-promote", true, promoteArgv, sourcePath, config.knownHostsFile, "if-remote-object-missing"),
    commandAction("remote-final-verify", false, finalVerifyArgv, sourcePath, config.knownHostsFile),
    commandAction("known-host-reverify", false, knownHostArgv, sourcePath, config.knownHostsFile),
    { kind: "local-receipt", stage: "write-receipt", mutates: true, path: receiptPath, operation: "atomic-create-owner-only" },
  ]
  return { receiptPath, remotePath, remoteTempPath, knownHostArgv, preflightArgv, copyArgv, promoteArgv, finalVerifyArgv, actions }
}

function makeKnownHostArgv(config: ResolvedConfig): readonly string[] {
  return ["ssh-keygen", "-F", config.host, "-f", config.knownHostsFile]
}

function makeSshArgv(config: ResolvedConfig, script: string, args: readonly string[]): readonly string[] {
  for (const argument of args) {
    if (!SAFE_REMOTE_TOKEN_PATTERN.test(argument)) throw new ColdTierError("config", "unsafe remote command argument")
  }
  const remoteCommand = `sh -c ${quoteShellConstant(script)} cold-tier ${args.join(" ")}`
  return [
    "ssh",
    "-x",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${config.knownHostsFile}`,
    config.host,
    remoteCommand,
  ]
}

function makeRemoteVerifyArgv(
  config: ResolvedConfig,
  remotePath: string,
  digest: string,
  bytes: number,
  fsync: boolean,
): readonly string[] {
  return makeSshArgv(config, REMOTE_VERIFY_SCRIPT, [
    config.remoteDirectory,
    remotePath,
    digest,
    String(bytes),
    config.expectedRemoteIdentity,
    fsync ? "yes" : "no",
  ])
}

function quoteShellConstant(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function commandAction(
  stage: ColdTierStage,
  mutates: boolean,
  argv: readonly string[],
  sourcePath: string,
  knownHostsFile: string,
  condition?: "if-remote-object-missing",
): ColdTierAction {
  return {
    kind: "command",
    stage,
    mutates,
    ...(condition === undefined ? {} : { condition }),
    argv,
    redactedArgv: redactArgv(argv, sourcePath, knownHostsFile),
  }
}

function redactArgv(argv: readonly string[], sourcePath: string, knownHostsFile: string): readonly string[] {
  return argv.map((argument) => {
    if (argument === sourcePath) return "<LOCAL_ARCHIVE>"
    if (argument === knownHostsFile) return "<KNOWN_HOSTS_FILE>"
    if (argument === `UserKnownHostsFile=${knownHostsFile}`) return "UserKnownHostsFile=<KNOWN_HOSTS_FILE>"
    return argument
  })
}

async function proveKnownHost(
  config: ResolvedConfig,
  argv: readonly string[],
  stage: "known-host-proof" | "known-host-reverify",
  sourcePath: string,
): Promise<string> {
  validateKnownHostsFile(config.knownHostsFile)
  const result = await runChecked(config, argv, stage, sourcePath)
  const keyLines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .sort()
  if (keyLines.length === 0) throw new ColdTierError(stage, `no known-host evidence exists for ${config.host}`)
  return createHash("sha256").update(keyLines.join("\n"), "utf8").digest("hex")
}

async function runChecked(
  config: ResolvedConfig,
  argv: readonly string[],
  stage: ColdTierStage,
  sourcePath: string,
): Promise<ColdTierCommandResult> {
  let result: ColdTierCommandResult
  try {
    result = await config.executor(argv)
  } catch (cause) {
    throw new ColdTierError(stage, "command launch failed", {
      redactedArgv: redactArgv(argv, sourcePath, config.knownHostsFile),
      cause,
    })
  }
  if (!Number.isInteger(result.exitCode) || result.exitCode !== 0) {
    throw new ColdTierError(stage, sanitizeCommandFailure(result.stderr), {
      exitCode: result.exitCode,
      redactedArgv: redactArgv(argv, sourcePath, config.knownHostsFile),
    })
  }
  return result
}

async function executeCommand(argv: readonly string[]): Promise<ColdTierCommandResult> {
  const subprocess = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(subprocess.stdout, MAX_COMMAND_OUTPUT_BYTES),
      readBoundedStream(subprocess.stderr, MAX_COMMAND_OUTPUT_BYTES),
      subprocess.exited,
    ])
    return { exitCode, stdout, stderr }
  } catch (cause) {
    subprocess.kill()
    await subprocess.exited
    throw cause
  }
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) throw new Error(`command output exceeds ${limit} bytes`)
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function sanitizeCommandFailure(stderr: string): string {
  const normalized = stderr.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
  return normalized.length === 0 ? "command failed without diagnostics" : normalized.slice(0, 2_048)
}

function parsePreflight(stdout: string, expectedIdentity: string): "EXACT" | "MISSING" {
  const fields = singleProtocolLine(stdout, "PREFLIGHT", 4)
  if (fields[1] !== expectedIdentity) throw new ColdTierError("remote-preflight", "remote identity proof is inconsistent")
  parseUnsignedInteger(fields[2], "remote-preflight", "free-space proof")
  if (fields[3] !== "EXACT" && fields[3] !== "MISSING") throw new ColdTierError("remote-preflight", "invalid remote object state")
  return fields[3]
}

function parsePromote(stdout: string, object: Pick<LocalObject, "sha256" | "bytes">): void {
  const fields = singleProtocolLine(stdout, "PROMOTE", 4)
  if (fields[1] !== object.sha256 || fields[2] !== String(object.bytes)) {
    throw new ColdTierError("verify-promote", "remote promotion proof does not match the local object")
  }
  if (fields[3] !== "PROMOTED" && fields[3] !== "EXACT") throw new ColdTierError("verify-promote", "invalid remote promotion state")
}

function parseVerify(stdout: string, expectedIdentity: string, object: Pick<LocalObject, "sha256" | "bytes">): void {
  const fields = singleProtocolLine(stdout, "VERIFY", 4)
  if (fields[1] !== expectedIdentity || fields[2] !== object.sha256 || fields[3] !== String(object.bytes)) {
    throw new ColdTierError("remote-final-verify", "remote verification proof does not match the expected object and identity")
  }
}

function singleProtocolLine(stdout: string, tag: string, fieldCount: number): readonly string[] {
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 1) throw new ColdTierError(tag.toLowerCase(), "remote command returned unexpected output")
  const fields = lines[0]!.split("\t")
  if (fields.length !== fieldCount || fields[0] !== tag) throw new ColdTierError(tag.toLowerCase(), "remote command returned an invalid proof")
  return fields
}

function parseUnsignedInteger(value: string, stage: string, label: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new ColdTierError(stage, `${label} is not an unsigned integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new ColdTierError(stage, `${label} exceeds the safe integer range`)
  return parsed
}

function makeReceipt(
  config: ResolvedConfig,
  sourcePath: string,
  remotePath: string,
  object: LocalObject,
  knownHostEvidenceSha256: string,
): ColdTierReceipt {
  const verifiedAt = config.now().toISOString()
  return {
    version: RECEIPT_VERSION,
    sourcePath,
    host: config.host,
    hostIdentity: config.expectedRemoteIdentity,
    knownHostEvidenceSha256,
    remotePath,
    sha256: object.sha256,
    bytes: object.bytes,
    verifiedAt,
  }
}

function writeReceiptAtomically(path: string, receipt: ColdTierReceipt): void {
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  validateReceiptDirectory(parent)
  const content = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8")
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  let descriptor: number | undefined
  try {
    descriptor = openSync(tempPath, "wx", 0o600)
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    try {
      linkSync(tempPath, path)
    } catch (cause) {
      if (!existsSync(path)) throw cause
      const racedReceipt = readReceipt(path)
      assertReceiptBinding(racedReceipt, receipt)
    }
    unlinkSync(tempPath)
    fsyncDirectory(parent)
  } catch (cause) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* preserve the original failure */ }
    }
    try { unlinkSync(tempPath) } catch { /* preserve the original failure */ }
    if (cause instanceof ColdTierError) throw cause
    throw new ColdTierError("write-receipt", "could not atomically create the local receipt", { cause })
  }
}

function validateReceiptDirectory(path: string): void {
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ColdTierError("write-receipt", "receipt parent must be a regular directory")
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new ColdTierError("write-receipt", "receipt parent is not owned by the current user")
  if ((info.mode & 0o022) !== 0) throw new ColdTierError("write-receipt", "receipt parent is group- or world-writable")
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function readReceipt(path: string): ColdTierReceipt {
  let info
  try {
    info = lstatSync(path)
  } catch (cause) {
    throw new ColdTierError("receipt", "receipt does not exist", { cause })
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new ColdTierError("receipt", "receipt must be a regular non-symlink file")
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new ColdTierError("receipt", "receipt is not owned by the current user")
  if ((info.mode & 0o077) !== 0) throw new ColdTierError("receipt", "receipt must be owner-only")
  if (info.size > MAX_RECEIPT_BYTES) throw new ColdTierError("receipt", "receipt exceeds the size limit")

  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (cause) {
    throw new ColdTierError("receipt", "receipt is not valid JSON", { cause })
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ColdTierError("receipt", "receipt must be an object")
  const record = value as Record<string, unknown>
  const expectedKeys = ["bytes", "host", "hostIdentity", "knownHostEvidenceSha256", "remotePath", "sha256", "sourcePath", "verifiedAt", "version"]
  if (Object.keys(record).sort().join("\n") !== expectedKeys.join("\n")) throw new ColdTierError("receipt", "receipt fields do not match version 1")
  if (record.version !== RECEIPT_VERSION) throw new ColdTierError("receipt", "unsupported receipt version")
  if (typeof record.sourcePath !== "string") throw new ColdTierError("receipt", "invalid sourcePath")
  if (typeof record.host !== "string" || !HOST_PATTERN.test(record.host)) throw new ColdTierError("receipt", "invalid host")
  if (typeof record.hostIdentity !== "string" || !IDENTITY_PATTERN.test(record.hostIdentity)) throw new ColdTierError("receipt", "invalid hostIdentity")
  if (typeof record.knownHostEvidenceSha256 !== "string" || !SHA256_PATTERN.test(record.knownHostEvidenceSha256)) throw new ColdTierError("receipt", "invalid known-host digest")
  if (typeof record.remotePath !== "string") throw new ColdTierError("receipt", "invalid remotePath")
  validateRemotePath(record.remotePath, "receipt remote path")
  if (typeof record.sha256 !== "string" || !SHA256_PATTERN.test(record.sha256)) throw new ColdTierError("receipt", "invalid object digest")
  if (typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new ColdTierError("receipt", "invalid object size")
  if (typeof record.verifiedAt !== "string" || !isCanonicalTimestamp(record.verifiedAt)) throw new ColdTierError("receipt", "invalid verification timestamp")
  return record as unknown as ColdTierReceipt
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
}

function assertReceiptBinding(
  actual: ColdTierReceipt,
  expected: Pick<ColdTierReceipt, "sourcePath" | "host" | "hostIdentity" | "remotePath" | "sha256" | "bytes">
    & Partial<Pick<ColdTierReceipt, "knownHostEvidenceSha256">>,
): void {
  if (
    actual.sourcePath !== expected.sourcePath
    || actual.host !== expected.host
    || actual.hostIdentity !== expected.hostIdentity
    || actual.remotePath !== expected.remotePath
    || actual.sha256 !== expected.sha256
    || actual.bytes !== expected.bytes
    || (expected.knownHostEvidenceSha256 !== undefined && actual.knownHostEvidenceSha256 !== expected.knownHostEvidenceSha256)
  ) {
    throw new ColdTierError("receipt", "receipt does not exactly match the requested object and destination")
  }
}
