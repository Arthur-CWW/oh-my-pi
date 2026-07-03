"""Controlled vphone detectability measurement harness.

This module is stdlib-only by design. It talks to a local vphone-cli
Unix-domain socket using the small JSON protocol used by the lab VM and
executes an operator-authored JSONL script of tap/swipe/key/screenshot/wait
steps. Runs are explicitly labelled as controlled local detectability
measurement against owned lab surfaces, not stealth against third-party apps.
"""

from __future__ import annotations

import sys

if __name__ == "__main__" and sys.path:
    # Direct script execution puts src/ on sys.path, where src/types.py
    # shadows the stdlib types module imported transitively by argparse.
    _script_dir = __file__.rsplit("/", 1)[0]
    sys.path[:] = [entry for entry in sys.path if entry != _script_dir]
    del _script_dir


import argparse
import base64
import dataclasses
import datetime as _datetime
import json
import os
from pathlib import Path
import random
import socket
import time
from typing import Any, Callable, Iterable
import uuid


CONTROLLED_MEASUREMENT_LABEL = "controlled-local-detectability-measurement"
SAFETY_NOTICE = (
    "Authorized local lab measurement against owned blue-team app surfaces and "
    "the operator's local vphone VM only; not stealth, evasion, or bypass work "
    "for third-party apps or abuse-prevention systems."
)
ALLOWED_PROTOCOL_TYPES = frozenset({"tap", "swipe", "key", "screenshot"})


class VPhoneLabError(ValueError):
    """Raised when a lab script or vphone socket response is invalid."""


@dataclasses.dataclass(frozen=True)
class DelayProfile:
    """Jitter and delay profile for controlled measurement runs.

    The profiles deliberately model lab measurement variance only. They are not
    intended to hide automation from third-party apps.
    """

    name: str
    delay_ms: tuple[int, int] = (0, 0)
    coordinate_jitter_px: int = 0

    def delay_seconds(self, rng: random.Random) -> float:
        low, high = self.delay_ms
        if low <= 0 and high <= 0:
            return 0.0
        if high < low:
            raise VPhoneLabError(f"Invalid delay profile {self.name!r}: max < min")
        return rng.randint(low, high) / 1000.0


PROFILES: dict[str, DelayProfile] = {
    "none": DelayProfile(name="none", delay_ms=(0, 0), coordinate_jitter_px=0),
    "lab-micro": DelayProfile(
        name="lab-micro", delay_ms=(50, 150), coordinate_jitter_px=1
    ),
    "lab-slow": DelayProfile(
        name="lab-slow", delay_ms=(250, 750), coordinate_jitter_px=3
    ),
}


class VPhoneSocketClient:
    """Small vphone-cli Unix socket JSON client.

    Each request is sent as one JSON object followed by a newline. Responses may
    be an empty acknowledgement, a JSON object, or raw bytes (for screenshots on
    servers that stream image data directly).
    """

    def __init__(self, socket_path: str, timeout: float = 10.0):
        self.socket_path = socket_path
        self.timeout = timeout

    def send(self, request: dict[str, Any]) -> Any:
        payload = json.dumps(request, separators=(",", ":")).encode("utf-8") + b"\n"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(self.timeout)
            sock.connect(self.socket_path)
            sock.sendall(payload)
            try:
                sock.shutdown(socket.SHUT_WR)
            except OSError:
                pass
            chunks: list[bytes] = []
            while True:
                try:
                    chunk = sock.recv(1024 * 1024)
                except socket.timeout:
                    if chunks:
                        break
                    raise
                if not chunk:
                    break
                chunks.append(chunk)
                response_so_far = b"".join(chunks).strip()
                if response_so_far[:1] in (b"{", b"[") and response_so_far.endswith(
                    (b"}", b"]")
                ):
                    break

        raw = b"".join(chunks)
        if not raw:
            return {"ok": True}

        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            return raw
        if not text:
            return {"ok": True}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return raw


@dataclasses.dataclass
class RunResult:
    """Result returned by a vphone lab run."""

    manifest_path: Path
    manifest: dict[str, Any]


