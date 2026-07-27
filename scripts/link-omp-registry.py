#!/usr/bin/env python3
"""Transactional immutable OMP release registry. Invoked only by link-omp.sh."""
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

RECEIPT_KEYS = {"schemaVersion", "buildDigest", "version", "runnerInstanceId", "fixtureSessionId", "ownerEpoch", "startedAt", "stoppedAt", "initialSnapshotRevision", "finalSnapshotRevision", "commandId", "proof"}
PROOF_KEYS = {"mutationAppliedExactlyOnce", "leaseReleased", "leaseReacquired", "jsonlPersisted", "queuePersisted"}
REGISTRY_KEYS = {"schemaVersion", "stable", "previous", "candidate", "receiptDigest", "timestamps"}
TIMESTAMP_KEYS = {"candidate", "blessed", "rollback"}
HEX = set("0123456789abcdef")


def fail(message):
    raise SystemExit(f"link-omp: {message}")


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value, label):
    if not isinstance(value, str) or not value.endswith("Z"):
        fail(f"invalid {label}")
    try:
        return dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        fail(f"invalid {label}")


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, separators=(",", ":"), sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def selected_digest(link, releases):
    if not link.is_symlink(): return None
    try: target = pathlib.Path(os.readlink(link))
    except OSError: fail("cannot inspect stable selector")
    if not target.is_absolute(): target = link.parent / target
    name = target.name
    if target.parent.resolve() != releases.resolve() or not name.startswith("omp-"):
        fail("stable selector has an ambiguous target")
    value = name[4:]
    valid_release(releases, value)
    return value


def sync_selectors(bin_dir, releases, registry):
    if registry["previous"]:
        atomic_link(bin_dir / "omp.previous", valid_release(releases, registry["previous"]))
    else:
        (bin_dir / "omp.previous").unlink(missing_ok=True)
    if registry["stable"]:
        atomic_link(bin_dir / "omp", valid_release(releases, registry["stable"]))
    else:
        (bin_dir / "omp").unlink(missing_ok=True)
    sync_directory(bin_dir)


def recover_pending(bin_dir, releases, registry_path, pending_path):
    if not pending_path.exists(): return
    try: pending = json.loads(pending_path.read_text())
    except (OSError, json.JSONDecodeError): fail("promotion transaction journal is corrupt")
    if not isinstance(pending, dict) or set(pending) != {"op", "from", "to", "registryBefore", "registryAfter"}:
        fail("promotion transaction journal has unexpected fields")
    actual = selected_digest(bin_dir / "omp", releases)
    if actual == pending["to"]: chosen = pending["registryAfter"]
    elif actual == pending["from"]: chosen = pending["registryBefore"]
    else: fail("promotion transaction selector is ambiguous")
    atomic_json(registry_path, chosen)
    sync_selectors(bin_dir, releases, chosen)
    pending_path.unlink()
    sync_directory(bin_dir)


def crash(point):
    if os.environ.get("OMP_LINK_CRASH_AT") == point: os._exit(97)


def commit_selection(op, bin_dir, releases, registry_path, pending_path, before, after):
    pending = {"op": op, "from": before["stable"], "to": after["stable"], "registryBefore": before, "registryAfter": after}
    atomic_json(pending_path, pending)
    sync_directory(bin_dir)
    crash("after-journal")
    atomic_link(bin_dir / "omp", valid_release(releases, after["stable"]))
    sync_directory(bin_dir)
    crash("after-selector")
    atomic_json(registry_path, after)
    crash("after-registry")
    sync_selectors(bin_dir, releases, after)
    pending_path.unlink()
    sync_directory(bin_dir)


def atomic_link(path, target):
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    try:
        temporary.symlink_to(target)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def empty_registry():
    return {"schemaVersion": 1, "stable": None, "previous": None, "candidate": None, "receiptDigest": None, "timestamps": {"candidate": None, "blessed": None, "rollback": None}}


