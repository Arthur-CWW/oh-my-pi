"""Low-level client for the vphone-cli host control Unix socket."""

import json
import socket
from pathlib import Path

class VPhoneClient:
    """Sends JSON commands to the vphone.sock Unix domain socket."""

    def __init__(self, socket_path: str | Path):
        self.socket_path = str(socket_path)

    def _send(self, msg: dict) -> dict:
        """Connect, send one JSON line, read one JSON line, disconnect."""
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.connect(self.socket_path)
            payload = json.dumps(msg) + "\n"
            sock.sendall(payload.encode())

            # Read response
            sock.settimeout(30.0)
            chunks: list[bytes] = []
            while True:
                data = sock.recv(4096)
                if not data:
                    break
                chunks.append(data)
                if b"\n" in data:
                    break

            raw = b"".join(chunks).strip()
            return json.loads(raw) if raw else {"ok": False, "error": "empty response"}
        except FileNotFoundError:
            return {"ok": False, "error": f"socket not found: {self.socket_path}"}
        except ConnectionRefusedError:
            return {"ok": False, "error": "connection refused — is vphone-cli running?"}
        finally:
            sock.close()

    def screenshot(self, path: str | None = None) -> dict:
        msg: dict = {"t": "screenshot"}
        if path:
            msg["path"] = path
        return self._send(msg)

    def tap(self, x: float, y: float) -> dict:
        return self._send({"t": "tap", "x": x, "y": y})

    def swipe(
        self, x1: float, y1: float, x2: float, y2: float, ms: int = 300
    ) -> dict:
        return self._send({"t": "swipe", "x1": x1, "y1": y1, "x2": x2, "y2": y2, "ms": ms})

    def key(self, name: str) -> dict:
        return self._send({"t": "key", "name": name})
