"""WebDriverAgent backend for iOS control.

Requires WebDriverAgent running on the device. Start with:
  tidevice xcuitest -B com.facebook.wda.WebDriverAgent.Runner
or
  ios runwda

Architecture:
  macOS → USB/WiFi → iPhone running WDA
                           ↳ WDA HTTP API (default :8100)
                               ↳ XCTest touch/screenshot/source
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from typing import Any

import wda
from PIL import Image, ImageDraw, ImageFont

from src.types import (
    Action,
    ActionResult,
    CaptureResult,
    Direction,
    Element,
)

logger = logging.getLogger(__name__)


class WDABackend:
    """Control an iOS device via WebDriverAgent's HTTP API."""

    def __init__(
        self,
        wda_url: str = "http://localhost:8100",
        bundle_id: str | None = None,
    ):
        """Initialize WDA client.

        Args:
            wda_url: WDA HTTP endpoint (default: http://localhost:8100).
                     This is the port WDA listens on when launched on-device
                     and forwarded via USB/WiFi.
            bundle_id: Default app bundle ID to activate.
        """
        self.wda_url = wda_url
        self.bundle_id = bundle_id
        self._client: wda.Client | None = None
        self._session: wda.Session | None = None
        self._screen_size: tuple[int, int] | None = None

    @property
    def client(self) -> facebook_wda.Client:
        if self._client is None:
            self._client = facebook_wda.Client(self.wda_url)
        return self._client

    @property
    def session(self) -> facebook_wda.Session:
        if self._session is None:
            self._session = self.client.session()
        return self._session

    @property
    def screen_size(self) -> tuple[int, int]:
        if self._screen_size is None:
            s = self.session.window_size()
            self._screen_size = (s["width"], s["height"])
        return self._screen_size

    # ── health / connection ──────────────────────────────────────────

    def health(self) -> dict:
        """Check WDA connection and status."""
        try:
            status = self.client.status()
            size = self.session.window_size()
            return {
                "connected": True,
                "wda_version": status.get("value", {}).get("build", {}).get("productBundleVersion", "unknown"),
                "screen": size,
                "wda_url": self.wda_url,
            }
        except Exception as e:
            return {"connected": False, "error": str(e), "wda_url": self.wda_url}

    # ── capture ──────────────────────────────────────────────────────

    def screenshot(self) -> bytes:
        """Take a screenshot, returns PNG bytes."""
        return self.session.screenshot()

    def screenshot_b64(self) -> str:
        """Take a screenshot, returns base64-encoded PNG."""
        return base64.b64encode(self.screenshot()).decode("utf-8")

    def source(self) -> str:
        """Get the accessibility tree as XML (Page Source)."""
        return self.session.source()

    def capture(
        self,
        annotate: bool = False,
        annotate_path: str | None = None,
    ) -> CaptureResult:
        """Capture screenshot + element tree in one call.

        Args:
            annotate: If True, draw element boxes on the screenshot.
            annotate_path: Save annotated screenshot to this path.

        Returns:
            CaptureResult with screenshot, dimensions, and elements.
        """
        # Get screenshot
        png = self.screenshot()
        img = Image.open(io.BytesIO(png))
        width, height = img.size

        # Get element tree
        try:
            source_xml = self.source()
            elements = self._parse_elements(source_xml, width, height)
        except Exception:
            elements = []

        # Get current app
        try:
            app = self.session.app_current()
            current_app = app.get("bundleId")
        except Exception:
            current_app = None

        # Annotate if requested
        screenshot_b64 = base64.b64encode(png).decode("utf-8")
        screenshot_path = None

        if annotate:
            self._annotate_screenshot(img, elements)
            if annotate_path:
                img.save(annotate_path)
                screenshot_path = annotate_path
            else:
                path = "/tmp/ios-capture-annotated.png"
                img.save(path)
                screenshot_path = path

        return CaptureResult(
            width=width,
            height=height,
            screenshot_b64=screenshot_b64,
            screenshot_path=screenshot_path,
            elements=elements,
            total_elements=len(elements),
            current_app=current_app,
        )

    # ── element parsing ──────────────────────────────────────────────

    def _parse_elements(
        self,
        source_xml: str,
        screen_width: int,
        screen_height: int,
    ) -> list[Element]:
        """Parse WDA page source XML into Element list.

        Filters to interactive elements (tappable, text fields, etc.)
        and assigns 1-based indices matching the SOM convention.
        """
        try:
            root = ET.fromstring(source_xml)
        except ET.ParseError:
            return []

        elements = []
        index = 0
        for el in root.iter():
            attrs = el.attrib
            role = attrs.get("type", "Other")
            label = attrs.get("label", "") or attrs.get("name", "") or ""
            enabled = attrs.get("enabled", "true") == "true"
            visible = attrs.get("visible", "true") == "true"
            value = attrs.get("value")

            # Parse bounds
            bounds = {}
            for key in ("x", "y", "width", "height"):
                val = attrs.get(key)
                if val is not None:
                    try:
                        bounds[key] = int(float(val))
                    except (ValueError, TypeError):
                        bounds[key] = 0

            # Skip non-interactive elements
            if not self._is_interactive(role, bounds, visible, enabled):
                continue

            # Clip off-screen elements
            if not bounds:
                continue
            x, y = bounds.get("x", 0), bounds.get("y", 0)
            w, h = bounds.get("width", 0), bounds.get("height", 0)
            if x < 0 or y < 0 or x + w > screen_width or y + h > screen_height:
                continue
            if w <= 0 or h <= 0:
                continue

            index += 1
            elements.append(Element(
                index=index,
                label=label,
                role=role,
                bounds=bounds,
                enabled=enabled,
                visible=visible,
                value=value,
            ))

        return elements

    @staticmethod
    def _is_interactive(
        role: str,
        bounds: dict[str, int],
        visible: bool,
        enabled: bool,
    ) -> bool:
        """Check if element is something an agent would interact with."""
        if not visible or not enabled:
            return False
        if not bounds:
            return False

        interactive_roles = {
            "XCUIElementTypeButton",
            "XCUIElementTypeLink",
            "XCUIElementTypeTextField",
            "XCUIElementTypeSecureTextField",
            "XCUIElementTypeTextView",
            "XCUIElementTypeSwitch",
            "XCUIElementTypeSlider",
            "XCUIElementTypePickerWheel",
            "XCUIElementTypeSegmentedControl",
            "XCUIElementTypeStepper",
            "XCUIElementTypeTab",
            "XCUIElementTypePageIndicator",
            "XCUIElementTypeCell",
            "XCUIElementTypeMenuItem",
            "XCUIElementTypeMenuBarItem",
        }
        return role in interactive_roles

    def _annotate_screenshot(
        self,
        img: Image.Image,
        elements: list[Element],
    ) -> None:
        """Draw numbered boxes on the screenshot for visual SOM output."""
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
        except OSError:
            font = ImageFont.load_default()

        for el in elements:
            b = el.bounds
            x, y, w, h = b["x"], b["y"], b["width"], b["height"]

            color = (0, 255, 0) if el.enabled else (255, 0, 0)
            draw.rectangle([x, y, x + w, y + h], outline=color, width=2)

            # Number label background
            label = str(el.index)
            bbox = draw.textbbox((0, 0), label, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.rectangle([x, y - th - 4, x + tw + 4, y], fill=color)
            draw.text((x + 2, y - th - 2), label, fill=(0, 0, 0), font=font)

    # ── actions ──────────────────────────────────────────────────────

    def tap(self, x: int, y: int, duration: float = 0.1) -> bool:
        """Tap at (x, y) with optional hold duration."""
        self.session.tap(x, y)
        if duration > 0.1:
            time.sleep(duration)
        return True

    def double_tap(self, x: int, y: int) -> bool:
        """Double tap at (x, y)."""
        self.session.double_tap(x, y)
        return True

    def long_press(self, x: int, y: int, duration: float = 1.0) -> bool:
        """Long press at (x, y) for duration seconds."""
        # WDA: tap with duration acts as long press
        self.session.tap_hold(x, y, duration)
        return True

    def swipe(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration: float = 0.3,
    ) -> bool:
        """Swipe from (x1, y1) to (x2, y2)."""
        self.session.swipe(x1, y1, x2, y2, duration)
        return True

    def scroll(self, direction: Direction, amount: int = 3) -> bool:
        """Scroll in direction by amount (in screen-fraction steps)."""
        w, h = self.screen_size
        step = 0.3 * amount  # fraction of screen

        if direction == Direction.UP:
            self.swipe(w // 2, int(h * 0.7), w // 2, int(h * 0.7 - h * step), 0.3)
        elif direction == Direction.DOWN:
            self.swipe(w // 2, int(h * 0.3), w // 2, int(h * 0.3 + h * step), 0.3)
        elif direction == Direction.LEFT:
            self.swipe(int(w * 0.8), h // 2, int(w * 0.2), h // 2, 0.3)
        elif direction == Direction.RIGHT:
            self.swipe(int(w * 0.2), h // 2, int(w * 0.8), h // 2, 0.3)
        return True

    def type_text(self, text: str) -> bool:
        """Type text into the focused field."""
        self.session.send_keys(text)
        return True

    def clear_text(self) -> bool:
        """Clear text in the focused field."""
        self.session.clear_text()
        return True

    def press_home(self) -> bool:
        """Press the Home button."""
        self.session.home()
        return True

    def press_app_switcher(self) -> bool:
        """Open the app switcher."""
        self.session.app_switcher()
        return True

    def launch_app(self, bundle_id: str) -> bool:
        """Launch an app by bundle ID."""
        self.session.app_activate(bundle_id)
        return True

    def terminate_app(self, bundle_id: str) -> bool:
        """Terminate an app by bundle ID."""
        self.session.app_terminate(bundle_id)
        return True

    def get_current_app(self) -> dict:
        """Get current foreground app info."""
        return self.session.app_current()

    def get_orientation(self) -> str:
        """Get device orientation."""
        info = self.session.orientation()
        return info.get("value", "portrait")

    def set_orientation(self, orientation: str) -> bool:
        """Set device orientation (portrait, landscape_left, landscape_right)."""
        self.session.orientation(orientation)
        return True

    # ── element-based actions ────────────────────────────────────────

    def tap_element(self, element_index: int, elements: list[Element]) -> bool:
        """Tap on an element by its SOM index."""
        el = self._find_element(element_index, elements)
        if el is None:
            return False
        b = el.bounds
        cx = b["x"] + b["width"] // 2
        cy = b["y"] + b["height"] // 2
        return self.tap(cx, cy)

    def get_element_center(self, element_index: int, elements: list[Element]) -> tuple[int, int] | None:
        """Get center coordinates of an element by its SOM index."""
        el = self._find_element(element_index, elements)
        if el is None:
            return None
        b = el.bounds
        return (b["x"] + b["width"] // 2, b["y"] + b["height"] // 2)

    def _find_element(self, index: int, elements: list[Element]) -> Element | None:
        for el in elements:
            if el.index == index:
                return el
        return None
