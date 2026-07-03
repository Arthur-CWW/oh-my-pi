"""Pre-mapped iOS actions with known coordinates.

All pixel coordinates are for the default vphone screen: 1290x2796 @ 3x.
These were calibrated by taking screenshots and tapping interactively.
"""

# Screen dimensions (default vphone config)
SCREEN_W = 1290
SCREEN_H = 2796

# ---------------------------------------------------------------------------
# Home screen app grid
# ---------------------------------------------------------------------------
# The home screen has a 4-column grid. Calibrated positions:
#   Column centers: ~180, 500, 820, 1120
#   Row 1 (first app row): y ≈ 1050
#   Row 2: y ≈ 1310
#   Row 3: y ≈ 1570
#   Row 4: y ≈ 1830
#   Dock: y ≈ 2500
#
# Row spacing: ~260px, column spacing: ~320px

GRID_COLS = [180, 500, 820, 1120]
GRID_ROWS = [1050, 1310, 1570, 1830]
DOCK_Y = 2500
DOCK_COLS = [180, 460, 820, 1120]

# Default home screen layout (first page, after fresh setup)
# Maps app name -> (column_index, row_index) — 0-based
HOME_SCREEN_APPS: dict[str, tuple[int, int]] = {
    "facetime": (0, 0),
    "calendar": (1, 0),
    "photos": (2, 0),
    "mail": (3, 0),
    "notes": (0, 1),
    "reminders": (1, 1),
    "clock": (2, 1),
    "tv": (3, 1),
    "games": (0, 2),
    "app store": (1, 2),
    "maps": (2, 2),
    "health": (3, 2),
    "wallet": (0, 3),
    "settings": (1, 3),
}

DOCK_APPS: dict[str, int] = {
    "phone": 0,
    "safari": 1,
    "messages": 2,
    "music": 3,
}

# ---------------------------------------------------------------------------
# Navigation chrome (stable across apps)
# ---------------------------------------------------------------------------

# iOS navigation bar back button (top-left, below Dynamic Island)
BACK_BUTTON = (150, 300)

# Search bar on home screen
SEARCH_BAR = (645, 2100)

# ---------------------------------------------------------------------------
# Swipe gestures
# ---------------------------------------------------------------------------

# Scroll down (mid-screen drag upward)
SCROLL_DOWN = {"x1": 645, "y1": 1800, "x2": 645, "y2": 800, "ms": 300}

# Scroll up (mid-screen drag downward)
SCROLL_UP = {"x1": 645, "y1": 800, "x2": 645, "y2": 1800, "ms": 300}

# Notification Center (swipe down from top-left)
NOTIFICATION_CENTER = {"x1": 200, "y1": 50, "x2": 200, "y2": 1400, "ms": 250}

# Control Center (swipe down from top-right)
CONTROL_CENTER = {"x1": 1100, "y1": 50, "x2": 1100, "y2": 1400, "ms": 250}

# App Switcher (slow swipe up from bottom, stop mid-screen)
APP_SWITCHER = {"x1": 645, "y1": 2790, "x2": 645, "y2": 1400, "ms": 500}

# Swipe to next home screen page
NEXT_PAGE = {"x1": 1200, "y1": 1400, "x2": 100, "y2": 1400, "ms": 250}

# Swipe to previous home screen page
PREV_PAGE = {"x1": 100, "y1": 1400, "x2": 1200, "y2": 1400, "ms": 250}

def app_position(name: str) -> tuple[float, float] | None:
    """Return pixel (x, y) for an app on the home screen or dock."""
    key = name.lower().strip()

    if key in DOCK_APPS:
        col = DOCK_APPS[key]
        return (DOCK_COLS[col], DOCK_Y)

    if key in HOME_SCREEN_APPS:
        col, row = HOME_SCREEN_APPS[key]
        return (GRID_COLS[col], GRID_ROWS[row])

    return None
