from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pydantic import ValidationError

from .models import validate_alignment_file, validation_error_text


def build_align_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="shadow-align",
        description="Create or validate Mandarin character-aligned shadowing JSON.",
        epilog="Use `shadow-align validate <json>` to validate an existing alignment file.",
    )
    parser.add_argument("media", type=Path, help="input wav/mp3/mp4/m4a media")
    parser.add_argument("-o", "--output", type=Path, required=True, help="output alignment JSON path")
    parser.add_argument(
        "--engine",
        default="whisper",
        help="ASR engine: whisper (working fallback), whisper-large-v3, or fireredasr2s (documents unavailable)",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="also copy media and alignment.json to data/primer/shadowing/<media-stem>/",
    )
    return parser


def build_validate_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="shadow-align validate",
        description="Validate an existing alignment JSON file.",
    )
    parser.add_argument("json_path", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if args_list and args_list[0] == "validate":
        vargs = build_validate_parser().parse_args(args_list[1:])
        return run_validate(vargs.json_path)
    args = build_align_parser().parse_args(args_list)
    return run_align(args)


def run_validate(json_path: Path) -> int:

    try:
        alignment = validate_alignment_file(json_path)
    except ValidationError as exc:
        print(validation_error_text(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"failed to validate {json_path}: {exc}", file=sys.stderr)
        return 1
    print(
        f"valid alignment JSON: {json_path} "
        f"({len(alignment.sentences)} sentences, asr={alignment.media.asr})"
    )
    return 0


def run_align(args: argparse.Namespace) -> int:

    from .aligner import EngineUnavailable, align_media

    try:
        alignment = align_media(
            args.media,
            args.output,
            engine=args.engine,
            publish=args.publish,
        )
    except EngineUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"shadow-align failed: {exc}", file=sys.stderr)
        return 1

    texts = " / ".join(sentence.text for sentence in alignment.sentences)
    print(
        f"wrote {args.output} ({len(alignment.sentences)} sentences, "
        f"asr={alignment.media.asr}, text={texts})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
