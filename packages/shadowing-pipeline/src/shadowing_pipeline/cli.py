from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path



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


def build_batch_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="shadow-align batch",
        description="Align and publish each wav/mp3 file in a directory.",
    )
    parser.add_argument("media_dir", type=Path, help="directory containing wav/mp3 media files")
    parser.add_argument("--limit", type=_positive_int, help="maximum number of files to align")
    parser.add_argument(
        "--publish-root",
        type=Path,
        default=Path("data") / "primer" / "shadowing",
        help="root directory for <media-stem>/alignment.json and copied media",
    )
    parser.add_argument(
        "--engine",
        default="whisper",
        help="ASR engine: whisper (working fallback), whisper-large-v3, or fireredasr2s (documents unavailable)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if args_list and args_list[0] == "validate":
        vargs = build_validate_parser().parse_args(args_list[1:])
        return run_validate(vargs.json_path)
    if args_list and args_list[0] == "batch":
        bargs = build_batch_parser().parse_args(args_list[1:])
        return run_batch(bargs)
    args = build_align_parser().parse_args(args_list)
    return run_align(args)


def run_validate(json_path: Path) -> int:
    from pydantic import ValidationError

    from .models import validate_alignment_file, validation_error_text

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


def run_batch(args: argparse.Namespace) -> int:
    from .aligner import EngineUnavailable, align_media

    media_dir = args.media_dir.expanduser().resolve()
    publish_root = args.publish_root.expanduser().resolve()
    if not media_dir.is_dir():
        print(f"batch media directory not found: {media_dir}", file=sys.stderr)
        return 1

    aligned = 0
    skipped = 0
    failed = 0
    attempted = 0
    for media in _batch_media_files(media_dir):
        publish_dir = publish_root / media.stem
        output_path = publish_dir / "alignment.json"
        if _is_published(publish_dir):
            skipped += 1
            print(f"skipped {media.name}: already published")
            continue

        if args.limit is not None and attempted >= args.limit:
            break
        attempted += 1

        try:
            publish_dir.mkdir(parents=True, exist_ok=True)
            alignment = align_media(media, output_path, engine=args.engine, publish=False)
            shutil.copy2(media, publish_dir / media.name)
        except EngineUnavailable as exc:
            failed += 1
            print(f"failed {media.name}: {exc}", file=sys.stderr)
            continue
        except Exception as exc:
            failed += 1
            print(f"failed {media.name}: {exc}", file=sys.stderr)
            continue

        aligned += 1
        texts = " / ".join(sentence.text for sentence in alignment.sentences)
        print(f"aligned {media.name}: {len(alignment.sentences)} sentences, text={texts}")

    print(f"batch summary: aligned={aligned} skipped={skipped} failed={failed}")
    return 1 if failed else 0


def _batch_media_files(media_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in media_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".mp3", ".wav"}
    )


def _is_published(publish_dir: Path) -> bool:
    if not (publish_dir / "alignment.json").is_file():
        return False
    return any(
        path.is_file() and path.suffix.lower() in {".mp3", ".wav"}
        for path in publish_dir.iterdir()
    )


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be a positive integer") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("--limit must be a positive integer")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())
