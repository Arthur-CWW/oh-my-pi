# Chinese seed corpus inventory

## Survey

- `streams/primer/repos/hsk-deck/complete-hsk-vocabulary/wordlists/exclusive/new/{1..5}.json` is the local HSK vocabulary reference. The union contains 4,240 unique simplified entries. The deck's `mando_sentences.md` is a 1,055-line sentence-by-sentence drill corpus, and `streams/primer/hsk-cards/gen-2026-07-06/hsk5-*.json` contains 360 generated HSK5 card records. These are useful enrichment sources, but they are not continuous reading prose.
- `streams/primer/repos/ultimate-chinese/UltimateChinese/deck.json` contains 8,405 character notes, 7,683 vocabulary notes, and 71 sentence notes. The sentence notes are short Xefjord/example sentences (mostly one sentence per note), so I did not use them as chapter-like reader documents.
- `streams/primer/feedstock/` contains no Chinese prose corpus: the named collection directories are empty in this checkout; the one populated transcript is English.
- `local/` has no separate Chinese narrative corpus. It does contain the locally installed/open-source Chinese translation of Rust By Example at `local/proofs/omp-rollout/home/.rustup/toolchains/nightly-2026-04-29-aarch64-apple-darwin/share/doc/rust/html/rust-by-example/zh/print.html`. Its visible translated sections are authored explanatory prose rather than generated sentence drills. The full print page contains about 51k Han characters, plus code and comments.
- The larger `streams/primer/wrapped-commentary-reader/artifacts/library/` collection includes `analects-chapters.md`, `xunzi-chapters.md`, `han-feizi-chapters.md`, and `art-of-war-lord-shang-chapters.md`, but those chapter files are primarily English translations. The associated reader IRs/annotation batches contain isolated Chinese originals or claims, not a continuous modern-Chinese corpus. They remain future enrichment candidates if a Chinese source edition is added through an approved/public-domain path; I did not copy book text into the reader.

## Coverage method

I treated the union of the new-HSK exclusive level 1–5 lists as Arthur's known vocabulary. For each candidate, I removed punctuation and Latin/code-only text from the denominator, split contiguous Han-character runs, then greedily matched the longest HSK entry at each position. An unmatched character counts as one unknown segment. This is intentionally a rough proxy (not a full Chinese tokenizer): it does not account for proper names, senses, or words that a human reader may know outside the list. Character coverage is included as a sanity check, but the segment coverage is the selection metric.

| Candidate | Source part | Han chars | Segments | HSK1–5 known segments | Estimated known-token coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| `Rust By Example · 错误处理` | Rust By Example, error-handling overview and panic discussion | 458 | 320 | 292 | **91.2%** |
| `Rust By Example · 迭代器` | Rust By Example, iterator and `impl Trait` discussion | 504 | 360 | 318 | **88.3%** |
| `Rust By Example · 文件 I/O` | Rust By Example, file access and buffered line-reading discussion | 560 | 400 | 350 | **87.5%** |

All three are 300–1,500 Han characters and fall inside the 85–95% comprehensible-input target band. The content is technical rather than narrative because the local authored Chinese inventory did not contain a suitable modern story/chapter; these are the closest real continuous prose candidates available without downloading copyrighted books or manufacturing a story from sentence drills.

## Seeded documents

Created via `POST http://primer.localhost:1355/api/reader/docs` with `{title, text, lang: "zh"}`:

| ID | Title | Paragraphs | Verified |
| ---: | --- | ---: | --- |
| 1 | `Rust By Example · 错误处理` | 8 | `GET /api/reader/docs/1` → 200 |
| 2 | `Rust By Example · 迭代器` | 17 | `GET /api/reader/docs/2` → 200 |
| 3 | `Rust By Example · 文件 I/O` | 21 | `GET /api/reader/docs/3` → 200 |

A final `GET /api/reader/docs` returned exactly these three documents (IDs 3, 2, 1 in newest-first order), each with `lang: "zh"` and `markCount: 0`.

## 2026-07-15 authentic corpus (Arthur's request: Mao/Xi, folk tales, classical targets)

Arthur's verdict on the Rust docs: "kind of boring, and not in a good way" — replaced as primary material (Rust docs retained for triage). 12 docs seeded from archived originals in `streams/primer/feedstock/zh-corpus/` (provenance headers: url, fetch date, license). Curator agent hit its request budget after archiving; doc 19 was seeded from its archive by the orchestrator.

| ID | Title | Tier | Source |
| ---: | --- | --- | --- |
| 4 | 民间故事 · 白蛇传 | T1 folk | wikisource/folk retelling |
| 5 | 民间故事 · 孟姜女 | T1 folk | wikisource/folk retelling |
| 6 | 民间故事 · 牛郎织女 | T1 folk | wikisource/folk retelling |
| 7 | 韩非子 · 说难 (target) | T3 classical | zh.wikisource.org |
| 8 | 论语 · 为政第二 (target) | T3 classical | zh.wikisource.org |
| 9 | 论语 · 学而第一 (target) | T3 classical | zh.wikisource.org |
| 10 | 毛主席语录 · 一 共产党 | T2 political | marxists.org zh |
| 11 | 毛主席语录 · 二 阶级和阶级斗争 | T2 political | marxists.org zh |
| 12 | 毛主席语录 · 八 人民战争 | T2 political | marxists.org zh |
| 13 | 毛主席语录 · 三 为人民服务 | T2 political | marxists.org zh |
| 14 | 习近平 · 2024新年贺词 | T2 political | gov.cn/新华 transcript |
| 19 | 习近平 · 2025新年贺词 | T2 political | gov.cn/新华 transcript |

HSK coverage estimates are only meaningful for T1/T2 (modern register); classical texts (T3) are a different register entirely and marked "(target)" — the north-star texts Arthur wants to eventually read in the original, not comprehensible-input material today.
