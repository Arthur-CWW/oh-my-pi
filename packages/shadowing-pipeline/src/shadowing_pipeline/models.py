from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

CJK_RE = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\U00020000-\U0002a6df\uf900-\ufaff\U0002f800-\U0002fa1f]"
)


def cjk_chars(text: str) -> list[str]:
    return CJK_RE.findall(text)


class PhoneBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p: str = Field(min_length=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)

    @model_validator(mode="after")
    def end_not_before_start(self) -> PhoneBlock:
        if self.endMs < self.startMs:
            raise ValueError("phone endMs must be >= startMs")
        return self


class CharBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ch: str = Field(min_length=1)
    pinyin: str = Field(min_length=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    phones: list[PhoneBlock] | None = None

    @field_validator("ch")
    @classmethod
    def one_cjk_char(cls, value: str) -> str:
        if len(cjk_chars(value)) != 1 or len(value) != 1:
            raise ValueError("ch must be exactly one CJK character")
        return value

    @model_validator(mode="after")
    def end_not_before_start(self) -> CharBlock:
        if self.endMs < self.startMs:
            raise ValueError("char endMs must be >= startMs")
        return self


class SentenceBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idx: int = Field(ge=0)
    text: str = Field(min_length=1)
    pinyin: str = Field(min_length=1)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    chars: list[CharBlock]
    charTiming: Literal["native", "interpolated"] | None = None

    @model_validator(mode="after")
    def contract_invariants(self) -> SentenceBlock:
        if self.endMs < self.startMs:
            raise ValueError("sentence endMs must be >= startMs")

        expected = cjk_chars(self.text)
        actual = [char.ch for char in self.chars]
        if actual != expected:
            raise ValueError("chars must cover every CJK char in text in order, excluding punctuation")

        previous_start = self.startMs
        previous_end = self.startMs
        for char in self.chars:
            if char.startMs < self.startMs or char.endMs > self.endMs:
                raise ValueError("char timing must stay within the sentence span")
            if char.startMs < previous_start or char.endMs < previous_end:
                raise ValueError("char timings must be monotonic non-decreasing")
            previous_start = char.startMs
            previous_end = char.endMs
        return self


class MediaBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str = Field(min_length=1)
    durationMs: int = Field(gt=0)
    lang: Literal["zh"]
    asr: str = Field(min_length=1)


class AlignmentV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    media: MediaBlock
    sentences: list[SentenceBlock]

    @model_validator(mode="after")
    def sentence_indices_are_contiguous(self) -> AlignmentV1:
        for expected_idx, sentence in enumerate(self.sentences):
            if sentence.idx != expected_idx:
                raise ValueError("sentence idx values must be contiguous from 0")
        return self


def validate_alignment_data(data: object) -> AlignmentV1:
    return AlignmentV1.model_validate(data)


def validate_alignment_file(path: str | Path) -> AlignmentV1:
    with Path(path).open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return validate_alignment_data(data)


def validation_error_text(exc: ValidationError) -> str:
    lines = ["alignment JSON is invalid:"]
    for error in exc.errors():
        loc = ".".join(str(part) for part in error["loc"])
        lines.append(f"- {loc}: {error['msg']}")
    return "\n".join(lines)
