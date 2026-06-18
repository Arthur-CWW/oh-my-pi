#!/usr/bin/env python3
"""Compare logged-in X.com tab footprint across local browsers.

The script extracts current X/Twitter URLs from Firefox session restore, launches a
background CuaDriver-controlled browser instance with a DevTools port, opens and
activates tabs through CDP, measures process CPU/RSS, then closes the benchmark
targets. It never uses browser hotkeys unless --tab-control=hotkeys is explicitly
selected.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from collections import Counter, defaultdict
from typing import Any
from urllib import error, parse, request
from urllib.parse import urlparse

CUA_DRIVER = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
FIREFOX_RECOVERY = (
    "/Users/arthur/Library/Application Support/Firefox/Profiles/"
    "jsobtawl.default-release-1758944537323/sessionstore-backups/recovery.jsonlz4"
)
FIREFOX_EXECUTABLE = "/Applications/Firefox.app/Contents/MacOS/firefox"
CHROME_BUNDLE = "com.google.Chrome"
CHROME_APP_NAME = "Google Chrome"
CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HELIUM_BUNDLE = "net.imput.helium"
HELIUM_APP_NAME = "Helium"
HELIUM_EXECUTABLE = "/Applications/Helium.app/Contents/MacOS/Helium"
DEFAULT_HELIUM_PROFILE = "/Users/arthur/.pi/pi-web-access/helium-chatgpt-profile"


def mozlz4_decompress_block(src: bytes) -> bytes:
    index = 0
    out = bytearray()
    while index < len(src):
        token = src[index]
        index += 1
        literal_len = token >> 4
        if literal_len == 15:
            while True:
                value = src[index]
                index += 1
                literal_len += value
                if value != 255:
                    break
        out.extend(src[index:index + literal_len])
        index += literal_len
        if index >= len(src):
            break
        offset = src[index] | (src[index + 1] << 8)
        index += 2
        match_len = token & 15
        if match_len == 15:
            while True:
                value = src[index]
                index += 1
                match_len += value
                if value != 255:
                    break
        match_len += 4
        start = len(out) - offset
        if start < 0:
            raise ValueError("invalid mozlz4 offset")
        for pos in range(match_len):
            out.append(out[start + pos])
    return bytes(out)


def firefox_x_urls(path: Path) -> list[str]:
    raw = path.read_bytes()
    if not raw.startswith(b"mozLz40\x00"):
        raise ValueError(f"unexpected Firefox sessionstore header in {path}")
    data = json.loads(mozlz4_decompress_block(raw[12:]))
    urls: list[str] = []
    for window in data.get("windows", []):
        for tab in window.get("tabs", []):
            entries = tab.get("entries", [])
            selected = tab.get("index", len(entries)) - 1
            entry = entries[selected] if 0 <= selected < len(entries) else (entries[-1] if entries else {})
            url = entry.get("url", "")
            host = urlparse(url).netloc
            if host in {"x.com", "twitter.com"}:
                urls.append(url)
    return urls



def read_http_text(url: str, timeout: float = 10, method: str = "GET") -> str:
    req = request.Request(url, method=method)
    with request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8")


def read_http_json(url: str, timeout: float = 10, method: str = "GET") -> Any:
    return json.loads(read_http_text(url, timeout=timeout, method=method))


def run_text(args: list[str], timeout: float = 30) -> str:
    return subprocess.check_output(args, text=True, timeout=timeout)


def cua(tool: str, payload: dict[str, Any], driver: str) -> dict[str, Any]:
    raw = run_text([driver, "call", tool, json.dumps(payload)], timeout=60)
    return json.loads(raw)


def cua_no_json(tool: str, payload: dict[str, Any], driver: str) -> str:
    return run_text([driver, "call", tool, json.dumps(payload)], timeout=60)


def ps_rows() -> list[tuple[int, int, float, int, str]]:
    output = run_text(["ps", "-axo", "pid=,ppid=,pcpu=,rss=,args="], timeout=10)
    rows: list[tuple[int, int, float, int, str]] = []
    for line in output.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        rows.append((int(parts[0]), int(parts[1]), float(parts[2]), int(parts[3]), parts[4]))
    return rows


def browser_roots(browser: str, helium_profile: str, chrome_profile: str) -> list[int]:
    roots: list[int] = []
    for pid, _ppid, _cpu, _rss, args in ps_rows():
        if browser == "chrome":
            if CHROME_EXECUTABLE not in args or "--type=" in args:
                continue
            if chrome_profile:
                if f"--user-data-dir={chrome_profile}" in args:
                    roots.append(pid)
            elif "--user-data-dir=" not in args:
                roots.append(pid)
        elif browser == "helium":
            if HELIUM_EXECUTABLE in args and "--type=" not in args and f"--user-data-dir={helium_profile}" in args:
                roots.append(pid)
        elif browser == "firefox":
            if FIREFOX_EXECUTABLE in args and "-contentproc" not in args:
                roots.append(pid)
    return roots


def descendants(root_pid: int) -> list[tuple[int, int, float, int, str]]:
    rows = ps_rows()
    by_ppid: dict[int, list[int]] = defaultdict(list)
    by_pid = {row[0]: row for row in rows}
    for row in rows:
        by_ppid[row[1]].append(row[0])
    seen: set[int] = set()
    stack = [root_pid]
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        stack.extend(by_ppid.get(pid, []))
    return [by_pid[pid] for pid in seen if pid in by_pid]


def summarize_roots(roots: list[int]) -> dict[str, Any]:
    rows: list[tuple[int, int, float, int, str]] = []
    for root in roots:
        rows.extend(descendants(root))
    unique = {row[0]: row for row in rows}.values()
    top = sorted(
        ((cpu, round(rss / 1024, 1), pid, args[:140]) for pid, _ppid, cpu, rss, args in unique),
        reverse=True,
    )[:12]
    rows_list = list(unique)
    return {
        "root_pids": roots,
        "processes": len(rows_list),
        "cpu_percent": round(sum(row[2] for row in rows_list), 1),
        "rss_mb": round(sum(row[3] for row in rows_list) / 1024, 1),
        "top": top,
    }


def normal_windows(app_name: str, pid: int, driver: str) -> list[dict[str, Any]]:
    data = cua("list_windows", {}, driver)
    windows = []
    for window in data.get("windows", []):
        if window.get("app_name") != app_name or window.get("pid") != pid:
            continue
        bounds = window.get("bounds") or {}
        if bounds.get("height", 0) > 100 and bounds.get("width", 0) > 300:
            windows.append(window)
    windows.sort(key=lambda item: item.get("z_index", 0), reverse=True)
    return windows


def wait_for_window(app_name: str, pid: int, driver: str, timeout: float = 20) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: list[dict[str, Any]] = []
    while time.time() < deadline:
        last = normal_windows(app_name, pid, driver)
        if last:
            return last[0]
        time.sleep(0.5)
    raise RuntimeError(f"no normal {app_name} window for pid {pid}; last={last}")


def wait_for_any_window(app_name: str, pids: list[int], driver: str, timeout: float = 20) -> tuple[int, dict[str, Any]]:
    deadline = time.time() + timeout
    last: dict[int, list[dict[str, Any]]] = {}
    while time.time() < deadline:
        for pid in pids:
            windows = normal_windows(app_name, pid, driver)
            last[pid] = windows
            if windows:
                return pid, windows[0]
        time.sleep(0.5)
    raise RuntimeError(f"no normal {app_name} window for pids {pids}; last={last}")


def tab_control_count(root: int, window_id: int, driver: str) -> int:
    try:
        state = cua("get_window_state", {"capture_mode": "ax", "pid": root, "window_id": window_id}, driver)
    except Exception:
        return -1
    tree = state.get("tree_markdown", "")
    return tree.count("AXRadioButton (")

def wait_for_roots_gone(browser: str, helium_profile: str, chrome_profile: str, timeout: float = 20) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not browser_roots(browser, helium_profile, chrome_profile):
            return
        time.sleep(0.5)
    raise RuntimeError(f"{browser} roots are still running after restart request: {browser_roots(browser, helium_profile, chrome_profile)}")


def restart_default_chrome(args: argparse.Namespace) -> None:
    roots = browser_roots("chrome", args.helium_profile, "")
    for root in roots:
        cua_no_json("kill_app", {"pid": root}, args.cua_driver)
    if roots:
        wait_for_roots_gone("chrome", args.helium_profile, "", timeout=30)


def open_urls_with_cua_hotkeys(root: int, window_id: int, urls: list[str], driver: str, delay: float) -> None:
    for index, url in enumerate(urls):
        if index == 0:
            cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["cmd", "l"]}, driver)
        else:
            cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["cmd", "t"]}, driver)
        time.sleep(0.15)
        cua_no_json("type_text", {"pid": root, "window_id": window_id, "text": url, "delay_ms": 0}, driver)
        cua_no_json("press_key", {"pid": root, "window_id": window_id, "key": "return"}, driver)
        time.sleep(delay)

def cdp_base(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def wait_for_cdp(port: int, timeout: float = 20) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            version = read_http_json(f"{cdp_base(port)}/json/version", timeout=2)
            if isinstance(version, dict):
                return version
        except Exception as error:
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"CDP did not become ready on port {port}: {last_error!r}")


def cdp_new_tab(port: int, url: str) -> dict[str, Any]:
    endpoint = f"{cdp_base(port)}/json/new?{parse.quote(url, safe='')}"
    try:
        tab = read_http_json(endpoint, timeout=15, method="PUT")
    except error.HTTPError as http_error:
        if http_error.code != 405:
            raise
        tab = read_http_json(endpoint, timeout=15)
    if not isinstance(tab, dict):
        raise RuntimeError(f"CDP new tab returned non-object for {url}: {tab!r}")
    return tab


def cdp_activate_tab(port: int, target_id: str) -> None:
    read_http_text(f"{cdp_base(port)}/json/activate/{target_id}", timeout=10)


def cdp_close_tab(port: int, target_id: str) -> None:
    try:
        read_http_text(f"{cdp_base(port)}/json/close/{target_id}", timeout=10)
    except error.HTTPError as http_error:
        if http_error.code not in {404, 500}:
            raise


def open_urls_with_cdp(port: int, urls: list[str], delay: float) -> list[str]:
    target_ids: list[str] = []
    wait_for_cdp(port)
    for url in urls:
        tab = cdp_new_tab(port, url)
        target_id = str(tab.get("id", ""))
        if not target_id:
            raise RuntimeError(f"CDP new tab did not return an id for {url}: {tab!r}")
        target_ids.append(target_id)
        cdp_activate_tab(port, target_id)
        time.sleep(delay)
    return target_ids


def launch_browser(browser: str, urls: list[str], args: argparse.Namespace) -> dict[str, Any]:
    if args.tab_control == "hotkeys" and not args.allow_cua_hotkeys:
        raise RuntimeError("--tab-control=hotkeys requires --allow-cua-hotkeys")

    if browser == "chrome":
        port = args.chrome_cdp_port
        payload: dict[str, Any] = {"bundle_id": CHROME_BUNDLE}
        if args.tab_control == "cdp":
            payload["electron_debugging_port"] = port
            payload["additional_arguments"] = ["--no-first-run"]
            if args.chrome_profile:
                payload["additional_arguments"].append(f"--user-data-dir={args.chrome_profile}")
                payload["creates_new_application_instance"] = True
            elif not args.restart_default_chrome:
                raise RuntimeError("Chrome CDP mode needs --chrome-profile, or --restart-default-chrome to relaunch the default profile with DevTools")
        elif args.tab_control == "launch":
            payload["urls"] = urls
        launched = cua("launch_app", payload, args.cua_driver)
        root = int(launched["pid"])
        time.sleep(1)
        roots = browser_roots("chrome", args.helium_profile, args.chrome_profile)
        if root not in roots:
            roots.append(root)
        cdp_target_ids: list[str] = []
        if args.tab_control == "cdp":
            cdp_target_ids = open_urls_with_cdp(port, urls, args.open_delay)
            time.sleep(1)
        root, window = wait_for_any_window(CHROME_APP_NAME, roots, args.cua_driver)
        window_id = int(window["window_id"])
        if args.tab_control == "hotkeys":
            cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["cmd", "n"]}, args.cua_driver)
            time.sleep(1)
            root, window = wait_for_any_window(CHROME_APP_NAME, roots, args.cua_driver)
            window_id = int(window["window_id"])
            open_urls_with_cua_hotkeys(root, window_id, urls, args.cua_driver, args.open_delay)
            time.sleep(2)
            window = wait_for_window(CHROME_APP_NAME, root, args.cua_driver)
            window_id = int(window["window_id"])
        return {
            "roots": roots,
            "root": root,
            "window_id": window_id,
            "tab_controls": tab_control_count(root, window_id, args.cua_driver),
            "self_activation_suppressed": bool(launched.get("self_activation_suppressed", True)),
            "cdp_port": port if args.tab_control == "cdp" else None,
            "cdp_target_ids": cdp_target_ids,
            "owns_process": bool(args.chrome_profile),
        }

    if browser == "helium":
        port = args.helium_cdp_port
        payload = {
            "additional_arguments": [
                f"--user-data-dir={args.helium_profile}",
                "--no-first-run",
            ],
            "bundle_id": HELIUM_BUNDLE,
            "creates_new_application_instance": True,
        }
        if args.tab_control == "cdp":
            payload["electron_debugging_port"] = port
        elif args.tab_control == "launch":
            payload["urls"] = urls
        launched = cua("launch_app", payload, args.cua_driver)
        launched_root = int(launched["pid"])
        time.sleep(2)
        roots = browser_roots("helium", args.helium_profile, args.chrome_profile)
        if not roots:
            raise RuntimeError(f"launched Helium but did not find target profile root: {args.helium_profile}; launched pid={launched_root}")
        root = roots[0]
        cdp_target_ids = []
        if args.tab_control == "cdp":
            cdp_target_ids = open_urls_with_cdp(port, urls, args.open_delay)
            time.sleep(1)
        root, window = wait_for_any_window(HELIUM_APP_NAME, roots, args.cua_driver)
        window_id = int(window["window_id"])
        if args.tab_control == "hotkeys":
            cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["cmd", "n"]}, args.cua_driver)
            time.sleep(1)
            root, window = wait_for_any_window(HELIUM_APP_NAME, roots, args.cua_driver)
            window_id = int(window["window_id"])
            open_urls_with_cua_hotkeys(root, window_id, urls, args.cua_driver, args.open_delay)
            time.sleep(2)
            window = wait_for_window(HELIUM_APP_NAME, root, args.cua_driver)
            window_id = int(window["window_id"])
        return {
            "roots": roots,
            "root": root,
            "window_id": window_id,
            "tab_controls": tab_control_count(root, window_id, args.cua_driver),
            "self_activation_suppressed": bool(launched.get("self_activation_suppressed", True)),
            "cdp_port": port if args.tab_control == "cdp" else None,
            "cdp_target_ids": cdp_target_ids,
            "owns_process": True,
        }

    raise ValueError(browser)


def activate_tabs(root: int, window_id: int, tab_count: int, driver: str, delay: float, snapshots: bool) -> None:
    for index in range(tab_count + 2):
        cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["ctrl", "tab"]}, driver)
        if snapshots and (index == 0 or index % 10 == 0 or index == tab_count + 1):
            try:
                cua("get_window_state", {"capture_mode": "ax", "pid": root, "window_id": window_id}, driver)
            except Exception as error:  # Cua screenshots can fail on transient window changes.
                print(f"snapshot_warning={error!r}", file=sys.stderr)
        time.sleep(delay)


def close_window(root: int, window_id: int, driver: str) -> None:
    cua_no_json("hotkey", {"pid": root, "window_id": window_id, "keys": ["cmd", "shift", "w"]}, driver)


def benchmark(browser: str, urls: list[str], args: argparse.Namespace) -> dict[str, Any]:
    if browser == "firefox":
        loaded = summarize_roots(browser_roots("firefox", args.helium_profile, args.chrome_profile))
        return {
            "browser": browser,
            "tab_count": len(urls),
            "current": loaded,
            "measurement": "current Firefox process tree; no launch or tab activation performed",
        }

    if browser == "chrome" and args.restart_default_chrome:
        restart_default_chrome(args)
    roots_before = browser_roots(browser, args.helium_profile, args.chrome_profile)
    baseline = summarize_roots(roots_before)
    launch = launch_browser(browser, urls, args)
    roots_after_launch = launch["roots"]
    root = launch["root"]
    window_id = launch["window_id"]
    after_launch = summarize_roots(roots_after_launch)
    if args.tab_control == "hotkeys":
        activate_tabs(root, window_id, len(urls), args.cua_driver, args.activation_delay, args.cua_snapshots)
    time.sleep(args.settle_seconds)
    roots_after_load = browser_roots(browser, args.helium_profile, args.chrome_profile)
    loaded = summarize_roots(roots_after_load)
    if not args.keep_windows:
        if args.tab_control == "cdp":
            port = launch["cdp_port"]
            for target_id in reversed(launch["cdp_target_ids"]):
                cdp_close_tab(int(port), target_id)
        elif args.tab_control == "hotkeys":
            close_window(root, window_id, args.cua_driver)
        if launch["owns_process"]:
            try:
                os.kill(root, signal.SIGTERM)
            except ProcessLookupError:
                pass
        time.sleep(2)
    return {
        "browser": browser,
        "tab_count": len(urls),
        "root_pid_used_for_cua": root,
        "window_id_used_for_cua": window_id,
        "baseline": baseline,
        "after_launch": after_launch,
        "after_tab_activation": loaded,
        "cua_tab_controls_after_launch": launch["tab_controls"],
        "cua_self_activation_suppressed": launch["self_activation_suppressed"],
        "tab_control": args.tab_control,
        "cdp_port": launch["cdp_port"],
        "cdp_targets_opened": len(launch["cdp_target_ids"]),
        "window_left_open": bool(args.keep_windows),
        "delta_loaded_minus_baseline": {
            "processes": loaded["processes"] - baseline["processes"],
            "cpu_percent": round(loaded["cpu_percent"] - baseline["cpu_percent"], 1),
            "rss_mb": round(loaded["rss_mb"] - baseline["rss_mb"], 1),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firefox-recovery", default=FIREFOX_RECOVERY)
    parser.add_argument("--cua-driver", default=CUA_DRIVER)
    parser.add_argument("--helium-profile", default=DEFAULT_HELIUM_PROFILE)
    parser.add_argument("--chrome-profile", default="", help="dedicated Chrome user-data-dir for CDP mode; must already be logged in for authenticated X")
    parser.add_argument("--restart-default-chrome", action="store_true", help="kill the normal default-profile Chrome root, relaunch it with a DevTools port, and leave it running")
    parser.add_argument("--order", default="helium", help="comma-separated: helium,chrome,firefox")
    parser.add_argument("--limit", type=int, default=0, help="limit X URLs for smoke testing")
    parser.add_argument("--tab-control", choices=["cdp", "launch", "hotkeys"], default="cdp")
    parser.add_argument("--helium-cdp-port", type=int, default=9347)
    parser.add_argument("--chrome-cdp-port", type=int, default=9348)
    parser.add_argument("--activation-delay", type=float, default=1.0)
    parser.add_argument("--settle-seconds", type=float, default=30.0)
    parser.add_argument("--keep-windows", action="store_true")
    parser.add_argument("--cua-snapshots", action="store_true", help="capture AX snapshots during intrusive hotkey activation")
    parser.add_argument("--allow-cua-hotkeys", action="store_true", help="allow intrusive browser hotkeys for fallback tab activation")
    parser.add_argument("--output", default="")
    parser.add_argument("--open-delay", type=float, default=0.35, help="delay after opening/activating each URL")
    args = parser.parse_args()

    urls = firefox_x_urls(Path(args.firefox_recovery))
    if args.limit > 0:
        urls = urls[:args.limit]
    if not urls:
        raise SystemExit("no X/Twitter URLs found in Firefox recovery")

    result: dict[str, Any] = {
        "source": str(args.firefox_recovery),
        "url_count": len(urls),
        "hosts": Counter(urlparse(url).netloc for url in urls),
        "order": [item.strip() for item in args.order.split(",") if item.strip()],
        "tab_control": args.tab_control,
        "used_cua_driver": args.cua_driver,
        "results": [],
    }
    result["hosts"] = dict(result["hosts"])

    for browser in result["order"]:
        if browser not in {"chrome", "helium", "firefox"}:
            raise SystemExit(f"unsupported browser in --order: {browser}")
        result["results"].append(benchmark(browser, urls, args))
        time.sleep(5)

    rendered = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).write_text(rendered + "\n")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
