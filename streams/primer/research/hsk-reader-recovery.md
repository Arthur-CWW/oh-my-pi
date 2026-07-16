# HSK reader + Mochi-lite recovery

Date: 2026-07-16

## Running URLs

Both services are currently running behind portless and returned HTTP 200:

- HSK reader: https://hsk-reader.localhost/
- Mochi-lite: https://mochi-lite.localhost/

No application source files were modified. The HSK app already had `node_modules`, `public/cards.json`, and the `public/audio` symlink, so no install or card generation was needed. The exact running commands (from each app directory) are:

```sh
# ~/apps/hsk-deck/reader
nohup bunx portless --force hsk-reader sh -c 'bun run dev --host 127.0.0.1 --port "$PORT"' > /tmp/hsk-reader-portless.out 2> /tmp/hsk-reader-portless.err &

# ~/apps/mochi-lite
nohup bunx portless --force mochi-lite sh -c 'npm run dev:app -- --port "$PORT"' > /tmp/mochi-lite-portless.out 2> /tmp/mochi-lite-portless.err &
```

The explicit `--port "$PORT"` is required because both Vite configs/scripts otherwise bind their fixed defaults (HSK 8081; Mochi 5173), bypassing portless's assigned app port.

## Screenshots

All screenshots are in `local/hsk-reader-recovery/`:

- `01-hsk-initial.png` — live HSK pre-reader queue and first card.
- `02-reader-initial.png` — unified `Reader` card view with Mandarin and Cantonese lines.
- `03-reader-playing-char-highlight.png` — character click-to-seek state; audio was playing from the clicked character (`paused: false`, `currentTime ≈ 0.58`, play control `⏸`).
- `04-reader-pinyin-off.png` — pinyin/ruby hidden.
- `05-reader-cantonese-playing.png` — Cantonese track active after clicking a Cantonese character.
- `06-reader-keyboard-map.png` — debug panel with language, timing, speed choices, and shortcut hint.
- `07-radical-explorer.png` — RadicalExplorer overview (radicals sorted by frequency).
- `08-radical-selected.png` — RadicalExplorer selected `扌`, showing HSK words grouped by level.
- `09-mochi-grid-overview.png` — Mochi-lite live overview: free-form deck/tree navigation, card counts, review counts, and inbox card.

The production HSK dev root is the current pre-reader shell (`src/main.tsx`). The unified audio/highlight component is the existing Anki build (`dist-anki/_hsk_reader.js`) loaded with the existing card contract for interaction capture; this did not change source.

## Audio + forced-alignment contract

`src/lib/reader-card.ts` defines:

```ts
export interface ReaderTimestampTracks {
  mando?: number[];
  canto?: number[];
}

export interface ReaderCard {
  word: string;
  pinyin: string;
  meanings: string[];
  hsk_level: number;
  sentence: string;
  sentence_pinyin: string;
  sentence_translation: string;
  sentence_audio: string;
  canto_sentence?: string;
  canto_jyutping?: string;
  canto_audio?: string;
  timestamps?: ReaderTimestampTracks;
  target_words?: ReaderTargetWords;
}
```

A live `public/cards.json` card consumed by the reader is:

```json
{
  "word":"的",
  "pinyin":"de",
  "meanings":["possessive particle","of","nominalizer"],
  "hsk_level":1,
  "sentence":"这是我最喜欢的书。",
  "sentence_pinyin":"Zhè shì wǒ zuì xǐhuān de shū.",
  "sentence_translation":"This is my favorite book.",
  "sentence_audio":"/audio/sentences/hsk1_440a5c3f7d8f_sentence.mp3",
  "canto_sentence":"呢本係我最鍾意嘅書。",
  "canto_jyutping":"ni1 bun2 hai6 ngo5 zeoi3 zung1 ji3 ge3 syu1.",
  "canto_audio":"/audio/cantonese/hsk1_a48bdf54cbed_cantonese.mp3",
  "timestamps":{
    "mando":[0.16,0.32,0.56,0.56,0.8,0.96,1.12,1.28],
    "canto":[0.08,0.24,0.32,0.56,0.88,1.2,1.36,1.6,1.92]
  }
}
```

The arrays are character-start times in seconds, indexed over the CJK-only sequence. `Reader.startLoop()` uses `requestAnimationFrame`, scans the selected track backwards, and marks the latest timestamp less than or equal to `audio.currentTime` as `speaking`. If no timestamps exist, it falls back to linear duration/CJK-count interpolation. Clicking a character (`Reader.tsx` `seekChar`) sets `audio.currentTime` to that character's timestamp (or linear fallback), sets the speaking index, and starts playback if paused. This is the observed press-to-resume behavior.

`normalizeTimestampTracks()` accepts a direct numeric array or track objects. For legacy data it also accepts `qwen`, `whisper`, or `linear` arrays, then normalizes to `{mando, canto}`.

