# Recoveries from VISION.md §Open recoveries

## 1. Better ASR model — Cantonese-capable speech recognition

**FOUND: FireRedASR2S / FireRedTeam/FireRedASR2S — confidence HIGH.**

- Browser substrate is the decisive evidence. `/Users/arthur/state/browser-context/browser_context.sqlite`, `events` rowid `206813` and `207123`, observed `2026-07-06T14:44:06.332`, URL `https://github.com/FireRedTeam/FireRedASR2S`, title: “FireRedTeam/FireRedASR2S: A SOTA Industrial-Grade All-in-One ASR system with ASR, VAD, LID, and Punc modules. FireRedASR2 supports Chinese (Mandarin, 20+ dialects/accents), English, code-switching, and both speech and singing ASR…”
- Arthur/Pleometric usage evidence: same sqlite, `events` rowid `206792`/`207102`, observed `2026-07-06T14:43:37.824`, URL `https://x.com/pleometric/status/2073920351541588446`, title quote: “I made a shadowing tool to help me work on my pronunciation, it extracts character wise subtitles using FireRedASR2S…”
- Supporting saved clipping: `streams/primer/feedstock/Clippings/ASR from Scratch I Training models of Hong Kong Cantonese using the Kaldi recipe.md`, lines 2-18: Hong Kong Cantonese ASR / forced-alignment tutorial; source `https://chenzixu.rbind.io/resources/3asr/sr3/`.
- Supporting saved clipping: `streams/primer/feedstock/Clippings/ASR from Scratch II Training models of Hong Kong Cantonese with MFA implementation.md`, lines 2-14: Hong Kong Cantonese acoustic models with MFA; source `https://chenzixu.rbind.io/resources/3asr/sr4/`.

**Candidate ranking by most recent browser event:**

1. FireRedASR2S — `events` rowid `206813`/`207123`, `2026-07-06T14:44:06.332`, `https://github.com/FireRedTeam/FireRedASR2S`.
2. No other named ASR candidate produced a comparable browser hit. `whisper` hits were unrelated “llm whisperer” tweets; `yue` produced false positives in eBay URLs; Clippings mention `Paraformer-zh` and `FunASR` only incidentally in `streams/primer/feedstock/Clippings/1 Introduction.md` lines 119 and 279, not as Arthur’s recent Cantonese-capable ASR discovery.

**NOT FOUND / searched:**

- `streams/primer/feedstock/Clippings`: filenames and content for SenseVoice, FunASR, Paraformer, Dolphin, FireRedASR, Qwen-Audio, Belle-whisper, whisper variants, Cantonese, yue, ASR, speech recognition, 粤语/粵語.
- `streams/primer/feedstock/library`: filename/content search; no direct candidate file for SenseVoice, Dolphin, Qwen-Audio, Belle-whisper. Library search showed only incidental Qwen/TTS and language-learning items.
- `streams/primer/feedstock/Zotero`: `zotero.sqlite` itemData/itemAttachments query and `storage/` content search for candidate terms; no ASR candidate item found.
- `streams/primer/feedstock/Books_Papers_Research` and `streams/primer/feedstock/papers`: filename triage for ASR candidates; no named ASR candidate beyond unrelated/false-positive filenames.
- Browser sqlite queried across `events`, `tabs`, and `tab_entries` for SenseVoice, FunASR, Paraformer, Dolphin, FireRedASR, Qwen-Audio, Belle-whisper, whisper, Cantonese, yue, ASR, speech recognition, 粤语/粵語.

## 2. Comprehensible-input / extensive-reading threshold research

**FOUND: Krashen + Nation language-acquisition sources; Hu & Nation 2000 / Laufer not found as standalone files — confidence MEDIUM-HIGH.**

- Library index evidence: `streams/primer/feedstock/library/indexes/library_index.sqlite`, table `files`:
  - id `1087`, title `krashen-optimal-input-2020`, category `Language Learning`, path `/Users/arthur/apps/hsk-deck/docs/sources/language-acquisition/krashen-optimal-input-2020.pdf`.
  - id `1088`, title `krashen-principles-and-practice`, category `Language Learning`, path `/Users/arthur/apps/hsk-deck/docs/sources/language-acquisition/krashen-principles-and-practice.pdf`.
  - id `1090`, title `nation-four-strands-2007`, category `Language Learning`, path `/Users/arthur/apps/hsk-deck/docs/sources/language-acquisition/nation-four-strands-2007.pdf`.
