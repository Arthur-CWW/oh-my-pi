"""Type definitions for iOS Computer Use interface.

Mirrors Hermes computer_use tool interface for model compatibility.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Action(str, Enum):
    """Supported iOS Computer Use actions."""

    CAPTURE = "capture"
    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    LONG_PRESS = "long_press"
    SWIPE = "swipe"
    SCROLL = "scroll"
    TYPE = "type"
    KEY = "key"
    HOME = "home"
    APP_SWITCHER = "app_switcher"
    LAUNCH_APP = "launch_app"
    WAIT = "wait"


class Direction(str, Enum):
    UP = "up"
    DOWN = "down"
    LEFT = "left"
    RIGHT = "right"


@dataclass
class Element:
    """An interactive UI element on screen."""

    index: int
    label: str
    role: str
    bounds: dict[str, int]  # {x, y, width, height}
    enabled: bool = True
    visible: bool = True
    value: str | None = None


@dataclass
class CaptureResult:
    """Result of a capture action (screenshot + elements)."""

    width: int
    height: int
    screenshot_b64: str | None = None  # base64 PNG
    screenshot_path: str | None = None  # local file path
    elements: list[Element] = field(default_factory=list)
    total_elements: int = 0
    orientation: str = "portrait"  # portrait, landscape_left, landscape_right
    current_app: str | None = None  # bundle ID


@dataclass
class ActionResult:
    """Result of any action."""

    success: bool
    action: str
    error: str | None = None
    capture: CaptureResult | None = None  # when capture_after=True


@dataclass
class HumanizeConfig:
    """Configuration for human-like input behavior."""

    enabled: bool = True
    tap_duration_ms: tuple[int, int] = (50, 150)  # random range
    action_delay_ms: tuple[int, int] = (100, 400)  # delay between actions
    typing_wpm: tuple[int, int] = (40, 80)  # words per minute range
    typo_rate: float = 0.02  # probability of typo + correction
    swipe_curve_variance: float = 0.15  # deviation from straight line
    coordinate_jitter: int = 3  # pixels of random offset per tap
    scroll_deceleration: bool = True  # natural-feeling deceleration