## Cantonese alignment

`Reader.tsx` chooses Cantonese fields when `activeLang === "canto"`: `canto_sentence`, `canto_jyutping`, `canto_audio`, and `timestamps.canto`. `src/lib/pinyin.ts` performs one-to-one decode alignment by:

1. `tokenizeJyutping()` extracting numbered syllables matching `[a-zA-Z]+[1-6]`.
2. `parseRubyAnnotation(sentence, raw, "jyutping", targetMask)` iterating the Cantonese sentence's CJK characters and assigning the next Jyutping syllable to each CJK character, with `cjkIdx` values.
3. The same `RubyLine` renderer displaying the aligned character and Jyutping ruby.

This is a direct character-to-syllable mapping, not an English translation alignment. The present UI renders the Cantonese hint as a second aligned sentence line; clicking it switches the active track and uses Cantonese timestamps.

## RadicalExplorer

`src/RadicalExplorer.tsx` imports `getRadicals()` and `getWordsByRadical()` from `src/lib/radicals.ts`. That module imports the generated/static `src/data/radical-words.ts` mapping (`RADICAL_WORDS`). `getRadicals()` counts words per radical and HSK level, sorts by descending frequency, and `getWordsByRadical()` groups and sorts words into HSK levels 1–4. The captured selected state shows `扌` with 121 words.

## Audio files

- `~/apps/hsk-deck/reader/public/audio` is a symlink to `../../audio` (the project-level `~/apps/hsk-deck/audio` directory).
- The source audio tree contains 20,078 files.
- The built `dist/audio` tree has `words/`, `sentences/`, `grammar_mando/`, `grammar_canto/`, and `cantonese/` categories.
- `serve-audio.ts` is a tiny Bun server on port 8082 serving project-root paths with `audio/mpeg` and byte-range support; the normal Vite dev server serves the symlinked `/audio` paths directly.

## Full keyboard map

### Unified Reader (`src/lib/reader-keys.ts`)

- `Space`: toggle play/pause, only when focus is inside the reader; prevents default and propagation.
- `Cmd/Ctrl+J`: replay Mandarin from the start.
- `Cmd/Ctrl+P`: toggle pinyin/ruby visibility; persisted in storage as `hsk_show_pinyin`.
- `[`: toggle meanings reveal.
- `]`: toggle sentence translation reveal.
- Modified shortcuts require clean Cmd/Ctrl (no Alt or Shift); typing targets are ignored.

### Current pre-reader shell (`src/main.tsx`)

- `j` or `ArrowRight`: next card.
- `k` or `ArrowLeft`: previous card.
- `Space`: play/pause current card audio.
- `a`: mark selected word known.
- `c`: mark selected word confusing.
- `i`: mark selected word interesting.
- `f`: mark selected word formal.
- `x`: clear selected-word annotation.
- `/`: open filter.
- `g`: first card.
- `G`: last card.
- `Escape` while typing in the filter: blur the input.

### Older `src/App.tsx` dev reader

The legacy shell additionally used `Space` for play/pause, `p`/`P` for pinyin, `ArrowLeft`/`ArrowRight` for card navigation, and the topbar select controls for Mandarin/Cantonese and Qwen/Linear/Off alignment.

## Rebuild checklist: minimal daemon audio-reader contract

- [ ] Card payload must carry word, pinyin/Jyutping, meanings, Mandarin sentence, Cantonese sentence, translation, and separate audio URLs.
- [ ] Audio track selection must be explicit (`mando`/`canto`) and switchable without losing the card context.
- [ ] Forced alignment must be a per-track numeric array of character-start seconds, indexed over CJK characters; support missing arrays with a documented linear fallback.
- [ ] On character press, seek to that timestamp, immediately mark that character/word active, and resume playback if paused.
- [ ] During playback, run a frame loop that updates the active character from current time and clears state on pause/end.
- [ ] Pinyin/Jyutping ruby visibility must toggle independently of audio; persist the pinyin preference.
- [ ] Cantonese must decode one-to-one from numbered Jyutping syllables to Cantonese CJK characters, not through English translation text.
- [ ] Preserve Mandarin word-fusion highlighting (multi-character words highlight together) while Cantonese remains character-index aligned.
- [ ] Provide keyboard controls: Space, Cmd/Ctrl+J, Cmd/Ctrl+P, `[`, and `]`; avoid stealing typing-target events.
- [ ] Expose playback speed choices 0.5×, 0.75×, 1×, 1.25×, 1.5× plus progress/time state.
- [ ] Keep radical exploration backed by a generated radical→word map with HSK level grouping and frequency-sorted radical navigation.
- [ ] Keep decode-aiding tone classes/target-word colors in the sentence renderer.
- [ ] Serve local audio reliably; preserve the `/audio/...` URL contract and byte-range-friendly responses.