- Library manifest corroboration: `streams/primer/feedstock/library/book-index.md`, lines 219-221 list `krashen-principles-and-practice`, `glossing-vocabulary-meta-analysis-yanagisawa-webb-uchihara.pdf`, and `incidental-vocabulary-learning-meta-analysis-webb-2023.pdf` under language-acquisition sources.
- Clipping evidence for the practical threshold question: `streams/primer/feedstock/Clippings/Methods of Mandarin.md`, lines 456-467 quote a 95% comprehension recommendation for language learning; lines 1049-1065 discuss deliberately reading below 95%, including 70%, 80%, and “85% comprehension doesn’t sound too bad…”
- `streams/primer/feedstock/library/book-index.md`, lines 579-580 and `streams/primer/feedstock/papers/queues/read-next.md`, line 21 identify `The Eighty Five Percent Rule for optimal learning` / `Documents/papers/optimal-learning.pdf`, which is 85%-rule adjacent but not the 98% vocabulary-coverage literature.

**NOT FOUND / searched:**

- No standalone `Hu & Nation 2000` / 98% lexical coverage paper found in Clippings, library index, Zotero item metadata/storage, Books_Papers_Research filenames/content, papers filenames/content, or browser substrate.
- No standalone `Laufer` file found; the search hit in Books_Papers_Research was an unrelated author substring (`Thibodeau-Laufer`) in `streams/primer/feedstock/Books_Papers_Research/arXiv-2412.06264v1/paper.bbl` lines 194-195.
- Searched candidate anchors: Krashen, Hu and Nation, Hu & Nation, Nation, Laufer, lexical coverage, vocabulary coverage, extensive reading, comprehensible input, incidental vocabulary, 85%, 98%.

## 3. “Third author” saved alongside Matuschak and Skycak in learning/pedagogy

**FOUND: Fernando Borretti is the best fit among the named candidates — confidence HIGH for being saved; MEDIUM for being the intended “third author.” Pleometric/Arthur may also be the intended answer; see section 4.**

- Browser substrate evidence for Borretti: `/Users/arthur/state/browser-context/browser_context.sqlite`, `events` rowid `96369` and nearby repeated event rows, observed `2026-06-30T11:21:15.487`, URL `https://borretti.me/article/no-one-escapes-the-permanent-underclass`, title `No-One Escapes the Permanent Underclass`.
- Browser substrate evidence for `hashcards`: same sqlite, `events` rowid `239` and repeated rows, observed `2026-06-28T12:27:37.669`, URL `https://github.com/eudoxia0/hashcards`, title `eudoxia0/hashcards: A plain text-based spaced repetition system.`
- Library index evidence: `streams/primer/feedstock/library/indexes/library_index.sqlite`, table `files`, id `3159`, title `The Epiphany of Gliese 581`, authors `Fernando Borretti`, path `/Users/arthur/apps/personal-website/.cache/borretti-site/assets/content/eog581/The Epiphany of Gliese 581.epub`.
- Library index evidence for local `hashcards` project presence: same sqlite, table `files`, id `3020`, path `/Users/arthur/github/hashcards/third_party/ghostty/macos/Assets.xcassets/ResetZoom.imageset/ResetZoom.pdf`.
- Context alongside known anchors: browser substrate has Matuschak (`events` rowid `206001`, `2026-07-01T12:18:01.755`, `https://andymatuschak.org/tat/`; `events` rowid `206626`, `2026-07-05T11:34:19.759`, GitHub search in `andymatuschak/memory-machines`) and Skycak (`events` rowid `204495`, `2026-07-01T12:06:22.797`, Math Academy / Justin Skycak YouTube; `events` rowid `203918`, `2026-07-01T11:59:30.984`, `https://www.justinmath.com/math-academys-eurisko-sequence-5-years-later/`). Borretti/hashcards appears in the same recent learning/SRS neighborhood.
- Saved clipping context for Matuschak/Nielsen/Wozniak: `streams/primer/feedstock/Clippings/How to write good prompts.md`, lines 16, 40, 614, 674, 680, and 682 mention Michael Nielsen and Piotr Wozniak inside Matuschak’s piece, but I found them as citations rather than separate saved authors.

