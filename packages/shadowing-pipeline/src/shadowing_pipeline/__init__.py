"""Mandarin shadowing alignment pipeline."""

__all__ = ["AlignmentV1", "align_media", "validate_alignment_file"]


def __getattr__(name: str):
    if name == "align_media":
        from .aligner import align_media

        return align_media
    if name in {"AlignmentV1", "validate_alignment_file"}:
        from .models import AlignmentV1, validate_alignment_file

        return {"AlignmentV1": AlignmentV1, "validate_alignment_file": validate_alignment_file}[name]
    raise AttributeError(name)
