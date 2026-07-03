"""QA input realism utilities for owned iOS control.

Adds bounded variance to taps, swipes, typing, and timing so local
detectability measurements are not dominated by self-inflicted lab
artifacts such as perfectly repeated coordinates or machine-constant
delays. This is for authorized QA against owned devices and our own
blue-team measurement apps; it is measurement hygiene only and does not
authorize use against XCTest checks or third-party anti-abuse systems.
"""

from __future__ import annotations

import math
import random
import time
from typing import Any

from src.types import Direction, HumanizeConfig


DEFAULT_CONFIG = HumanizeConfig()


class Humanizer:
    """Wraps an iOS backend with QA-realistic input behavior."""

    def __init__(self, backend: Any, config: HumanizeConfig | None = None):
        self._backend = backend
        self.config = config or DEFAULT_CONFIG
        if not self.config.enabled:
            # Use passthrough mode with minimal delays
            self.config = HumanizeConfig(
                enabled=True,
                tap_duration_ms=(50, 80),
                action_delay_ms=(20, 50),
                typing_wpm=(100, 120),
                typo_rate=0,
                swipe_curve_variance=0.02,
                coordinate_jitter=0,
                scroll_deceleration=False,
            )

    def __getattr__(self, name: str):
        """Passthrough unknown attributes to the backend."""
        return getattr(self._backend, name)

    # ── timing ───────────────────────────────────────────────────────

    def _delay(self) -> None:
        """Random inter-action delay."""
        ms = random.randint(*self.config.action_delay_ms)
        time.sleep(ms / 1000)

    def _tap_hold(self) -> float:
        """Random tap hold duration."""
        ms = random.randint(*self.config.tap_duration_ms)
        return ms / 1000

    def _typing_delay(self, char: str) -> float:
        """Random delay for typing a character."""
        # Base delay from WPM
        avg_wpm = random.randint(*self.config.typing_wpm)
        base_ms = (60_000 / (avg_wpm * 5))  # 5 chars per word

        # Add micro-variance (faster for common letters, slower for symbols)
        variance = random.gauss(0, base_ms * 0.3)
        delay_ms = max(20, base_ms + variance)

        # Space and punctuation: slower
        if char in " ,.!?;:()[]{}":
            delay_ms *= random.uniform(1.2, 2.0)

        # Shifted characters: slower
        if char.isupper() or char in '~!@#$%^&*()_+{}|:"<>?':
            delay_ms *= random.uniform(1.3, 1.8)

        return delay_ms / 1000

    # ── coordinates ──────────────────────────────────────────────────

    def _jitter(self, x: int, y: int) -> tuple[int, int]:
        """Add random sub-pixel jitter to coordinates."""
        if self.config.coordinate_jitter <= 0:
            return (x, y)
        jx = random.randint(-self.config.coordinate_jitter, self.config.coordinate_jitter)
        jy = random.randint(-self.config.coordinate_jitter, self.config.coordinate_jitter)
        return (x + jx, y + jy)

    def _swipe_bezier(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        steps: int = 20,
    ) -> list[tuple[int, int]]:
        """Generate a bezier curve for swipe instead of a straight line."""
        variance = self.config.swipe_curve_variance
        if variance <= 0.001:
            return [(x1, y1), (x2, y2)]

        # Control point: midpoint with random offset perpendicular to direction
        dx, dy = x2 - x1, y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1:
            return [(x1, y1), (x2, y2)]

        # Perpendicular direction
        perp_x = -dy / length
        perp_y = dx / length

        # Random offset for control point
        offset = length * variance * random.uniform(-1, 1)
        cx = (x1 + x2) / 2 + perp_x * offset
        cy = (y1 + y2) / 2 + perp_y * offset

        # Quadratic bezier
        points = []
        for i in range(steps + 1):
            t = i / steps
            px = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2
            py = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2
            points.append((int(px), int(py)))

        return points

    def _scroll_decelerate(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
    ) -> list[tuple[int, int]]:
        """Generate points for a scroll with natural deceleration."""
        steps = 25
        points = []
        for i in range(steps + 1):
            t = i / steps
            # Ease-out cubic
            eased = 1 - (1 - t) ** 3
            px = int(start_x + (end_x - start_x) * eased)
            py = int(start_y + (end_y - start_y) * eased)
            points.append((px, py))
        return points

    # ── wrapped actions ──────────────────────────────────────────────

    def tap(self, x: int, y: int, **kwargs) -> bool:
        """Humanized tap."""
        self._delay()
        x, y = self._jitter(x, y)
        duration = self._tap_hold()
        return self._backend.tap(x, y, duration=duration)

    def double_tap(self, x: int, y: int, **kwargs) -> bool:
        """Humanized double tap with inter-tap delay."""
        self._delay()
        x, y = self._jitter(x, y)
        r1 = self._backend.tap(x, y)
        time.sleep(random.uniform(0.05, 0.15))
        r2 = self._backend.tap(x, y)
        return r1 and r2

    def long_press(self, x: int, y: int, **kwargs) -> bool:
        """Humanized long press."""
        self._delay()
        x, y = self._jitter(x, y)
        duration = kwargs.get("duration", 1.0)
        duration += random.uniform(0.05, 0.2)
        return self._backend.long_press(x, y, duration)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, **kwargs) -> bool:
        """Humanized swipe with curved path."""
        self._delay()
        points = self._swipe_bezier(x1, y1, x2, y2)
        duration = kwargs.get("duration", 0.3)
        step_duration = duration / len(points)

        for px, py in points:
            self._backend.tap(px, py, duration=step_duration)
            time.sleep(step_duration)
        return True

    def scroll(self, direction: Direction, amount: int = 3, **kwargs) -> bool:
        """Humanized scroll with deceleration curve."""
        self._delay()
        w, h = self._backend.screen_size

        if direction == Direction.UP:
            start_x, start_y = w // 2, int(h * 0.5)
            end_x, end_y = w // 2, int(h * 0.5 - h * 0.3 * amount)
        elif direction == Direction.DOWN:
            start_x, start_y = w // 2, int(h * 0.5)
            end_x, end_y = w // 2, int(h * 0.5 + h * 0.3 * amount)
        elif direction == Direction.LEFT:
            start_x, start_y = int(w * 0.7), h // 2
            end_x, end_y = int(w * 0.3), h // 2
        else:
            start_x, start_y = int(w * 0.3), h // 2
            end_x, end_y = int(w * 0.7), h // 2

        if self.config.scroll_deceleration:
            points = self._scroll_decelerate(start_x, start_y, end_x, end_y)
        else:
            points = [(start_x, start_y), (end_x, end_y)]

        duration = 0.4 + 0.1 * amount
        step_duration = duration / len(points)

        for px, py in points:
            self._backend.tap(px, py, duration=step_duration)
            time.sleep(step_duration)
        return True

    def type_text(self, text: str, **kwargs) -> bool:
        """Humanized typing with variable speed and occasional typos."""
        self._delay()

        if self.config.typo_rate > 0 and len(text) > 3:
            # Occasionally introduce and correct a typo
            if random.random() < self.config.typo_rate:
                idx = random.randint(0, len(text) - 2)
                # Type up to typo
                self._backend.type_text(text[:idx + 1])
                time.sleep(self._typing_delay(text[idx + 1]))

                # Type wrong char
                wrong = self._adjacent_key(text[idx])
                self._backend.type_text(wrong)
                time.sleep(random.uniform(0.15, 0.35))

                # Backspace and correct
                self._backend.type_text("\b")
                time.sleep(random.uniform(0.08, 0.2))
                self._backend.type_text(text[idx + 1:])
                return True

        # Normal typing with variable inter-char delay
        for char in text:
            self._backend.type_text(char)
            time.sleep(self._typing_delay(char))

        return True

    @staticmethod
    def _adjacent_key(char: str) -> str:
        """Return a keyboard-adjacent key for typo simulation."""
        adjacent = {
            "a": "s", "b": "n", "c": "x", "d": "f", "e": "r",
            "f": "g", "g": "h", "h": "j", "i": "o", "j": "k",
            "k": "l", "l": "k", "m": "n", "n": "m", "o": "p",
            "p": "o", "q": "w", "r": "t", "s": "a", "t": "y",
            "u": "i", "v": "b", "w": "e", "x": "z", "y": "u",
            "z": "a",
        }
        return adjacent.get(char.lower(), char)