**Other candidates / NOT FOUND:**

- Michael Nielsen: found only as a collaborator/citation in `How to write good prompts.md` (e.g. lines 16, 40, 614, 674, 680), not as a separate saved browser/library author in the candidate searches.
- Piotr Wozniak / SuperMemo: found only as a citation in `How to write good prompts.md`, line 682, and `SuperMemo` appears line 62; no standalone saved item found in the requested substrates.
- Nicky Case: `Methods of Mandarin.md` line 85 links `ncase.me/remember/`, but no standalone saved author/item found in browser/library/Zotero/papers triage.
- Soren Bjornstad / Søren Bjørnstad / Bjornstad: no hits in Clippings/library/Zotero/browser candidate search.
- Search scope: Clippings filename/content; library index/content; Zotero itemData/storage; Books_Papers_Research and papers filename triage; browser sqlite `events`/`tabs`/`tab_entries` for all named candidates plus `hashcards`.

## 4. Pleometric / Arthur language-learning writing

**FOUND: @pleometric language-learning material, especially Chinese pronunciation/shadowing and Yomitan/Anki vocabulary mining — confidence HIGH. This may be the intended “third author” if VISION.md meant Arthur’s own recent language-learning writing rather than the Borretti/hashcards SRS lane.**

- Saved clipping: `streams/primer/feedstock/Clippings/Thread by @pleometric.md`, lines 2-6 identify title/source/author: `Thread by @pleometric`, source `https://x.com/pleometric/status/2027034632273699100`, author `@pleometric`, published `2026-02-27`.
- Saved clipping quote: same file, line 32: “In case anyone is studying Chinese: the Yomitan extension allows you to get dictionary definitions on hover and use those to create custom cards in Anki… ‘mining’ new vocabulary…” It continues with a 61k-word Chinese audio-generation workflow using Microsoft Edge TTS.
- Saved clipping quote: same file, line 118: Pleometric says he first spent credits on ElevenLabs but Edge TTS quality/rate limits were the practical route.
- Local Twitter archive: `data/twitter-archive/twitter-archive.sqlite`, table `tweets`, has `COUNT(*) = 84` where `username='pleometric'`. This confirms the local archive contains Arthur/Pleometric’s own tweets.
- Archive example: same sqlite, `tweets` id `2067433262159409208`, URL `https://x.com/pleometric/status/2067433262159409208`, created `Jun 18, 2026 · 2:24 AM UTC`, text discusses subtitles/framing/retention for short-form video: “Faces, movement, subtitles, framing, music everything needs to account for the retention graph…”
- Browser substrate: `/Users/arthur/state/browser-context/browser_context.sqlite`, `events` rowid `206792`/`207102`, observed `2026-07-06T14:43:37.824`, URL `https://x.com/pleometric/status/2073920351541588446`, title quote: “I made a shadowing tool to help me work on my pronunciation, it extracts character wise subtitles using FireRedASR2S. It can slow down audio, repeat sentences, jump forward or back sentence wise and let’s you select between pinyin, hanzi or both.”
- Browser substrate: same sqlite, `events` rowid `206783`/`207093`, observed `2026-07-06T13:34:48.614`, URL `https://x.com/pleometric/status/2073938546545529099`, title quote: “It does make mistakes but since most cdramas come with hard subs anyway, it’s not too hard to verify…”
- Web evidence: `https://pleometric.net/` says “Personal website and public archive for Pleometric. I use this site to archive what I read, watch, and study. I also write about my research interests.” It exposes `https://x.com/pleometric` and `https://github.com/pleometric`. As fetched, `https://pleometric.net/essays/` says “nothing here yet”; `https://pleometric.net/resources/` lists AI/video/model resources, not the language-learning threads.

**NOT FOUND / searched:**