def load_registry(path):
    if not path.exists(): return empty_registry()
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        fail("registry is not valid JSON")
    if not isinstance(value, dict) or set(value) != REGISTRY_KEYS or value["schemaVersion"] != 1:
        fail("registry has unexpected fields or schema")
    if not isinstance(value["timestamps"], dict) or set(value["timestamps"]) != TIMESTAMP_KEYS:
        fail("registry timestamps have unexpected fields")
    for key in ("stable", "previous", "candidate", "receiptDigest"):
        item = value[key]
        if item is not None and (not isinstance(item, str) or len(item) != 64 or any(c not in HEX for c in item)):
            fail(f"registry {key} is invalid")
    for item in value["timestamps"].values():
        if item is not None: parse_time(item, "registry timestamp")
    return value


def valid_release(releases, value):
    if value is None: return None
    path = releases / f"omp-{value}"
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK) or digest(path) != value:
        fail(f"immutable release is missing or corrupt: {value}")
    return path


def strict_build(release, expected):
    result = subprocess.run([release, "--runner-build-revision"], capture_output=True, text=True)
    if result.returncode != 0: fail("candidate build identity command failed")
    try: value = json.loads(result.stdout)
    except json.JSONDecodeError: fail("candidate returned invalid build identity JSON")
    if not isinstance(value, dict) or set(value) != {"buildDigest", "version"}:
        fail("candidate build identity has unexpected fields")
    if value["buildDigest"] != expected or not isinstance(value["version"], str) or not value["version"]:
        fail("candidate build identity does not match materialized bytes")
    return value


def strict_receipt(path, expected_digest, expected_version, candidate_at):
    try:
        raw = path.read_bytes(); value = json.loads(raw)
    except (OSError, json.JSONDecodeError): fail("readiness receipt is not valid JSON")
    if not isinstance(value, dict) or set(value) != RECEIPT_KEYS or value["schemaVersion"] != 1:
        fail("readiness receipt has unexpected fields or schema")
    if value["buildDigest"] != expected_digest or value["version"] != expected_version:
        fail("readiness receipt build identity mismatch")
    proof = value["proof"]
    if not isinstance(proof, dict) or set(proof) != PROOF_KEYS or any(proof[key] is not True for key in PROOF_KEYS):
        fail("readiness receipt proof is incomplete")
    for key in ("runnerInstanceId", "fixtureSessionId", "ownerEpoch", "commandId"):
        if not isinstance(value[key], str) or not value[key]: fail(f"invalid receipt {key}")
    initial, final = value["initialSnapshotRevision"], value["finalSnapshotRevision"]
    if isinstance(initial, bool) or isinstance(final, bool) or not isinstance(initial, int) or not isinstance(final, int) or final <= initial:
        fail("receipt snapshot revision did not advance")
    started, stopped = parse_time(value["startedAt"], "receipt startedAt"), parse_time(value["stoppedAt"], "receipt stoppedAt")
    now = dt.datetime.now(dt.timezone.utc)
    max_age = int(os.environ.get("OMP_LINK_RECEIPT_MAX_AGE_SECONDS", "900"))
    max_run = int(os.environ.get("OMP_LINK_RECEIPT_MAX_RUN_SECONDS", "600"))
    if stopped < started or started < parse_time(candidate_at, "candidate timestamp") or (stopped - started).total_seconds() > max_run or stopped > now + dt.timedelta(seconds=5) or (now - stopped).total_seconds() > max_age:
        fail("readiness receipt predates the candidate, is stale/future-dated, or exceeds its bounded run")
    return hashlib.sha256(raw).hexdigest()

def authoritative_receipt(bin_dir, release, expected, version, candidate_at):
    fixture_root = os.environ.get("OMP_LINK_READINESS_FIXTURE_ROOT")
    if not fixture_root:
        fail("OMP_LINK_READINESS_FIXTURE_ROOT is required for an independent readiness run")
    driver = pathlib.Path(__file__).resolve().parent.parent / "packages/coding-agent/scripts/runner-canary-readiness.ts"
    if driver.is_symlink() or not driver.is_file():
        fail("pinned readiness driver is missing or unsafe")
    fd, output = tempfile.mkstemp(prefix=".omp-authoritative-receipt.", dir=bin_dir)
    os.close(fd); os.unlink(output)
    try:
        result = subprocess.run(["bun", str(driver), "--candidate", str(release), "--fixture-root", fixture_root, "--output", output], capture_output=True, text=True)
        if result.returncode != 0:
            fail(f"independent candidate readiness failed: {result.stderr.strip()}")
        return strict_receipt(pathlib.Path(output), expected, version, candidate_at)
    finally:
        pathlib.Path(output).unlink(missing_ok=True)



