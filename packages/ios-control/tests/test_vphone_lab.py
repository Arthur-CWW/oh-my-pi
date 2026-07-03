from __future__ import annotations

import base64
import datetime as dt
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "vphone_lab.py"


def load_module(name: str = "vphone_lab_under_test"):
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeClient:
    socket_path = "/tmp/fake-vphone.sock"

    def __init__(self):
        self.requests = []

    def send(self, request):
        self.requests.append(request)
        if request["t"] == "screenshot":
            return {"ok": True, "png_b64": base64.b64encode(b"fake-png").decode("ascii")}
        return {"ok": True}


class MaxRandom:
    def randint(self, low, high):
        return high


class VPhoneLabTests(unittest.TestCase):
    def test_import_has_no_wda_or_pil_dependency(self):
        forbidden_roots = {"wda", "PIL", "Pillow"}
        original_import = __import__

        def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name.split(".", 1)[0] in forbidden_roots:
                raise AssertionError(f"unexpected dependency import: {name}")
            return original_import(name, globals, locals, fromlist, level)

        with mock.patch("builtins.__import__", side_effect=guarded_import):
            module = load_module("vphone_lab_no_external_imports")

        previous = sys.modules.pop("vphone_lab", None)
        original_path = list(sys.path)
        try:
            sys.path.insert(0, str(ROOT / "src"))
            with mock.patch("builtins.__import__", side_effect=guarded_import):
                top_level_module = __import__("vphone_lab")
        finally:
            sys.path[:] = original_path
            if previous is not None:
                sys.modules["vphone_lab"] = previous
            else:
                sys.modules.pop("vphone_lab", None)

        self.assertIn("none", module.PROFILES)
        self.assertIn("none", top_level_module.PROFILES)

    def test_runner_executes_actions_and_writes_controlled_manifest(self):
        module = load_module("vphone_lab_manifest_test")
        client = FakeClient()
        sleeps = []
        now = lambda: dt.datetime(2026, 6, 24, 12, 0, tzinfo=dt.timezone.utc)
        actions = [
            {"action": "tap", "x": 10, "y": 20},
            {"action": "swipe", "from": [1, 2], "to": [30, 40], "duration_ms": 250},
            {"action": "key", "key": "home"},
            {"action": "screenshot"},
            {"action": "wait", "seconds": 0.5},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            runner = module.VPhoneLabRunner(
                client,
                tmp,
                profile="none",
                sleeper=sleeps.append,
                run_id="run-1",
                now=now,
            )
            result = runner.run(actions)
            manifest_text = result.manifest_path.read_text(encoding="utf-8")
            screenshot_path = pathlib.Path(result.manifest["actions"][3]["screenshot_path"])

            self.assertEqual(
                client.requests,
                [
                    {"t": "tap", "x": 10, "y": 20},
                    {"t": "swipe", "x1": 1, "y1": 2, "x2": 30, "y2": 40, "duration_ms": 250},
                    {"t": "key", "key": "home"},
                    {"t": "screenshot"},
                ],
            )
            self.assertTrue(result.manifest_path.name.startswith("vphone-lab-manifest-run-1"))
            self.assertIn(module.CONTROLLED_MEASUREMENT_LABEL, manifest_text)
            self.assertIn("not stealth", result.manifest["safety_notice"])
            self.assertEqual(result.manifest["summary"], {"total": 5, "sent": 4, "failed": 0, "screenshots": 1})
            self.assertEqual(sleeps, [0.5])
            self.assertEqual(screenshot_path.read_bytes(), b"fake-png")

    def test_profile_applies_delay_and_coordinate_jitter(self):
        module = load_module("vphone_lab_profile_test")
        client = FakeClient()
        sleeps = []
        profile = module.DelayProfile(name="unit", delay_ms=(10, 20), coordinate_jitter_px=2)

        with tempfile.TemporaryDirectory() as tmp:
            runner = module.VPhoneLabRunner(
                client,
                tmp,
                profile=profile,
                sleeper=sleeps.append,
                rng=MaxRandom(),
                run_id="run-2",
            )
            result = runner.run([{"action": "tap", "x": 100, "y": 200}])

        self.assertEqual(client.requests, [{"t": "tap", "x": 102, "y": 202}])
        self.assertEqual(sleeps, [0.02])
        self.assertEqual(result.manifest["actions"][0]["delay_seconds"], 0.02)
        self.assertEqual(result.manifest["profile"]["coordinate_jitter_px"], 2)

    def test_jsonl_loader_accepts_comments_and_protocol_t_field(self):
        module = load_module("vphone_lab_jsonl_test")
        with tempfile.TemporaryDirectory() as tmp:
            script = pathlib.Path(tmp) / "actions.jsonl"
            script.write_text(
                "# controlled local lab script\n"
                "\n"
                '{"t":"tap","x":1,"y":2}\n'
                '{"action":"capture"}\n',
                encoding="utf-8",
            )
            actions = module.load_jsonl_actions(script)
            client = FakeClient()
            result = module.VPhoneLabRunner(client, tmp, run_id="run-3").run(actions)

        self.assertEqual([action["_line"] for action in actions], [3, 4])
        self.assertEqual(client.requests[0], {"t": "tap", "x": 1, "y": 2})
        self.assertEqual(client.requests[1], {"t": "screenshot"})
        self.assertEqual(result.manifest["summary"]["sent"], 2)

    def test_invalid_action_is_recorded_as_failed_without_sending(self):
        module = load_module("vphone_lab_failure_test")
        client = FakeClient()
        with tempfile.TemporaryDirectory() as tmp:
            result = module.VPhoneLabRunner(client, tmp, run_id="run-4").run(
                [{"action": "launch_app", "bundle_id": "example"}]
            )

        self.assertEqual(client.requests, [])
        self.assertEqual(result.manifest["summary"]["failed"], 1)
        self.assertIn("Unsupported action", result.manifest["actions"][0]["error"])


if __name__ == "__main__":
    unittest.main()
