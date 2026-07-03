"""iOS Computer Use — AI-drivable iPhone control interface.

Mirrors Hermes's computer_use tool semantics so AI models can drive
an iPhone the same way they drive a macOS desktop:

  capture(som) → see elements with numbered overlays
  click(element=5) → tap element #5
  type(text='hello') → type text
  scroll(direction='down') → scroll

Usage:
  from src.ios_computer_use import iOSComputerUse

  ios = iOSComputerUse(wda_url="http://localhost:8100")
  result = ios.action("capture", {"mode": "som"})
  ios.action("click", {"element": 5})
"""

from __future__ import annotations

import base64
import io
import json
import logging
import time
from typing import Any

from src.backends.wda import WDABackend
from src.humanize import Humanizer
from src.types import (
    Action,
    ActionResult,
    CaptureResult,
    Direction,
    HumanizeConfig,
)

logger = logging.getLogger(__name__)


class iOSComputerUse:
    """AI-agent-driven iOS device control.

    Provides a tool-call-compatible interface for LLMs to:
      - Take annotated screenshots (SOM: Set-of-Mark)
      - Click/tap by element index or coordinates
      - Type text with human-like timing
      - Swipe/scroll with natural curves
      - Launch and manage apps
    """

    def __init__(
        self,
        wda_url: str = "http://localhost:8100",
        bundle_id: str | None = None,
        humanize: bool = True,
        humanize_config: HumanizeConfig | None = None,
        annotate_captures: bool = True,
    ):
        """Initialize the iOS Computer Use controller.

        Args:
            wda_url: WebDriverAgent HTTP endpoint.
            bundle_id: Default app to launch.
            humanize: Enable human-like input behavior.
            humanize_config: Fine-tune humanization parameters.
            annotate_captures: Draw numbered boxes on screenshots.
        """
        backend = WDABackend(wda_url=wda_url, bundle_id=bundle_id)
        if humanize:
            self._driver = Humanizer(backend, config=humanize_config)
        else:
            self._driver = backend

        self._humanize = humanize
        self._annotate = annotate_captures
        self._last_capture: CaptureResult | None = None

    # ── public API: action() ─────────────────────────────────────────

    def action(
        self,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> dict:
        """Execute an action. Returns a dict suitable for JSON serialization.

        This is the primary interface for AI agents — matches the
        Hermes computer_use tool call signature.

        Args:
            action: One of capture, click, double_click, long_press,
                    swipe, scroll, type, key, home, app_switcher,
                    launch_app, wait.
            params: Action-specific parameters.

        Returns:
            Dict with success, action, error, and optional capture.
        """
        params = params or {}
        capture_after = params.pop("capture_after", False)

        try:
            result = self._execute(action, params)
        except Exception as e:
            logger.exception(f"Action '{action}' failed: {e}")
            result = ActionResult(
                success=False,
                action=action,
                error=str(e),
            )

        if capture_after:
            try:
                result.capture = self._capture()
            except Exception as e:
                logger.warning(f"Capture-after failed: {e}")

        return self._serialize_result(result)

    # ── action dispatch ──────────────────────────────────────────────

    def _execute(self, action: str, params: dict[str, Any]) -> ActionResult:
        match action:
            case "capture":
                return self._do_capture(params)
            case "click":
                return self._do_click(params)
            case "double_click":
                return self._do_double_click(params)
            case "long_press":
                return self._do_long_press(params)
            case "swipe":
                return self._do_swipe(params)
            case "scroll":
                return self._do_scroll(params)
            case "type":
                return self._do_type(params)
            case "key":
                return self._do_key(params)
            case "home":
                return self._do_home(params)
            case "app_switcher":
                return self._do_app_switcher(params)
            case "launch_app":
                return self._do_launch_app(params)
            case "wait":
                return self._do_wait(params)
            case _:
                return ActionResult(
                    success=False,
                    action=action,
                    error=f"Unknown action: {action}",
                )

    # ── core actions ─────────────────────────────────────────────────

    def _capture(self) -> CaptureResult:
        """Take screenshot + element tree."""
        return self._driver.capture(
            annotate=self._annotate,
            annotate_path="/tmp/ios-capture.png" if self._annotate else None,
        )

    def _do_capture(self, params: dict) -> ActionResult:
        result = self._capture()
        self._last_capture = result
        return ActionResult(
            success=True,
            action="capture",
            capture=result,
        )

    def _do_click(self, params: dict) -> ActionResult:
        element = params.get("element")
        coordinate = params.get("coordinate")

        if element is not None and self._last_capture:
            center = self._driver.get_element_center(
                element, self._last_capture.elements
            )
            if center is None:
                return ActionResult(
                    success=False,
                    action="click",
                    error=f"Element {element} not found. Re-capture to refresh elements.",
                )
            x, y = center
        elif coordinate:
            x, y = coordinate
        else:
            return ActionResult(
                success=False,
                action="click",
                error="Provide 'element' (from capture) or 'coordinate' [x, y]",
            )

        ok = self._driver.tap(x, y)
        return ActionResult(success=ok, action="click")

    def _do_double_click(self, params: dict) -> ActionResult:
        element = params.get("element")
        coordinate = params.get("coordinate")

        if element is not None and self._last_capture:
            center = self._driver.get_element_center(
                element, self._last_capture.elements
            )
            if center is None:
                return ActionResult(
                    success=False,
                    action="double_click",
                    error=f"Element {element} not found.",
                )
            x, y = center
        elif coordinate:
            x, y = coordinate
        else:
            return ActionResult(
                success=False,
                action="double_click",
                error="Provide 'element' or 'coordinate' [x, y]",
            )

        ok = self._driver.double_tap(x, y)
        return ActionResult(success=ok, action="double_click")

    def _do_long_press(self, params: dict) -> ActionResult:
        element = params.get("element")
        coordinate = params.get("coordinate")
        duration = params.get("duration", 1.0)

        if element is not None and self._last_capture:
            center = self._driver.get_element_center(
                element, self._last_capture.elements
            )
            if center is None:
                return ActionResult(
                    success=False,
                    action="long_press",
                    error=f"Element {element} not found.",
                )
            x, y = center
        elif coordinate:
            x, y = coordinate
        else:
            return ActionResult(
                success=False,
                action="long_press",
                error="Provide 'element' or 'coordinate' [x, y]",
            )

        ok = self._driver.long_press(x, y, duration=duration)
        return ActionResult(success=ok, action="long_press")

    def _do_swipe(self, params: dict) -> ActionResult:
        from_element = params.get("from_element")
        to_element = params.get("to_element")
        from_coord = params.get("from_coordinate")
        to_coord = params.get("to_coordinate")
        duration = params.get("duration", 0.3)

        if from_coord and to_coord:
            x1, y1 = from_coord
            x2, y2 = to_coord
        elif (from_element and to_element and self._last_capture):
            c1 = self._driver.get_element_center(from_element, self._last_capture.elements)
            c2 = self._driver.get_element_center(to_element, self._last_capture.elements)
            if not c1 or not c2:
                return ActionResult(
                    success=False,
                    action="swipe",
                    error="Element not found.",
                )
            x1, y1 = c1
            x2, y2 = c2
        else:
            return ActionResult(
                success=False,
                action="swipe",
                error="Provide from/to coordinates or elements.",
            )

        ok = self._driver.swipe(x1, y1, x2, y2, duration=duration)
        return ActionResult(success=ok, action="swipe")

    def _do_scroll(self, params: dict) -> ActionResult:
        direction = params.get("direction", "down")
        amount = params.get("amount", 3)

        try:
            dir_enum = Direction(direction)
        except ValueError:
            return ActionResult(
                success=False,
                action="scroll",
                error=f"Invalid direction: {direction}. Use up/down/left/right.",
            )

        ok = self._driver.scroll(dir_enum, amount=amount)
        return ActionResult(success=ok, action="scroll")

    def _do_type(self, params: dict) -> ActionResult:
        text = params.get("text", "")
        if not text:
            return ActionResult(
                success=False,
                action="type",
                error="No text provided.",
            )

        ok = self._driver.type_text(text)
        return ActionResult(success=ok, action="type")

    def _do_key(self, params: dict) -> ActionResult:
        keys = params.get("keys", "")

        key_actions = {
            "return": self._driver.press_home,
            "home": self._driver.press_home,
            "escape": self._driver.press_app_switcher,
        }

        handler = key_actions.get(keys.lower())
        if handler:
            ok = handler()
        else:
            # For text keys, just type the key
            ok = self._driver.type_text(keys)

        return ActionResult(success=ok, action="key")

    def _do_home(self, params: dict) -> ActionResult:
        ok = self._driver.press_home()
        return ActionResult(success=ok, action="home")

    def _do_app_switcher(self, params: dict) -> ActionResult:
        ok = self._driver.press_app_switcher()
        return ActionResult(success=ok, action="app_switcher")

    def _do_launch_app(self, params: dict) -> ActionResult:
        bundle_id = params.get("bundle_id", "")
        if not bundle_id:
            return ActionResult(
                success=False,
                action="launch_app",
                error="Provide bundle_id (e.g. 'com.apple.mobilesafari')",
            )
        ok = self._driver.launch_app(bundle_id)
        return ActionResult(success=ok, action="launch_app")

    def _do_wait(self, params: dict) -> ActionResult:
        seconds = min(params.get("seconds", 1), 30)
        time.sleep(seconds)
        return ActionResult(success=True, action="wait")

    # ── utility ──────────────────────────────────────────────────────

    def health(self) -> dict:
        """Check device/WDA connection status."""
        return self._driver.health()

    def _serialize_result(self, result: ActionResult) -> dict:
        """Convert ActionResult to JSON-safe dict."""
        d: dict[str, Any] = {
            "success": result.success,
            "action": result.action,
        }
        if result.error:
            d["error"] = result.error

        if result.capture:
            cap = result.capture
            d["capture"] = {
                "width": cap.width,
                "height": cap.height,
                "elements": [
                    {
                        "index": e.index,
                        "label": e.label,
                        "role": e.role,
                        "bounds": e.bounds,
                        "enabled": e.enabled,
                    }
                    for e in cap.elements
                ],
                "total_elements": cap.total_elements,
                "current_app": cap.current_app,
                "orientation": cap.orientation,
            }
            if cap.screenshot_b64:
                d["capture"]["screenshot_b64"] = cap.screenshot_b64
            if cap.screenshot_path:
                d["capture"]["screenshot_path"] = cap.screenshot_path

        return d

    @property
    def driver(self):
        """Access the underlying backend driver."""
        return self._driver

    @property
    def last_capture(self) -> CaptureResult | None:
        """The most recent capture result, if any."""
        return self._last_capture