def main():
    if len(sys.argv) < 3: fail("internal registry helper usage")
    command, bin_arg, *args = sys.argv[1:]
    bin_dir = pathlib.Path(bin_arg)
    releases = bin_dir / ".omp-releases"
    registry_path = bin_dir / ".omp-release-registry.json"
    pending_path = bin_dir / ".omp-release-transaction.json"
    releases.mkdir(parents=True, exist_ok=True)
    lock_path = bin_dir / ".omp-release-registry.lock"
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        recover_pending(bin_dir, releases, registry_path, pending_path)
        registry = load_registry(registry_path)
        if registry["stable"] is None:
            adopted = selected_digest(bin_dir / "omp", releases)
            if adopted is not None:
                registry["stable"] = adopted
                atomic_json(registry_path, registry)
        if command == "candidate":
            if len(args) != 1: fail("candidate requires an executable binary")
            source = pathlib.Path(args[0]).resolve()
            if not source.is_file() or not os.access(source, os.X_OK): fail(f"candidate is not an executable file: {args[0]}")
            expected = digest(source); release = releases / f"omp-{expected}"
            if release.exists() or release.is_symlink(): valid_release(releases, expected)
            else:
                fd, temporary = tempfile.mkstemp(prefix=f".omp-{expected}.", dir=releases); os.close(fd)
                try:
                    shutil.copyfile(source, temporary); os.chmod(temporary, 0o555)
                    if digest(temporary) != expected: fail("candidate changed while being materialized")
                    os.replace(temporary, release)
                finally:
                    if os.path.exists(temporary): os.unlink(temporary)
            strict_build(release, expected)
            registry["candidate"] = expected; registry["receiptDigest"] = None; registry["timestamps"]["candidate"] = timestamp()
            atomic_json(registry_path, registry)
            print(expected)
        elif command == "bless":
            if len(args) != 2: fail("bless requires a candidate digest and readiness receipt")
            expected, receipt_path = args[0], pathlib.Path(args[1])
            if registry["candidate"] != expected: fail("candidate registry changed or digest is not current")
            release = valid_release(releases, expected); build = strict_build(release, expected)
            strict_receipt(receipt_path, expected, build["version"], registry["timestamps"]["candidate"])
            receipt_digest = authoritative_receipt(bin_dir, release, expected, build["version"], registry["timestamps"]["candidate"])
            before = copy.deepcopy(registry)
            old = registry["stable"]
            if old is not None: valid_release(releases, old)
            registry["previous"] = old if old != expected else registry["previous"]
            registry["stable"] = expected; registry["candidate"] = None; registry["receiptDigest"] = receipt_digest; registry["timestamps"]["blessed"] = timestamp()
            commit_selection("bless", bin_dir, releases, registry_path, pending_path, before, registry)
            print(expected)
        elif command == "recover":
            if args: fail("recover takes no arguments")
            print(registry["stable"] or "")
        elif command == "rollback":
            if args: fail("rollback takes no arguments")
            prior = valid_release(releases, registry["previous"])
            if prior is None: fail("no valid immutable previous release to restore")
            valid_release(releases, registry["stable"])
            before = copy.deepcopy(registry)
            registry["stable"], registry["previous"], registry["candidate"] = registry["previous"], registry["stable"], None
            registry["receiptDigest"] = None; registry["timestamps"]["rollback"] = timestamp()
            commit_selection("rollback", bin_dir, releases, registry_path, pending_path, before, registry)
            print(registry["stable"])
        else: fail(f"unknown internal command: {command}")

if __name__ == "__main__": main()
