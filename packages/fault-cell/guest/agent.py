#!/usr/bin/env python3
"""fault-cell guest agent.

Speaks newline-delimited JSON over a virtio-serial port to the host runner. Stdlib only:
the guest closure must stay small and must never depend on the application under test.

Every reply is either {"ok": true, "result": ...} or {"ok": false, "error": {...}} with a
stable machine code. The agent never decides whether a scenario passed; it only reports
what it observed. Host-side schemas reject anything that does not match.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import selectors
import signal
import socket
import subprocess
import sys
import tarfile
import time
import sqlite3

AGENT_VERSION = "0.1.0"
PROTOCOL_VERSION = 1
RUN_DIR = "/run/faultcell"
BARRIER_SOCKET = f"{RUN_DIR}/barrier.sock"
BIN_DIR = f"{RUN_DIR}/bin"
SCRATCH_DIR = "/var/lib/faultcell"
CGROUP_ROOT = "/sys/fs/cgroup"
BALLOON_NAME = ".faultcell-balloon"
CHUNK = 1 << 20

SIGNALS = {
    "SIGTERM": signal.SIGTERM,
    "SIGKILL": signal.SIGKILL,
    "SIGINT": signal.SIGINT,
    "SIGHUP": signal.SIGHUP,
    "SIGSTOP": signal.SIGSTOP,
    "SIGCONT": signal.SIGCONT,
    "SIGUSR1": signal.SIGUSR1,
    "SIGUSR2": signal.SIGUSR2,
}
SIGNAL_NAMES = {value: name for name, value in SIGNALS.items()}


class OpError(Exception):
    def __init__(self, code: str, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def read_start_ticks(pid: int) -> int:
    """Process start time in clock ticks, which fences a recycled pid against a stale one."""
    with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
        raw = handle.read()
    tail = raw[raw.rindex(")") + 2 :].split()
    return int(tail[19])


def statvfs_free(path: str) -> tuple[int, int]:
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize, stats.f_blocks * stats.f_frsize


def sha256_file(path: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(CHUNK)
            if not block:
                break
            total += len(block)
            digest.update(block)
    return digest.hexdigest(), total


def run_command(argv: list[str], allow_fail: bool = False) -> str:
    completed = subprocess.run(argv, capture_output=True, text=True, check=False)
    if completed.returncode != 0 and not allow_fail:
        raise OpError(
            "command-failed",
            f"{argv[0]} exited {completed.returncode}",
            (completed.stderr or completed.stdout).strip()[:1024],
        )
    return completed.stdout


def json_safe(value: object) -> object:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, (int, float, str)) or value is None or isinstance(value, bool):
        return value
    return str(value)


class Child:
    def __init__(
        self,
        name: str,
        incarnation: int,
        popen: subprocess.Popen[bytes],
        argv: list[str],
        cgroup: str,
        tz: str | None,
    ) -> None:
        self.name = name
        self.incarnation = incarnation
        self.popen = popen
        self.argv = argv
        self.cgroup = cgroup
        self.tz = tz
        self.start_ticks = read_start_ticks(popen.pid)
        self.started_at_wall_ms = time.time() * 1000.0
        self.exited = False

    def describe(self) -> dict[str, object]:
        return {
            "process": self.name,
            "incarnation": self.incarnation,
            "pid": self.popen.pid,
            "startTicks": self.start_ticks,
            "cgroup": self.cgroup,
            "argv": self.argv,
            "tz": self.tz,
            "startedAtWallMs": self.started_at_wall_ms,
        }


class Agent:
    def __init__(self, port: str, spec_path: str, share: str) -> None:
        self.port_path = port
        self.share = share
        with open(spec_path, "r", encoding="utf-8") as handle:
            self.spec = json.load(handle)
        self.port = None  # type: ignore[assignment]
        self.selector = selectors.DefaultSelector()
        self.children: dict[str, Child] = {}
        self.history: list[Child] = []
        self.incarnations: dict[str, int] = {}
        self.tz_overrides: dict[str, str] = {}
        self.mounts: dict[str, dict[str, object]] = {}
        self.holds: dict[str, subprocess.Popen[bytes]] = {}
        self.barrier_counts: dict[str, int] = {}
        self.cgroup_base = ""
        self.exit_queue: list[dict[str, object]] = []

    # ---------------------------------------------------------------- setup

    def setup(self) -> None:
        os.makedirs(BIN_DIR, exist_ok=True)
        os.makedirs(SCRATCH_DIR, exist_ok=True)
        os.makedirs(os.path.join(self.share, "artifacts"), exist_ok=True)
        self.setup_cgroups()
        self.setup_barrier_socket()
        self.setup_barrier_helper()
        self.open_port()

    def setup_cgroups(self) -> None:
        with open("/proc/self/cgroup", "r", encoding="utf-8") as handle:
            own = handle.read().strip().split("::")[-1]
        base = os.path.join(CGROUP_ROOT, own.lstrip("/"))
        supervisor = os.path.join(base, "supervisor")
        try:
            os.makedirs(supervisor, exist_ok=True)
            with open(os.path.join(supervisor, "cgroup.procs"), "w", encoding="utf-8") as handle:
                handle.write(str(os.getpid()))
            available = ""
            with open(os.path.join(base, "cgroup.controllers"), "r", encoding="utf-8") as handle:
                available = handle.read().split()
            wanted = " ".join(f"+{name}" for name in ("memory", "cpu") if name in available)
            if wanted:
                with open(
                    os.path.join(base, "cgroup.subtree_control"), "w", encoding="utf-8"
                ) as handle:
                    handle.write(wanted)
            self.cgroup_base = base
        except OSError as error:
            # Recorded, never silently ignored: cgroup faults will fail with a typed error.
            self.cgroup_base = ""
            self.log("warn", f"cgroup delegation unavailable: {error}")

    def setup_barrier_socket(self) -> None:
        if os.path.exists(BARRIER_SOCKET):
            os.unlink(BARRIER_SOCKET)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        server.bind(BARRIER_SOCKET)
        os.chmod(BARRIER_SOCKET, 0o666)
        self.barrier_socket = server
        self.selector.register(server, selectors.EVENT_READ, "barrier")

    def setup_barrier_helper(self) -> None:
        helper = os.path.join(BIN_DIR, "faultcell-barrier")
        with open(helper, "w", encoding="utf-8") as handle:
            handle.write(
                "#!/usr/bin/env python3\n"
                "import socket, sys, json\n"
                "name = sys.argv[1]\n"
                "detail = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}\n"
                "s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)\n"
                f"s.sendto(json.dumps({{'name': name, 'detail': detail}}).encode(), {BARRIER_SOCKET!r})\n"
            )
        os.chmod(helper, 0o755)

    def open_port(self) -> None:
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            if os.path.exists(self.port_path):
                break
            time.sleep(0.1)
        self.port = os.open(self.port_path, os.O_RDWR)
        self.selector.register(self.port, selectors.EVENT_READ, "control")

    # ------------------------------------------------------------- transport

    def emit(self, payload: dict[str, object]) -> None:
        line = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        while line:
            written = os.write(self.port, line)
            line = line[written:]

    def log(self, level: str, message: str) -> None:
        if self.port is None:
            print(f"[{level}] {message}", file=sys.stderr, flush=True)
            return
        self.emit({"kind": "event", "event": "log", "level": level, "message": message})

    def emit_ready(self) -> None:
        with open("/proc/sys/kernel/random/boot_id", "r", encoding="utf-8") as handle:
            boot_id = handle.read().strip()
        self.emit(
            {
                "kind": "event",
                "event": "ready",
                "protocolVersion": PROTOCOL_VERSION,
                "agent": {
                    "version": AGENT_VERSION,
                    "python": sys.version.split()[0],
                    "kernel": os.uname().release,
                    "bootId": boot_id,
                    "cgroupVersion": 2 if os.path.exists(f"{CGROUP_ROOT}/cgroup.controllers") else 1,
                    "tz": time.tzname[0],
                },
            }
        )

    # ------------------------------------------------------------- main loop

    def serve(self) -> None:
        buffer = b""
        self.emit_ready()
        while True:
            for key, _mask in self.selector.select(timeout=0.25):
                if key.data == "control":
                    chunk = os.read(self.port, 65536)
                    if not chunk:
                        return
                    buffer += chunk
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        if line.strip():
                            self.handle_line(line)
                elif key.data == "barrier":
                    self.handle_barrier(self.barrier_socket.recv(65536))
            self.reap()

    def handle_barrier(self, payload: bytes) -> None:
        try:
            decoded = json.loads(payload.decode("utf-8"))
            name = str(decoded["name"])
            detail = decoded.get("detail") or {}
        except (ValueError, KeyError):
            name = payload.decode("utf-8", "replace").strip()
            detail = {}
        count = self.barrier_counts.get(name, 0) + 1
        self.barrier_counts[name] = count
        self.emit(
            {
                "kind": "event",
                "event": "barrier",
                "name": name,
                "occurrence": count,
                "detail": detail if isinstance(detail, dict) else {},
                "monotonicNs": time.monotonic_ns(),
                "wallMs": time.time() * 1000.0,
            }
        )

    def reap(self) -> None:
        for name, child in list(self.children.items()):
            code = child.popen.poll()
            if code is None:
                continue
            child.exited = True
            del self.children[name]
            self.history.append(child)
            self.emit(
                {
                    "kind": "event",
                    "event": "exit",
                    "exit": {
                        "process": child.name,
                        "incarnation": child.incarnation,
                        "pid": child.popen.pid,
                        "startTicks": child.start_ticks,
                        "exitCode": code if code >= 0 else None,
                        "termSignal": SIGNAL_NAMES.get(-code) if code < 0 else None,
                        "monotonicNs": time.monotonic_ns(),
                        "wallMs": time.time() * 1000.0,
                    },
                }
            )

    def handle_line(self, line: bytes) -> None:
        try:
            request = json.loads(line.decode("utf-8"))
            request_id = int(request["id"])
            op = str(request["op"])
        except (ValueError, KeyError, TypeError) as error:
            self.log("error", f"undecodable request: {error}")
            return
        try:
            result = self.dispatch(op, request)
            self.emit({"kind": "reply", "id": request_id, "ok": True, "op": op, "result": result})
        except OpError as error:
            self.emit(
                {
                    "kind": "reply",
                    "id": request_id,
                    "ok": False,
                    "op": op,
                    "error": {
                        "code": error.code,
                        "message": error.message,
                        "detail": error.detail,
                    },
                }
            )
        except Exception as error:  # noqa: BLE001 - boundary: every failure must be typed
            self.emit(
                {
                    "kind": "reply",
                    "id": request_id,
                    "ok": False,
                    "op": op,
                    "error": {
                        "code": "internal",
                        "message": f"{type(error).__name__}: {error}",
                        "detail": "",
                    },
                }
            )

    def dispatch(self, op: str, request: dict[str, object]) -> object:
        handler = getattr(self, f"op_{op.replace('-', '_')}", None)
        if handler is None:
            raise OpError("unknown-op", f"guest agent does not implement {op}")
        return handler(request)

    # ------------------------------------------------------------ operations

    def op_hello(self, _request: dict[str, object]) -> object:
        return {"acknowledged": True}

    def op_mountScratch(self, request: dict[str, object]) -> object:
        name = str(request["mount"])
        path = str(request["path"])
        quota_mib = int(request["quotaMiB"])
        fs = str(request["fs"])
        os.makedirs(path, exist_ok=True)
        if fs == "tmpfs":
            run_command(["mount", "-t", "tmpfs", "-o", f"size={quota_mib}M", "tmpfs", path])
            device = "tmpfs"
        else:
            image = os.path.join(SCRATCH_DIR, f"{name}.img")
            with open(image, "wb") as handle:
                handle.truncate(quota_mib * 1024 * 1024)
            # -m 0 removes the root reserve so the declared quota is the real ENOSPC point.
            run_command(["mkfs.ext4", "-q", "-F", "-m", "0", image])
            run_command(["mount", "-o", "loop", image, path])
            device = image
        free, total = statvfs_free(path)
        self.mounts[name] = {"path": path, "fs": fs, "device": device}
        return {
            "mount": name,
            "path": path,
            "fs": fs,
            "device": device,
            "totalBytes": total,
            "freeBytes": free,
        }

    def op_spawn(self, request: dict[str, object]) -> object:
        name = str(request["process"])
        if name in self.children:
            raise OpError("already-running", f"process {name} is already running")
        argv = [str(item) for item in request["argv"]]  # type: ignore[union-attr]
        cwd = str(request["cwd"]) or "/"
        env_overrides = request.get("env") or {}
        tz = request.get("tz")
        if tz is None:
            tz = self.tz_overrides.get(name)
        incarnation = self.incarnations.get(name, 0) + 1
        self.incarnations[name] = incarnation

        cgroup = ""
        if self.cgroup_base:
            cgroup = os.path.join(self.cgroup_base, f"cell-{name}")
            os.makedirs(cgroup, exist_ok=True)

        env = dict(os.environ)
        env["PATH"] = f"{BIN_DIR}:{env.get('PATH', '')}"
        env["FAULTCELL_BARRIER_SOCKET"] = BARRIER_SOCKET
        env["FAULTCELL_PAYLOAD"] = "/etc/faultcell/payload"
        env["FAULTCELL_SHARE"] = self.share
        env["FAULTCELL_PROCESS"] = name
        env["FAULTCELL_INCARNATION"] = str(incarnation)
        for key, value in env_overrides.items():  # type: ignore[union-attr]
            env[str(key)] = str(value)
        if tz is not None:
            env["TZ"] = str(tz)

        procs_file = os.path.join(cgroup, "cgroup.procs") if cgroup else ""

        def enter_cgroup() -> None:
            if procs_file:
                with open(procs_file, "w", encoding="utf-8") as handle:
                    handle.write(str(os.getpid()))

        try:
            popen = subprocess.Popen(  # noqa: S603 - argv comes from a decoded scenario step
                argv,
                cwd=cwd,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=enter_cgroup if procs_file else None,
            )
        except OSError as error:
            raise OpError("spawn-failed", f"could not start {name}: {error}") from error
        child = Child(name, incarnation, popen, argv, cgroup, str(tz) if tz is not None else None)
        self.children[name] = child
        return child.describe()

    def op_signal(self, request: dict[str, object]) -> object:
        name = str(request["process"])
        signal_name = str(request["signal"])
        child = self.children.get(name)
        if child is None:
            raise OpError("not-running", f"process {name} is not running")
        number = SIGNALS.get(signal_name)
        if number is None:
            raise OpError("unknown-signal", f"unsupported signal {signal_name}")
        os.kill(child.popen.pid, number)
        return {
            "process": name,
            "incarnation": child.incarnation,
            "pid": child.popen.pid,
            "startTicks": child.start_ticks,
            "cgroup": child.cgroup,
            "argv": child.argv,
            "tz": child.tz,
            "startedAtWallMs": child.started_at_wall_ms,
        }

    def op_setProcessTz(self, request: dict[str, object]) -> object:
        name = str(request["process"])
        tz = str(request["tz"])
        self.tz_overrides[name] = tz
        return {"process": name, "tz": tz}

    def op_setCgroupMemory(self, request: dict[str, object]) -> object:
        name = str(request["process"])
        max_bytes = int(request["maxBytes"])
        cgroup = self.require_cgroup(name)
        self.write_cgroup(cgroup, "memory.max", str(max_bytes))
        read_back = self.read_cgroup(cgroup, "memory.max")
        return {
            "process": name,
            "cgroup": cgroup,
            "requestedBytes": max_bytes,
            "readBackBytes": -1 if read_back == "max" else int(read_back),
        }

    def op_setCgroupCpu(self, request: dict[str, object]) -> object:
        name = str(request["process"])
        percent = int(request["quotaPercent"])
        cgroup = self.require_cgroup(name)
        self.write_cgroup(cgroup, "cpu.max", f"{percent * 1000} 100000")
        return {
            "process": name,
            "cgroup": cgroup,
            "requestedPercent": percent,
            "readBack": self.read_cgroup(cgroup, "cpu.max"),
        }

    def op_fillFilesystem(self, request: dict[str, object]) -> object:
        name = str(request["mount"])
        leave = int(request["leaveFreeBytes"])
        mount = self.require_mount(name)
        path = str(mount["path"])
        before, _total = statvfs_free(path)
        balloon = os.path.join(path, BALLOON_NAME)
        written = 0
        block = b"\0" * CHUNK
        with open(balloon, "ab") as handle:
            while True:
                free, _ = statvfs_free(path)
                if free <= leave:
                    break
                size = min(CHUNK, max(free - leave, 1))
                try:
                    handle.write(block[:size])
                    handle.flush()
                    os.fsync(handle.fileno())
                    written += size
                except OSError as error:
                    if error.errno == errno.ENOSPC:
                        break
                    raise
        after, _ = statvfs_free(path)
        return {
            "mount": name,
            "path": path,
            "freeBytesBefore": before,
            "freeBytesAfter": after,
            "balloonBytes": written,
            "balloonPath": balloon,
        }

    def op_releaseFilesystem(self, request: dict[str, object]) -> object:
        name = str(request["mount"])
        mount = self.require_mount(name)
        path = str(mount["path"])
        balloon = os.path.join(path, BALLOON_NAME)
        removed = 0
        if os.path.exists(balloon):
            removed = os.path.getsize(balloon)
            os.unlink(balloon)
        os.sync()
        after, _ = statvfs_free(path)
        return {"mount": name, "freeBytesAfter": after, "removedBytes": removed}

    def op_sqliteLockHold(self, request: dict[str, object]) -> object:
        hold = str(request["hold"])
        path = str(request["path"])
        mode = str(request["mode"])
        if hold in self.holds:
            raise OpError("already-held", f"hold {hold} is already active")
        script = (
            "import sqlite3,sys,time\n"
            "conn = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=1)\n"
            "mode = sys.argv[2]\n"
            "conn.execute('CREATE TABLE IF NOT EXISTS faultcell_lock(id INTEGER PRIMARY KEY)')\n"
            "if mode == 'shared':\n"
            "    conn.execute('BEGIN'); conn.execute('SELECT count(*) FROM faultcell_lock')\n"
            "elif mode == 'reserved':\n"
            "    conn.execute('BEGIN IMMEDIATE')\n"
            "else:\n"
            "    conn.execute('BEGIN EXCLUSIVE')\n"
            "sys.stdout.write('held\\n'); sys.stdout.flush()\n"
            "while True: time.sleep(3600)\n"
        )
        popen = subprocess.Popen(  # noqa: S603 - fixed interpreter, fixed script
            [sys.executable, "-c", script, path, mode],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert popen.stdout is not None
        popen.stdout.readline()
        if popen.poll() is not None:
            stderr = popen.stderr.read().decode("utf-8", "replace") if popen.stderr else ""
            raise OpError("lock-failed", f"could not acquire {mode} lock on {path}", stderr[:512])
        self.holds[hold] = popen
        journal = "unknown"
        try:
            probe = sqlite3.connect(path, timeout=1)
            journal = str(probe.execute("PRAGMA journal_mode").fetchone()[0])
            probe.close()
        except sqlite3.Error:
            journal = "locked"
        return {"hold": hold, "path": path, "mode": mode, "journalMode": journal, "held": True}

    def op_sqliteLockRelease(self, request: dict[str, object]) -> object:
        hold = str(request["hold"])
        popen = self.holds.pop(hold, None)
        if popen is None:
            raise OpError("no-such-hold", f"hold {hold} is not active")
        popen.kill()
        popen.wait(timeout=10)
        return {"hold": hold, "released": True}

    def op_networkPartition(self, request: dict[str, object]) -> object:
        link = str(request["link"])
        run_command(["ip", "link", "set", "dev", link, "down"])
        return self.link_state(link)

    def op_networkDelay(self, request: dict[str, object]) -> object:
        link = str(request["link"])
        delay_ms = int(request["delayMs"])
        jitter_ms = int(request["jitterMs"])
        argv = ["tc", "qdisc", "replace", "dev", link, "root", "netem", "delay", f"{delay_ms}ms"]
        if jitter_ms > 0:
            argv.append(f"{jitter_ms}ms")
        run_command(argv)
        return self.link_state(link)

    def op_networkReset(self, request: dict[str, object]) -> object:
        link = str(request["link"])
        run_command(["tc", "qdisc", "del", "dev", link, "root"], allow_fail=True)
        run_command(["ip", "link", "set", "dev", link, "up"])
        return self.link_state(link)

    def op_probeSqlite(self, request: dict[str, object]) -> object:
        path = str(request["path"])
        sql = str(request["sql"])
        params = list(request.get("params") or [])  # type: ignore[arg-type]
        if not os.path.exists(path):
            raise OpError("no-such-database", f"{path} does not exist")
        conn = sqlite3.connect(path, timeout=5)
        try:
            cursor = conn.execute(sql, params)
            columns = [description[0] for description in (cursor.description or [])]
            rows = [[json_safe(cell) for cell in row] for row in cursor.fetchall()]
        except sqlite3.Error as error:
            raise OpError("sqlite-error", f"{type(error).__name__}: {error}", sql[:512]) from error
        finally:
            conn.close()
        return {"path": path, "sql": sql, "columns": columns, "rows": rows}

    def op_probeFile(self, request: dict[str, object]) -> object:
        path = str(request["path"])
        include_text = bool(request["includeText"])
        if not os.path.isfile(path):
            return {"path": path, "exists": False, "bytes": 0, "sha256": "", "text": None}
        digest, size = sha256_file(path)
        text = None
        if include_text and size <= 1 << 20:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        return {"path": path, "exists": True, "bytes": size, "sha256": digest, "text": text}

    def op_processTable(self, _request: dict[str, object]) -> object:
        entries = [child.describe() for child in self.children.values()]
        entries.extend(child.describe() for child in self.history)
        return {"processes": entries}

    def op_collectArtifacts(self, request: dict[str, object]) -> object:
        paths = [str(item) for item in request["paths"]]  # type: ignore[union-attr]
        into = str(request["into"])
        target = os.path.join(self.share, "artifacts", into)
        os.makedirs(target, exist_ok=True)
        collected: list[dict[str, object]] = []
        for guest_path in paths:
            rel = guest_path.lstrip("/").replace("/", "_")
            if os.path.isdir(guest_path):
                rel = f"{rel}.tar"
                destination = os.path.join(target, rel)
                with tarfile.open(destination, "w") as archive:
                    archive.add(guest_path, arcname=os.path.basename(guest_path))
            elif os.path.isfile(guest_path):
                destination = os.path.join(target, rel)
                with open(guest_path, "rb") as source, open(destination, "wb") as sink:
                    while True:
                        block = source.read(CHUNK)
                        if not block:
                            break
                        sink.write(block)
            else:
                raise OpError("no-such-artifact", f"{guest_path} does not exist in the guest")
            os.sync()
            digest, size = sha256_file(destination)
            collected.append(
                {"guestPath": guest_path, "relPath": rel, "bytes": size, "sha256": digest}
            )
        return {"into": target, "artifacts": collected}

    def op_shutdown(self, _request: dict[str, object]) -> object:
        os.sync()
        return {"acknowledged": True}

    # --------------------------------------------------------------- helpers

    def require_cgroup(self, name: str) -> str:
        child = self.children.get(name)
        if child is None:
            raise OpError("not-running", f"process {name} is not running")
        if not child.cgroup:
            raise OpError("no-cgroup", f"no delegated cgroup available for {name}")
        return child.cgroup

    def require_mount(self, name: str) -> dict[str, object]:
        mount = self.mounts.get(name)
        if mount is None:
            raise OpError("no-such-mount", f"mount {name} was never provisioned")
        return mount

    def write_cgroup(self, cgroup: str, leaf: str, value: str) -> None:
        try:
            with open(os.path.join(cgroup, leaf), "w", encoding="utf-8") as handle:
                handle.write(value)
        except OSError as error:
            raise OpError("cgroup-write-failed", f"{leaf}: {error}") from error

    def read_cgroup(self, cgroup: str, leaf: str) -> str:
        with open(os.path.join(cgroup, leaf), "r", encoding="utf-8") as handle:
            return handle.read().strip()

    def link_state(self, link: str) -> dict[str, object]:
        raw = run_command(["ip", "-json", "link", "show", link])
        parsed = json.loads(raw)
        entry = parsed[0] if parsed else {}
        qdisc_raw = run_command(["tc", "qdisc", "show", "dev", link], allow_fail=True)
        delay_ms = 0
        jitter_ms = 0
        qdisc = qdisc_raw.strip().splitlines()[0] if qdisc_raw.strip() else "none"
        if "netem" in qdisc_raw:
            tokens = qdisc_raw.split()
            if "delay" in tokens:
                index = tokens.index("delay")
                delay_ms = int(float(tokens[index + 1].rstrip("ms")))
                if len(tokens) > index + 2 and tokens[index + 2].endswith("ms"):
                    jitter_ms = int(float(tokens[index + 2].rstrip("ms")))
        return {
            "link": link,
            "operState": str(entry.get("operstate", "unknown")),
            "adminUp": "UP" in [str(flag) for flag in entry.get("flags", [])],
            "qdisc": qdisc,
            "delayMs": delay_ms,
            "jitterMs": jitter_ms,
            "lossPercent": 0,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--share", required=True)
    args = parser.parse_args()
    agent = Agent(args.port, args.spec, args.share)
    agent.setup()
    try:
        agent.serve()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