class VPhoneLabRunner:
    """Executes JSONL action scripts against a vphone socket/client."""

    def __init__(
        self,
        client: Any,
        output_dir: str | Path,
        profile: DelayProfile | str = "none",
        *,
        script_path: str | Path | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        rng: random.Random | None = None,
        run_id: str | None = None,
        now: Callable[[], _datetime.datetime] | None = None,
    ):
        self.client = client
        self.output_dir = Path(output_dir)
        self.profile = _coerce_profile(profile)
        self.script_path = Path(script_path) if script_path is not None else None
        self.sleeper = sleeper
        self.rng = rng or random.Random()
        self.run_id = run_id or uuid.uuid4().hex
        self._now = now or (lambda: _datetime.datetime.now(_datetime.timezone.utc))

    def run(self, actions: Iterable[dict[str, Any]]) -> RunResult:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        manifest: dict[str, Any] = {
            "label": CONTROLLED_MEASUREMENT_LABEL,
            "safety_notice": SAFETY_NOTICE,
            "run_id": self.run_id,
            "created_at": self._now().isoformat(),
            "socket_path": getattr(self.client, "socket_path", None),
            "script_path": str(self.script_path) if self.script_path else None,
            "output_dir": str(self.output_dir),
            "profile": dataclasses.asdict(self.profile),
            "actions": [],
            "summary": {"total": 0, "sent": 0, "failed": 0, "screenshots": 0},
        }

        for index, action in enumerate(actions, start=1):
            entry = self._run_one(index, action)
            manifest["actions"].append(entry)
            manifest["summary"]["total"] += 1
            if entry["status"] == "sent":
                manifest["summary"]["sent"] += 1
            elif entry["status"] == "failed":
                manifest["summary"]["failed"] += 1
            if entry.get("screenshot_path"):
                manifest["summary"]["screenshots"] += 1

        manifest_path = self.output_dir / f"vphone-lab-manifest-{self.run_id}.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        return RunResult(manifest_path=manifest_path, manifest=manifest)

    def _run_one(self, index: int, action: dict[str, Any]) -> dict[str, Any]:
        try:
            action_name = _action_name(action)
        except Exception as exc:
            return {"index": index, "action": "<invalid>", "status": "failed", "error": str(exc)}

        entry: dict[str, Any] = {"index": index, "action": action_name, "status": "pending"}

        try:
            if action_name in {"wait", "delay"}:
                seconds = _delay_action_seconds(action)
                self.sleeper(seconds)
                entry.update({"status": "waited", "delay_seconds": seconds})
                return entry

            request = self._request_for_action(action_name, action)
            delay_seconds = _explicit_delay_seconds(action)
            if delay_seconds is None:
                delay_seconds = self.profile.delay_seconds(self.rng)
            if delay_seconds > 0:
                self.sleeper(delay_seconds)

            response = self.client.send(request)
            entry.update(
                {
                    "status": "sent",
                    "request": request,
                    "delay_seconds": delay_seconds,
                    "response": _summarize_response(response),
                }
            )
            if request["t"] == "screenshot":
                screenshot_path = self._save_screenshot(index, response)
                if screenshot_path is not None:
                    entry["screenshot_path"] = str(screenshot_path)
            return entry
        except Exception as exc:  # Keep the manifest useful for operators.
            entry.update({"status": "failed", "error": str(exc)})
            return entry

    def _request_for_action(self, action_name: str, action: dict[str, Any]) -> dict[str, Any]:
        if action_name not in ALLOWED_PROTOCOL_TYPES:
            raise VPhoneLabError(
                f"Unsupported action {action_name!r}; allowed actions are "
                "tap, swipe, key, screenshot, wait"
            )

        if action_name == "tap":
            x = _required_int(action, "x")
            y = _required_int(action, "y")
            x, y = self._jitter_coordinate(x, y)
            return {"t": "tap", "x": x, "y": y}

        if action_name == "swipe":
            x1, y1, x2, y2 = _swipe_coordinates(action)
            x1, y1 = self._jitter_coordinate(x1, y1)
            x2, y2 = self._jitter_coordinate(x2, y2)
            request: dict[str, Any] = {
                "t": "swipe",
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            }
            if "duration_ms" in action:
                request["duration_ms"] = _required_int(action, "duration_ms")
            return request

        if action_name == "key":
            key = action.get("key") or action.get("name") or action.get("value")
            if not isinstance(key, str) or not key:
                raise VPhoneLabError("key action requires a non-empty string 'key'")
            return {"t": "key", "key": key}

        return {"t": "screenshot"}

    def _jitter_coordinate(self, x: int, y: int) -> tuple[int, int]:
        jitter = self.profile.coordinate_jitter_px
        if jitter <= 0:
            return x, y
        return (
            x + self.rng.randint(-jitter, jitter),
            y + self.rng.randint(-jitter, jitter),
        )

    def _save_screenshot(self, index: int, response: Any) -> Path | None:
        data: bytes | None = None
        extension = "png"

        if isinstance(response, bytes):
            data = response
            if not response.startswith(b"\x89PNG"):
                extension = "bin"
        elif isinstance(response, dict):
            if isinstance(response.get("png_b64"), str):
                data = base64.b64decode(response["png_b64"])
            elif isinstance(response.get("screenshot_b64"), str):
                data = base64.b64decode(response["screenshot_b64"])
            elif isinstance(response.get("data_b64"), str):
                data = base64.b64decode(response["data_b64"])
            elif isinstance(response.get("bytes_b64"), str):
                data = base64.b64decode(response["bytes_b64"])
            elif isinstance(response.get("path"), str):
                return Path(response["path"])

        if data is None:
            return None

        screenshot_path = self.output_dir / f"screenshot-{index:04d}.{extension}"
        screenshot_path.write_bytes(data)
        return screenshot_path


