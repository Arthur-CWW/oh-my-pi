#!/usr/bin/env python3
"""iOS Computer Use CLI — control your iPhone from the terminal.

Usage:
  # Check connection
  iosctl health

  # Take annotated screenshot
  iosctl capture

  # Tap element #5 from the last capture
  iosctl click --element 5

  # Tap at specific coordinates
  iosctl click --coord 200,400

  # Type text
  iosctl type "Hello World"

  # Scroll
  iosctl scroll down --amount 2

  # Launch an app
  iosctl launch com.apple.mobilesafari

  # Press home
  iosctl home

Environment:
  IOS_WDA_URL    WDA endpoint (default: http://localhost:8100)
  IOS_HUMANIZE   Enable human-like input (default: true)
"""

import json
import os
import sys
from pathlib import Path

# Add package to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.ios_computer_use import iOSComputerUse


def get_ios() -> iOSComputerUse:
    wda_url = os.environ.get("IOS_WDA_URL", "http://localhost:8100")
    humanize = os.environ.get("IOS_HUMANIZE", "true").lower() != "false"
    return iOSComputerUse(wda_url=wda_url, humanize=humanize)


def cmd_health(args: list[str]) -> None:
    ios = get_ios()
    result = ios.health()
    print(json.dumps(result, indent=2))


def cmd_capture(args: list[str]) -> None:
    ios = get_ios()
    result = ios.action("capture", {"capture_after": False})
    print(json.dumps(result, indent=2, default=str)[:5000])
    if result.get("capture", {}).get("screenshot_path"):
        print(f"\nScreenshot saved: {result['capture']['screenshot_path']}")


def cmd_click(args: list[str]) -> None:
    ios = get_ios()
    params = {}
    for a in args:
        if a.startswith("--element="):
            params["element"] = int(a.split("=", 1)[1])
        elif a.startswith("--coord="):
            coord = a.split("=", 1)[1]
            x, y = coord.split(",")
            params["coordinate"] = [int(x), int(y)]
        elif a == "--capture-after":
            params["capture_after"] = True

    if "--double" in args:
        result = ios.action("double_click", params)
    elif "--long" in args:
        params["duration"] = 1.0
        result = ios.action("long_press", params)
    else:
        result = ios.action("click", params)
    print(json.dumps(result, indent=2))


def cmd_type(args: list[str]) -> None:
    text = " ".join(a for a in args if not a.startswith("--"))
    ios = get_ios()
    result = ios.action("type", {"text": text})
    print(json.dumps(result, indent=2))


def cmd_scroll(args: list[str]) -> None:
    ios = get_ios()
    direction = "down"
    amount = 3
    for a in args:
        if a in ("up", "down", "left", "right"):
            direction = a
        elif a.startswith("--amount="):
            amount = int(a.split("=", 1)[1])
    result = ios.action("scroll", {"direction": direction, "amount": amount})
    print(json.dumps(result, indent=2))


def cmd_swipe(args: list[str]) -> None:
    ios = get_ios()
    params = {}
    for a in args:
        if a.startswith("--from="):
            x, y = a.split("=", 1)[1].split(",")
            params["from_coordinate"] = [int(x), int(y)]
        elif a.startswith("--to="):
            x, y = a.split("=", 1)[1].split(",")
            params["to_coordinate"] = [int(x), int(y)]
        elif a.startswith("--duration="):
            params["duration"] = float(a.split("=", 1)[1])
    result = ios.action("swipe", params)
    print(json.dumps(result, indent=2))


def cmd_home(args: list[str]) -> None:
    ios = get_ios()
    result = ios.action("home")
    print(json.dumps(result, indent=2))


def cmd_launch(args: list[str]) -> None:
    bundle_id = args[0] if args else ""
    if not bundle_id:
        print("Usage: iosctl launch <bundle_id>")
        print("Examples: com.apple.mobilesafari, com.apple.Preferences")
        sys.exit(1)
    ios = get_ios()
    result = ios.action("launch_app", {"bundle_id": bundle_id})
    print(json.dumps(result, indent=2))


def cmd_app_switcher(args: list[str]) -> None:
    ios = get_ios()
    result = ios.action("app_switcher")
    print(json.dumps(result, indent=2))


COMMANDS = {
    "health": cmd_health,
    "capture": cmd_capture,
    "click": cmd_click,
    "type": cmd_type,
    "scroll": cmd_scroll,
    "swipe": cmd_swipe,
    "home": cmd_home,
    "launch": cmd_launch,
    "app-switcher": cmd_app_switcher,
    "help": lambda _: print(__doc__),
}


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    handler = COMMANDS.get(cmd)
    if handler is None:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)

    handler(sys.argv[2:])


if __name__ == "__main__":
    main()
