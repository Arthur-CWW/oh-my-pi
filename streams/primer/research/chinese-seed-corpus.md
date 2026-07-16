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

Created via `POST https://primer.localhost/api/reader/docs` with `{title, text, lang: "zh"}`:

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
## Video corpus (entertainment × acquisition)

This lane pairs low-friction listening with high-interest long-form input. `T1` is comprehensible, repeatable entertainment; `T3–T4` is authentic drama with denser dialogue, historical register, and proper nouns. Subtitle availability is a gating signal: the alignment pipeline should ingest caption files, not guessed transcripts.

### Liang Wenfeng / DeepSeek interview set

The two canonical 暗涌/36氪 interviews are archived as full cleaned public-page text with provenance in `streams/primer/feedstock/zh-corpus/`:

| Reader IDs | Title | Tier | Han chars (reader part) | Canonical public source |
| ---: | --- | --- | ---: | --- |
| 20–22 | `梁文锋 · 暗涌访谈 2023 · 上/中/下` | T2/T3 bridge | 1,388 / 1,314 / 1,564 | [36氪《疯狂的幻方：一家隐形AI巨头的大模型之路》](https://www.36kr.com/p/2272896094586500) |
| 23–25 | `梁文锋 · 暗涌访谈 2024 · 上/中/下` | T2/T3 bridge | 1,725 / 1,609 / 1,809 | [36氪《揭秘DeepSeek：一个更极致的中国技术理想主义故事》（用户所称“DeepSeek的秘密”标题变体）](https://www.36kr.com/p/2872793466982535) |

The reader parts contain the interview dialogue (each 800–2,500 Han characters); the archives retain the full surrounding article context. 2023 archive: `liang-wenfeng-2023-fangfang.md`; 2024 archive: `liang-wenfeng-2024-deepseek.md`. Corroborating full-text republications are [暗涌Waves](https://awtmt.com/articles/3689518), [新浪 2023](https://finance.sina.com.cn/money/smjj/smdt/2023-05-24/doc-imyuxyfk2522975.shtml), and [新浪 2025 reprint/context](https://finance.sina.com.cn/tech/2025-01-26/doc-inehhksk9178057.shtml).

A recent public check found a qualifying 2025 profile/interview, [南方人物周刊《梁文锋：俯身做真正的创新｜2025青年力量》](https://www.nfpeople.com/index.php/article/13531) (2025-05-24; public mirror [南方+](https://static.nfnews.com/content/202505/24/c11327343.html)). The mirror exposes the introduction and selected interview excerpts but says the remaining 80% requires subscription, so it is retained as a follow-up source lead rather than a seeded reader document. No additional direct 2026 interview/essay was located in the public search.

### Drama identification verdict

**High-confidence verdict: 《庆余年》 (Joy of Life), ~0.8.** Tencent’s synopsis describes university literature-history student 张庆, who reads classical works and writes a novel; the novel premise is a modern young patient whose soul enters a different world as 范闲. That combines Arthur’s “history/classics student” memory with the remembered transport and knowledge advantage. The title/sound memory may be blended with **《琅琊榜》** (“Langya Bang”), whose name is phonologically close to “lanyang wang” but whose protagonist 梅长苏 is 林殊 in disguise, not a modern isekai.

| Candidate | Novel origin / protagonist | Isekai mechanic | Fit |
| --- | --- | --- | --- |
| **庆余年** | [Tencent synopsis](https://v.qq.com/x/cover/rjae621myqca41h/c0033527yjb.html); 猫腻 webnovel; modern 范慎, a terminally ill patient, becomes 范闲 | Soul transmigration/reincarnation; TV frames it through 张庆’s novel | **High** |
| **琅琊榜** | [iQIYI adaptation page](https://www.iqiyi.com/a_19rrhc0u75.html); 海宴 webnovel; 梅长苏 is 林殊 after the 梅岭 massacre | None; identity change and political revenge, no modern history student | Very low (sound-only confusion) |
| **赘婿** | [iQIYI adaptation page](https://www.iqiyi.com/a_2953dimfr0l.html); 愤怒的香蕉 webnovel; modern finance/business man 宁毅 | Transmigration/parallel-soul framing into an ancient son-in-law | Medium-low (wrong academic background) |
| **大奉打更人** | [Tencent synopsis](https://v.qq.com/x/cover/mzc00200qon7vo3/n4100haur7s.html); 卖报小郎君 webnovel; modern worker 杨凌 / 许七安 | Modern man enters 大奉王朝 and uses science/reasoning | Medium (newer, not a classics student) |
| **书卷一梦** | [iQIYI synopsis/trailer](https://www.iqiyi.com/v_25ulb3vvve0.html); 2025 title; novelist 宋小鱼 enters her own script | Script-world transport, not a dynasty-history student | Low |

### Entertainment → acquisition ladder and next ingest

- **T1: Peppa Pig / 小猪佩奇.** Short, repetitive episodes; ingest official captions first and use as the low-load listening/phrase-repetition rung.
- **T3–T4: 《庆余年》.** Start with the official Tencent topic page ([episode list, 全46集](https://v.qq.com/tv/p/topic/qingyunian/index.html)); an official YouTube playlist is [【FULL】庆余年 | Joy of life](https://www.youtube.com/playlist?list=PLMQ0lvZ3plNORNw9xWKYN5cS64VbqoipH). Episode count is verified. Chinese subtitles/CC are **not verified** from the public YouTube metadata and may vary by geography; Tencent playback/subtitle access is likewise account/region dependent, so do not mark this source subtitle-ready until a caption track is observed.
- **Pipeline next:** PeppaPilot locates/acquires the permitted episode/caption assets; the Primer ingest should accept the observed `zh`/`zh-Hans` caption file, preserve episode and timestamp provenance, normalize speaker/line breaks, and then produce aligned review segments. Do not substitute an unverified fan transcript or download video in this corpus-curation lane.
