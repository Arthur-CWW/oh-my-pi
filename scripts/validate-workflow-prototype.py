#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "jsonschema>=4.23.0",
#   "PyYAML>=6.0.2",
# ]
# ///
"""Validate a v1alpha1 workflow recipe/run manifest and print a dry-run DAG plan.

This is intentionally a standalone prototype: it performs no provider calls, consumes no
quota, and writes no runtime artifacts. With no arguments it validates embedded sample
recipe/manifest objects against docs/schemas and prints the sample stage batches.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError


RECIPE_SCHEMA = "workflow.recipe.schema.json"
RUN_MANIFEST_SCHEMA = "workflow.run-manifest.schema.json"

EXPR_RE = re.compile(r"^\$(vars|assets|assetLibraries|prompts|outputs|stages)\.([A-Za-z][A-Za-z0-9_.-]*)$")

SAMPLE_RECIPE_YAML = """\
schemaVersion: pi.workflow/v1alpha1
kind: VideoPipelineRecipe
id: sample-talking-seal-dry-run
name: Sample Talking Seal Dry Run
metadata:
  createdBy: arthur
  tags: [sample, dry-run, seal]
  notes: Validates schema and DAG planning only; no providers are called.
policy:
  maxConcurrentStages: 3
  quotaMode: offline-only
  allowNetwork: false
  allowPaidGeneration: false
  stopOnRiskControl: true
vars:
  dialogue: "Automation ate the market. Labor is a fossil, anon."
  durationSec: 6
  aspectRatio: "9:16"
assets:
  seal_reference:
    kind: image
    uri: file://data/sample/seal-reference.png
    role: visual-reference
prompts:
  jimeng_visual_zh:
    language: zh-CN
    text: |
      超现实竖屏短视频，一只海豹像主持人一样面对镜头，背景有抽象数学符号和火箭图表。
      只生成画面，不要任何可读文字、字幕、标牌或水印。
stages:
  - id: generate_visual
    kind: video.generate
    provider: jimeng.dry-run
    needs: []
    input:
      prompt: $prompts.jimeng_visual_zh
      references: [$assets.seal_reference]
      durationSec: $vars.durationSec
      aspectRatio: $vars.aspectRatio
      mode: image-to-video
    output:
      video: base_video

  - id: synth_voice
    kind: audio.tts
    provider: local
    needs: []
    input:
      text: $vars.dialogue
      voice: sample-offline-voice
      format: wav
    output:
      audio: narration_wav

  - id: make_subtitles
    kind: subtitle.generate
    provider: local
    needs: []
    input:
      text: $vars.dialogue
      durationSec: $vars.durationSec
      style: bottom-brainrot-readable
    output:
      subtitles: subtitles_ass

  - id: burn_subtitles
    kind: video.ffmpeg
    provider: local
    needs: [generate_visual, synth_voice, make_subtitles]
    input:
      video: $outputs.generate_visual.video
      audio: $outputs.synth_voice.audio
      subtitles: $outputs.make_subtitles.subtitles
      outputPath: file://data/workflow-runs/sample/artifacts/final.mp4
    output:
      video: final_video