def run_script_file(
    script_path: str | Path,
    output_dir: str | Path,
    *,
    socket_path: str | None = None,
    profile: DelayProfile | str = "none",
    seed: int | None = None,
    timeout: float = 10.0,
    client: Any | None = None,
    sleeper: Callable[[float], None] = time.sleep,
) -> RunResult:
    """Execute a JSONL script and write a manifest under ``output_dir``."""

    script = Path(script_path)
    actions = load_jsonl_actions(script)
    if client is None:
        resolved_socket = socket_path or os.environ.get("VPHONE_SOCKET", "/tmp/vphone.sock")
        client = VPhoneSocketClient(resolved_socket, timeout=timeout)
    rng = random.Random(seed)
    runner = VPhoneLabRunner(
        client,
        output_dir,
        profile=profile,
        script_path=script,
        sleeper=sleeper,
        rng=rng,
    )
    return runner.run(actions)


def load_jsonl_actions(path: str | Path) -> list[dict[str, Any]]:
    """Load operator-authored JSONL actions from ``path``.

    Blank lines and lines starting with ``#`` are ignored. Every other line must
    be one JSON object.
    """

    actions: list[dict[str, Any]] = []
    source = Path(path)
    with source.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                action = json.loads(line)
            except json.JSONDecodeError as exc:
                raise VPhoneLabError(f"{source}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(action, dict):
                raise VPhoneLabError(f"{source}:{line_number}: each JSONL row must be an object")
            action.setdefault("_line", line_number)
            actions.append(action)
    return actions


def _coerce_profile(profile: DelayProfile | str) -> DelayProfile:
    if isinstance(profile, DelayProfile):
        return profile
    try:
        return PROFILES[profile]
    except KeyError as exc:
        raise VPhoneLabError(
            f"Unknown profile {profile!r}; choose one of {', '.join(sorted(PROFILES))}"
        ) from exc


def _action_name(action: dict[str, Any]) -> str:
    raw = action.get("action", action.get("t"))
    if not isinstance(raw, str) or not raw:
        raise VPhoneLabError("action row requires 'action' or protocol field 't'")
    name = raw.lower()
    if name == "click":
        return "tap"
    if name == "capture":
        return "screenshot"
    return name


def _required_int(action: dict[str, Any], field: str) -> int:
    value = action.get(field)
    if isinstance(value, bool) or not isinstance(value, int):
        raise VPhoneLabError(f"{action.get('action', action.get('t', 'action'))} requires integer {field!r}")
    return value


def _pair(value: Any, field: str) -> tuple[int, int]:
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 2
        or isinstance(value[0], bool)
        or isinstance(value[1], bool)
        or not isinstance(value[0], int)
        or not isinstance(value[1], int)
    ):
        raise VPhoneLabError(f"{field!r} must be [x, y] integers")
    return int(value[0]), int(value[1])