- Browser sqlite searched `events`, `tabs`, `tab_entries` with `url/title LIKE '%pleometric%'`.
- Clippings/library searched for `Pleometric`, `pleometric`, `isaak.net`, `Methods of Mandarin`, `Mandarin`, `language learning`, `comprehensible input`.
- Web checked `https://pleometric.net/`, `https://pleometric.net/resources/`, `https://pleometric.net/essays/`, and web search for `Pleometric language learning blog Mandarin Cantonese ASR Pleometric`.
- I did not find a long-form Pleometric blog essay on language learning on `pleometric.net`; the saved and browser-backed evidence is X-thread/tweet material plus the public site identity.

## 5. Tool localization — FireRedASR2S, shadowing tool, and Chinese audio tools

**FireRedASR2S local status: VIEWED, NOT CLONED — confidence HIGH.**

- Browser: `browser_context.sqlite`, `events` rowid `206813`/`207123`, `https://github.com/FireRedTeam/FireRedASR2S`, observed `2026-07-06T14:44:06.332`.
- Local search: filename/content searches under `/Users/arthur/apps`, `/Users/arthur/exploratory`, and `/Users/arthur/github` for `FireRed`, `FireRedASR`, `FireRedASR2S`, `firered` found no local FireRedASR2S repo or script. The GitHub repo appears to have been viewed, not cloned.

**Pleometric/Arthur shadowing tool local status: NOT FOUND LOCALLY — confidence MEDIUM.**

- Browser: `browser_context.sqlite`, `events` rowid `206792`/`207102`, tweet title says the tool extracts character-wise subtitles with FireRedASR2S, slows audio, repeats/jumps by sentence, and toggles pinyin/hanzi.
- Local search: searched `/Users/arthur/apps`, `/Users/arthur/exploratory`, `/Users/arthur/github` for likely names/terms: `shadow`, `shadowing`, `subtitle`, `subtitles`, `cantonese`, `mandarin`, `pinyin`, `hanzi`, `FireRed`, `ASR`. No repo or script matching the described shadowing tool surfaced. Broad searches timed out in huge vendor trees, but narrowed searches across active Chinese-learning app sources did not find FireRed/shadowing code.
- Interpretation: the shadowing tool is evidenced by Arthur’s tweet/browser state, but not present as an obvious local repo under the instructed locations.

**Chinese audio / language-learning tooling found locally:**

- `/Users/arthur/apps/yomitan/` — local Yomitan checkout; matches Pleometric clipping line 32 recommending Yomitan for hover definitions and Anki mining.
- `/Users/arthur/apps/hsk-deck/` — active Chinese/HSK project. Relevant paths found by directory/filename triage include `reader/dist/audio/cantonese/`, `audio/cantonese/`, `output/minimax-experiments/`, `scripts/transcribe_media_then_delete.py`, and `scripts/transcribe_media_elevenlabs_then_delete.py`.
- `/Users/arthur/apps/bablefish/` — forced-alignment / Chinese audio-adjacent project with `scripts/parse_textgrid.py`, `scripts/preprocess_audio.py`, `forced-alignment-chinese/`, and `src/alignment/`.
- `/Users/arthur/apps/ultimate-chinese/` — Chinese sentence/pinyin utilities surfaced in app triage.
- `/Users/arthur/apps/minimal-srs/` — lightweight SRS / Anki-Connect-adjacent app, relevant to the Pleometric/Yomitan/Anki pipeline.
- `/Users/arthur/github/Mandarin-Subtitles-Archive/` — local subtitle archive, adjacent to the shadowing/subtitle workflow.
- `/Users/arthur/github/hashcards/` — local Borretti/hashcards SRS repo, relevant to the third-author SRS thread.
- `/Users/arthur/github/whisper.cpp` — present only as a 0-byte/stub entry in the directory listing; not a usable cloned local whisper.cpp tree there.

**NOT FOUND / searched:**

- No local `/Users/arthur/github/FireRedASR2S`, `/Users/arthur/apps/FireRedASR2S`, or similarly named FireRedASR directory found.
- No local repo with an obvious `shadowing`/`cantonese-shadowing`/`subtitle-shadowing` name found under `/Users/arthur/apps`, `/Users/arthur/exploratory`, or `/Users/arthur/github`.
- No GitHub URL for the shadowing tool appeared in the browser events I queried; only the X status and screenshots/tweet title evidence surfaced.