"""

SAMPLE_RUN_MANIFEST_JSON = {
    "schemaVersion": "pi.workflow.run/v1alpha1",
    "recipeId": "sample-talking-seal-dry-run",
    "runId": "2026-06-03T120000Z-sample-talking-seal-dry-run-a1b2c3",
    "startedAt": "2026-06-03T12:00:00Z",
    "finishedAt": None,
    "status": "planned",
    "recipeSha256": "0" * 64,
    "recipeSnapshotPath": "data/workflow-runs/sample/recipe.yaml",
    "stages": [
        {
            "id": "generate_visual",
            "kind": "video.generate",
            "provider": "jimeng.dry-run",
            "status": "pending",
            "needs": [],
        },
        {
            "id": "synth_voice",
            "kind": "audio.tts",
            "provider": "local",
            "status": "pending",
            "needs": [],
        },
        {
            "id": "make_subtitles",
            "kind": "subtitle.generate",
            "provider": "local",
            "status": "pending",
            "needs": [],
        },
        {
            "id": "burn_subtitles",
            "kind": "video.ffmpeg",
            "provider": "local",
            "status": "pending",
            "needs": ["generate_visual", "synth_voice", "make_subtitles"],
        },
    ],
    "artifacts": [],
    "errors": [],
}


class PrototypeError(Exception):
    """Raised for user-facing validation/planning failures."""


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_yaml_or_json(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        return json.loads(text)
    return yaml.safe_load(text)


def format_error_path(error: ValidationError) -> str:
    if not error.absolute_path:
        return "$"
    out = "$"
    for part in error.absolute_path:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += f".{part}"
    return out


def validation_error_lines(errors: list[ValidationError]) -> list[str]:
    lines: list[str] = []
    for error in errors:
        lines.append(f"  - {format_error_path(error)}: {error.message}")
    return lines


def check_schema_and_instance(schema: dict[str, Any], instance: Any, label: str) -> None:
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise PrototypeError(f"{label} schema is not a valid Draft 2020-12 schema: {exc.message}") from exc

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda err: list(err.absolute_path))
    if errors:
        rendered = "\n".join(validation_error_lines(errors))
        raise PrototypeError(f"{label} instance does not conform to schema:\n{rendered}")


def collect_input_refs(value: Any, path: str) -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    if isinstance(value, str):
        if value.startswith("$"):
            refs.append((path, value))
    elif isinstance(value, list):
        for idx, item in enumerate(value):
            refs.extend(collect_input_refs(item, f"{path}[{idx}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            refs.extend(collect_input_refs(item, f"{path}.{key}"))
    return refs


def require_single_ref_part(namespace: str, rest: str, path: str) -> str:
    parts = rest.split(".")
    if len(parts) != 1:
        raise PrototypeError(f"{path}: ${namespace}.{rest} should reference exactly one key")
    return parts[0]


def validate_expression_ref(ref: str, path: str, recipe: dict[str, Any], stage_by_id: dict[str, dict[str, Any]]) -> None:
    match = EXPR_RE.match(ref)
    if not match:
        raise PrototypeError(f"{path}: unsupported expression reference {ref!r}")

    namespace, rest = match.groups()
    if namespace == "outputs":
        parts = rest.split(".")
        if len(parts) != 2:
            raise PrototypeError(f"{path}: {ref} should look like $outputs.<stage-id>.<output-name>")
        producer_id, output_name = parts
        producer = stage_by_id.get(producer_id)
        if producer is None:
            raise PrototypeError(f"{path}: {ref} references unknown stage {producer_id!r}")
        if output_name not in producer.get("output", {}):
            known = ", ".join(sorted(producer.get("output", {}).keys())) or "none"
            raise PrototypeError(f"{path}: {ref} references unknown output {output_name!r}; known outputs: {known}")
        return

    if namespace == "stages":
        stage_id = require_single_ref_part(namespace, rest, path)
        if stage_id not in stage_by_id:
            raise PrototypeError(f"{path}: {ref} references unknown stage {stage_id!r}")
        return

    collection = recipe.get(namespace, {})
    if not isinstance(collection, dict):
        raise PrototypeError(f"{path}: recipe.{namespace} is not an object")
    key = require_single_ref_part(namespace, rest, path)
    if key not in collection:
        known = ", ".join(sorted(collection.keys())) or "none"
        raise PrototypeError(f"{path}: {ref} references unknown {namespace} key {key!r}; known keys: {known}")


def semantic_check_recipe(recipe: dict[str, Any]) -> tuple[list[list[dict[str, Any]]], list[str]]:
    stages = recipe.get("stages", [])
    stage_ids = [stage.get("id") for stage in stages]
    counts = Counter(stage_ids)
    duplicates = sorted(stage_id for stage_id, count in counts.items() if count > 1)
    if duplicates:
        raise PrototypeError(f"duplicate stage IDs: {', '.join(duplicates)}")

    stage_by_id = {stage["id"]: stage for stage in stages}

    for stage in stages:
        stage_id = stage["id"]
        for need in stage.get("needs", []):
            if need == stage_id:
                raise PrototypeError(f"stage {stage_id!r} depends on itself")
            if need not in stage_by_id:
                raise PrototypeError(f"stage {stage_id!r} needs unknown stage {need!r}")

    for stage in stages:
        stage_id = stage["id"]
        for path, ref in collect_input_refs(stage.get("input", {}), f"stages.{stage_id}.input"):
            validate_expression_ref(ref, path, recipe, stage_by_id)

    batches = topological_batches(stages, stage_by_id)
    warnings = dependency_warnings(stages, stage_by_id)
    return batches, warnings


def topological_batches(stages: list[dict[str, Any]], stage_by_id: dict[str, dict[str, Any]]) -> list[list[dict[str, Any]]]:
    emitted: set[str] = set()
    remaining = [stage["id"] for stage in stages]
    batches: list[list[dict[str, Any]]] = []

    while remaining:
        ready = [stage_id for stage_id in remaining if set(stage_by_id[stage_id].get("needs", [])).issubset(emitted)]
        if not ready:
            blocked = ", ".join(remaining)
            raise PrototypeError(f"cycle detected or unresolved dependency among stages: {blocked}")
        batches.append([stage_by_id[stage_id] for stage_id in ready])
        emitted.update(ready)
        remaining = [stage_id for stage_id in remaining if stage_id not in emitted]

    return batches


def dependency_warnings(stages: list[dict[str, Any]], stage_by_id: dict[str, dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    for stage in stages:
        stage_id = stage["id"]
        declared_needs = set(stage.get("needs", []))
        for path, ref in collect_input_refs(stage.get("input", {}), f"stages.{stage_id}.input"):
            match = EXPR_RE.match(ref)
            if not match or match.group(1) != "outputs":
                continue
            producer_id = match.group(2).split(".", 1)[0]
            if producer_id != stage_id and producer_id not in declared_needs:
                warnings.append(f"{path}: {ref} is not listed as a direct need of stage {stage_id!r}")
    return warnings


def print_plan(recipe: dict[str, Any], batches: list[list[dict[str, Any]]], warnings: list[str]) -> None:
    print(f"Recipe: {recipe['id']} — {recipe['name']}")
    print("Dry-run DAG batches:")
    for idx, batch in enumerate(batches, start=1):
        print(f"  batch {idx}:")
        for stage in batch:
            needs = stage.get("needs", [])
            needs_text = ", ".join(needs) if needs else "none"
            print(f"    - {stage['id']} ({stage['kind']} via {stage['provider']}; needs: {needs_text})")
    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f"  - {warning}")
    else:
        print("Warnings: none")
    print("Provider execution: skipped (dry-run only)")


def parse_args() -> argparse.Namespace:
    default_schema_dir = repo_root() / "docs" / "schemas"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, help="YAML/JSON recipe to validate; defaults to embedded sample")
    parser.add_argument("--manifest", type=Path, help="JSON/YAML run manifest to validate; defaults to embedded sample")
    parser.add_argument("--schema-dir", type=Path, default=default_schema_dir, help=f"schema directory (default: {default_schema_dir})")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        recipe_schema = load_json(args.schema_dir / RECIPE_SCHEMA)
        run_manifest_schema = load_json(args.schema_dir / RUN_MANIFEST_SCHEMA)
        recipe = load_yaml_or_json(args.recipe) if args.recipe else yaml.safe_load(SAMPLE_RECIPE_YAML)
        manifest = load_yaml_or_json(args.manifest) if args.manifest else SAMPLE_RUN_MANIFEST_JSON

        check_schema_and_instance(recipe_schema, recipe, "recipe")
        print("✓ recipe schema is valid and recipe instance conforms")
        check_schema_and_instance(run_manifest_schema, manifest, "run manifest")
        print("✓ run-manifest schema is valid and manifest instance conforms")

        batches, warnings = semantic_check_recipe(recipe)
        print("✓ recipe semantic checks passed")
        print()
        print_plan(recipe, batches, warnings)
    except (OSError, json.JSONDecodeError, yaml.YAMLError, PrototypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