def _swipe_coordinates(action: dict[str, Any]) -> tuple[int, int, int, int]:
    if "from" in action and "to" in action:
        x1, y1 = _pair(action["from"], "from")
        x2, y2 = _pair(action["to"], "to")
        return x1, y1, x2, y2
    if "from_coordinate" in action and "to_coordinate" in action:
        x1, y1 = _pair(action["from_coordinate"], "from_coordinate")
        x2, y2 = _pair(action["to_coordinate"], "to_coordinate")
        return x1, y1, x2, y2
    return (
        _required_int(action, "x1"),
        _required_int(action, "y1"),
        _required_int(action, "x2"),
        _required_int(action, "y2"),
    )


def _explicit_delay_seconds(action: dict[str, Any]) -> float | None:
    if "delay_ms" in action:
        value = action["delay_ms"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise VPhoneLabError("delay_ms must be a non-negative number")
        return float(value) / 1000.0
    if "delay_seconds" in action:
        value = action["delay_seconds"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise VPhoneLabError("delay_seconds must be a non-negative number")
        return float(value)
    return None


def _delay_action_seconds(action: dict[str, Any]) -> float:
    explicit = _explicit_delay_seconds(action)
    if explicit is not None:
        return explicit
    if "seconds" in action:
        value = action["seconds"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise VPhoneLabError("wait seconds must be a non-negative number")
        return float(value)
    raise VPhoneLabError("wait/delay action requires seconds, delay_seconds, or delay_ms")


def _summarize_response(response: Any) -> dict[str, Any]:
    if isinstance(response, bytes):
        return {"type": "bytes", "size": len(response)}
    if isinstance(response, dict):
        summary: dict[str, Any] = {"type": "json"}
        for key in ("ok", "status", "error", "message"):
            if key in response:
                summary[key] = response[key]
        for key in ("png_b64", "screenshot_b64", "data_b64", "bytes_b64"):
            if isinstance(response.get(key), str):
                summary[key] = f"<base64:{len(response[key])} chars>"
        if "path" in response:
            summary["path"] = response["path"]
        return summary
    return {"type": type(response).__name__, "repr": repr(response)[:200]}


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run a controlled local vphone detectability measurement JSONL script "
            "against the operator's own lab VM."
        )
    )
    parser.add_argument("script", help="JSONL action script to execute")
    parser.add_argument("output_dir", help="Operator-provided directory for manifest/artifacts")
    parser.add_argument(
        "--socket",
        default=os.environ.get("VPHONE_SOCKET", "/tmp/vphone.sock"),
        help="vphone-cli Unix socket path (default: VPHONE_SOCKET or /tmp/vphone.sock)",
    )
    parser.add_argument(
        "--profile",
        choices=sorted(PROFILES),
        default="none",
        help="Lab-only delay/jitter profile; not a stealth profile",
    )
    parser.add_argument("--seed", type=int, help="Optional deterministic RNG seed for repeatable lab runs")
    parser.add_argument("--timeout", type=float, default=10.0, help="Socket timeout in seconds")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        result = run_script_file(
            args.script,
            args.output_dir,
            socket_path=args.socket,
            profile=args.profile,
            seed=args.seed,
            timeout=args.timeout,
        )
    except Exception as exc:
        print(f"vphone_lab: {exc}", file=sys.stderr)
        return 2
    print(result.manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
