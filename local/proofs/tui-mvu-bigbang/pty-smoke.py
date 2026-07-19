#!/usr/bin/env python3
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import tempfile
import time
import fcntl
import termios
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BINARY = ROOT / "vendor/oh-my-pi/packages/coding-agent/dist/omp"
OUT = Path(__file__).with_name("pty-smoke-transcript.txt")
TIMEOUT = 12.0
DISMISS = b"\x1b[27u"
CTRL_R = b"\x1b[114;5u"
CTRL_U = b"\x1b[117;5u"
CTRL_D = b"\x1b[100;5u"
ALT_A = b"\x1b[97;3u"

CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
OSC = re.compile(rb"\x1b\].*?(?:\x07|\x1b\\)", re.S)

class VtScreen:
    def __init__(self, rows: int, cols: int):
        self.rows = rows
        self.cols = cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = 0
        self.col = 0
        self.saved = (0, 0)
        self.pending = ""

    def clear(self) -> None:
        self.grid = [[" "] * self.cols for _ in range(self.rows)]
        self.row = 0
        self.col = 0

    def feed(self, data: bytes) -> None:
        text = self.pending + data.decode("utf-8", "replace")
        self.pending = ""
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\x1b":
                if i + 1 >= len(text):
                    self.pending = text[i:]
                    break
                if text[i + 1] == "[":
                    end = i + 2
                    while end < len(text) and not ("@" <= text[end] <= "~"):
                        end += 1
                    if end >= len(text):
                        self.pending = text[i:]
                        break
                    self._csi(text[i + 2:end], text[end])
                    i = end + 1
                    continue
                if text[i + 1] == "]":
                    bel = text.find("\x07", i + 2)
                    st = text.find("\x1b\\", i + 2)
                    ends = [value for value in (bel, st) if value >= 0]
                    if not ends:
                        self.pending = text[i:]
                        break
                    end = min(ends)
                    i = end + (2 if text.startswith("\x1b\\", end) else 1)
                    continue
                i += 2
                continue
            if ch == "\r":
                self.col = 0
            elif ch == "\n":
                self.row = min(self.rows - 1, self.row + 1)
            elif ch == "\b":
                self.col = max(0, self.col - 1)
            elif ch == "\t":
                self.col = min(self.cols - 1, ((self.col // 8) + 1) * 8)
            elif ord(ch) >= 32 and ch != "\x7f":
                if 0 <= self.row < self.rows and 0 <= self.col < self.cols:
                    self.grid[self.row][self.col] = ch
                self.col += 1
                if self.col >= self.cols:
                    self.col = 0
                    self.row = min(self.rows - 1, self.row + 1)
            i += 1

    def _csi(self, raw: str, final: str) -> None:
        params_raw = re.sub(r"[^0-9;]", "", raw.lstrip("?<>!"))
        params = [int(value) if value else 0 for value in params_raw.split(";")] if params_raw else []
        first = params[0] if params else 0
        if final in ("H", "f"):
            self.row = max(0, min(self.rows - 1, (params[0] if params else 1) - 1))
            self.col = max(0, min(self.cols - 1, (params[1] if len(params) > 1 else 1) - 1))
        elif final == "A":
            self.row = max(0, self.row - (first or 1))
        elif final == "B":
            self.row = min(self.rows - 1, self.row + (first or 1))
        elif final == "C":
            self.col = min(self.cols - 1, self.col + (first or 1))
        elif final == "D":
            self.col = max(0, self.col - (first or 1))
        elif final == "G":
            self.col = max(0, min(self.cols - 1, (first or 1) - 1))
        elif final == "d":
            self.row = max(0, min(self.rows - 1, (first or 1) - 1))
        elif final == "J":
            if first in (2, 3):
                self.clear()
            elif first == 0:
                for col in range(self.col, self.cols):
                    self.grid[self.row][col] = " "
                for row in range(self.row + 1, self.rows):
                    self.grid[row] = [" "] * self.cols
        elif final == "K":
            if first == 1:
                start, end = 0, self.col + 1
            elif first == 2:
                start, end = 0, self.cols
            else:
                start, end = self.col, self.cols
            for col in range(start, end):
                self.grid[self.row][col] = " "
        elif final == "s":
            self.saved = (self.row, self.col)
        elif final == "u":
            self.row, self.col = self.saved

    def text(self) -> str:
        return "\n".join("".join(row).rstrip() for row in self.grid)

SCREEN = VtScreen(40, 120)

CTRL = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]")

def plain(data: bytes) -> str:
    data = OSC.sub(b"", data)
    data = CSI.sub(b"", data)
    data = CTRL.sub(b"", data)
    return data.decode("utf-8", "replace")

def resize(fd: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, cols, 0, 0))

def drain(fd: int, duration: float = 0.35) -> bytes:
    end = time.monotonic() + duration
    chunks = []
    while time.monotonic() < end:
        ready, _, _ = select.select([fd], [], [], min(0.05, end - time.monotonic()))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        chunks.append(chunk)
        SCREEN.feed(chunk)
        end = max(end, time.monotonic() + 0.08)
    return b"".join(chunks)

def send(fd: int, data: bytes) -> bytes:
    os.write(fd, data)
    return drain(fd)

def snapshot(fd: int) -> bytes:
    resize(fd, 119)
    time.sleep(0.03)
    resize(fd, 120)
    return drain(fd, 0.45)

def require(label: str, data: bytes, needle: str) -> None:
    text = SCREEN.text()
    if needle not in text:
        raise AssertionError(f"{label}: missing {needle!r}\n{text}")

with tempfile.TemporaryDirectory(prefix="omp-mvu-pty-") as temporary:
    temp = Path(temporary)
    config = temp / "settings.json"
    sessions = temp / "sessions"
    home = temp / "home"
    sessions.mkdir()
    home.mkdir()
    config.write_text("{}\n")
    argv = [
        str(BINARY),
        "--session-dir", str(sessions),
        "--config", str(config),
        "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title",
    ]
    pid, master = pty.fork()
    if pid == 0:
        env = os.environ.copy()
        env["HOME"] = str(home)
        env["TERM"] = "xterm-256color"
        env["OMP_SKIP_SETUP"] = "1"
        os.execve(str(BINARY), argv, env)
    resize(master, 120)
    records = []
    try:
        startup = drain(master, 1.0) + snapshot(master)
        records.append(("startup", startup))

        typed = send(master, b"draft sentinel")
        records.append(("compose", typed))
        send(master, DISMISS)
        search = send(master, CTRL_R) + snapshot(master)
        require("history search", search, "No matching history")
        records.append(("ctrl-r-history", search))
        restored = b""
        for _ in range(4):
            restored += send(master, DISMISS) + snapshot(master)
            if "draft sentinel" in SCREEN.text():
                break
        require("draft restore", restored, "draft sentinel")
        records.append(("escape-restores-draft", restored))

        send(master, CTRL_U)
        settings = send(master, b"/settings\r") + snapshot(master)
        require("settings", settings, "Settings")
        records.append(("settings-open", settings))
        records.append(("settings-navigation", send(master, b"\x1b[B") + send(master, b"\x1b[A") + snapshot(master)))
        for _ in range(4):
            send(master, DISMISS)
            snapshot(master)
            if "Settings" not in SCREEN.text():
                break

        hub = send(master, ALT_A) + snapshot(master)
        require("agent hub", hub, "Agent Hub")
        records.append(("hub-open", hub))
        help_view = send(master, b"?") + snapshot(master)
        require("hub help", help_view, "Help")
        records.append(("hub-help", help_view))
        send(master, b"?")
        send(master, b"q")

        resume = send(master, b"/resume\r") + snapshot(master)
        require("resume selector", resume, "No sessions in current folder")
        records.append(("selector-open", resume))
        records.append(("selector-nav-filter", send(master, b"j") + send(master, b"k") + send(master, b"/") + send(master, b"current") + snapshot(master)))
        send(master, DISMISS)
        send(master, DISMISS)

        send(master, CTRL_D)
        deadline = time.monotonic() + 5.0
        status = None
        while time.monotonic() < deadline:
            waited, raw = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                status = raw
                break
            drain(master, 0.05)
        if status is None:
            os.kill(pid, signal.SIGTERM)
            _, status = os.waitpid(pid, 0)
        exit_code = os.waitstatus_to_exitcode(status)
        if exit_code != 0:
            raise AssertionError(f"OMP exited with {exit_code}")

        lines = ["HR-225 real PTY smoke: PASS", f"binary={BINARY}", f"pid={pid}", "flows=compose/Esc, Ctrl-R, Settings j/k/back, Hub/help/close, Resume selector j/k/filter/back", ""]
        for label, raw in records:
            text = plain(raw).replace("\r", "")
            lines.extend([f"--- {label} ---", text[-2500:], ""])
        OUT.write_text("\n".join(lines))
        print(f"PTY smoke passed; transcript={OUT}")
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            os.kill(pid, 0)
        except OSError:
            pass
        else:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
