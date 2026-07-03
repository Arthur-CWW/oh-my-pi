"""vphone-mcp: MCP server for programmatic iOS VM control."""

import base64
import os
import sys
import tempfile
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .actions import (
    APP_SWITCHER,
    BACK_BUTTON,
    CONTROL_CENTER,
    NEXT_PAGE,
    NOTIFICATION_CENTER,
    PREV_PAGE,
    SCROLL_DOWN,
    SCROLL_UP,
    SEARCH_BAR,
    app_position,
)
from .client import VPhoneClient

mcp = FastMCP("vphone")

# ---------------------------------------------------------------------------
# Socket discovery
# ---------------------------------------------------------------------------

def _socket_path() -> str:
    """Resolve the vphone.sock path."""
    # Explicit env var takes priority
    if env := os.environ.get("VPHONE_SOCK"):
        return env
    # Default: look for vm/vphone.sock relative to common project locations
    candidates = [
        Path.home() / "localdev" / "experiments" / "vphone-cli" / "vm" / "vphone.sock",
        Path.cwd() / "vm" / "vphone.sock",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    # Fall back to first candidate (will fail with clear error)
    return str(candidates[0])

def _client() -> VPhoneClient:
    return VPhoneClient(_socket_path())

def _require_ok(resp: dict) -> str:
    """Return success message or raise with error detail."""
    if resp.get("ok"):
        return resp.get("path") or "ok"
    raise RuntimeError(resp.get("error", "unknown error"))

# ---------------------------------------------------------------------------
# Layer 1: Hardware keys
# ---------------------------------------------------------------------------

@mcp.tool()
def go_home() -> str:
    """Press the home button to return to the home screen."""
    return _require_ok(_client().key("home"))

@mcp.tool()
def press_power() -> str:
    """Press the power button (lock/wake)."""
    return _require_ok(_client().key("power"))

@mcp.tool()
def volume_up() -> str:
    """Press volume up."""
    return _require_ok(_client().key("volup"))

@mcp.tool()
def volume_down() -> str:
    """Press volume down."""
    return _require_ok(_client().key("voldown"))

# ---------------------------------------------------------------------------
# Layer 2: Screenshots
# ---------------------------------------------------------------------------

@mcp.tool()
def screenshot() -> list:
    """Take a screenshot of the VM display and return it as an image.

    Returns the screenshot as an embedded image that can be analyzed visually.
    """
    path = os.path.join(tempfile.gettempdir(), "vphone-mcp-screen.png")
    resp = _client().screenshot(path)
    _require_ok(resp)

    image_data = Path(path).read_bytes()
    return [
        {
            "type": "image",
            "data": base64.b64encode(image_data).decode(),
            "mimeType": "image/png",
        }
    ]

# ---------------------------------------------------------------------------
# Layer 3: Pre-mapped navigation
# ---------------------------------------------------------------------------

@mcp.tool()
def open_app(name: str) -> str:
    """Open an app from the home screen by name.

    First presses home to ensure we're on the home screen, then taps the app.

    Supported apps: FaceTime, Calendar, Photos, Mail, Notes, Reminders,
    Clock, TV, Games, App Store, Maps, Health, Wallet, Settings,
    Phone, Safari, Messages, Music.
    """
    pos = app_position(name)
    if pos is None:
        raise ValueError(
            f"Unknown app '{name}'. Use tap() for apps not on the default home screen, "
            f"or use open_url() to launch by URL scheme."
        )
    # Go home first to ensure we're on page 1
    _require_ok(_client().key("home"))
    import time; time.sleep(0.5)
    return _require_ok(_client().tap(pos[0], pos[1]))

@mcp.tool()
def tap_back() -> str:
    """Tap the iOS navigation back button (top-left corner)."""
    return _require_ok(_client().tap(BACK_BUTTON[0], BACK_BUTTON[1]))

@mcp.tool()
def open_search() -> str:
    """Tap the Search bar on the home screen."""
    return _require_ok(_client().tap(SEARCH_BAR[0], SEARCH_BAR[1]))

@mcp.tool()
def scroll_down() -> str:
    """Scroll down on the current screen."""
    return _require_ok(_client().swipe(**SCROLL_DOWN))

@mcp.tool()
def scroll_up() -> str:
    """Scroll up on the current screen."""
    return _require_ok(_client().swipe(**SCROLL_UP))

@mcp.tool()
def open_notification_center() -> str:
    """Swipe down from the top-left to open Notification Center."""
    return _require_ok(_client().swipe(**NOTIFICATION_CENTER))

@mcp.tool()
def open_control_center() -> str:
    """Swipe down from the top-right to open Control Center."""
    return _require_ok(_client().swipe(**CONTROL_CENTER))

@mcp.tool()
def open_app_switcher() -> str:
    """Slow swipe up from bottom to open the App Switcher."""
    return _require_ok(_client().swipe(**APP_SWITCHER))

@mcp.tool()
def swipe_to_next_page() -> str:
    """Swipe left to go to the next home screen page."""
    return _require_ok(_client().swipe(**NEXT_PAGE))

@mcp.tool()
def swipe_to_previous_page() -> str:
    """Swipe right to go to the previous home screen page."""
    return _require_ok(_client().swipe(**PREV_PAGE))

# ---------------------------------------------------------------------------
# Layer 4: Raw interaction (for app-specific UI)
# ---------------------------------------------------------------------------

@mcp.tool()
def tap(x: int, y: int) -> str:
    """Tap at specific pixel coordinates on the screen.

    Coordinates are in pixels matching the screenshot dimensions (1290x2796).
    Use screenshot() first to identify the target position.

    Args:
        x: Horizontal pixel coordinate (0=left, 1290=right)
        y: Vertical pixel coordinate (0=top, 2796=bottom)
    """
    return _require_ok(_client().tap(x, y))

@mcp.tool()
def swipe(x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> str:
    """Swipe from one point to another.

    Coordinates are in pixels matching the screenshot dimensions (1290x2796).

    Args:
        x1: Start X coordinate
        y1: Start Y coordinate
        x2: End X coordinate
        y2: End Y coordinate
        duration_ms: Swipe duration in milliseconds (default 300)
    """
    return _require_ok(_client().swipe(x1, y1, x2, y2, ms=duration_ms))

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
