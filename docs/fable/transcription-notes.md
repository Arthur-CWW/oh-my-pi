# Fable Transcription Notes

Arthur often dictates through VoiceInk / speech-to-text. Treat unusual names as hypotheses, not exact terms. Verify against repo paths, browser/Twitter history, or the source session before building on a term.

## Verified or high-confidence corrections

| Transcript phrase | Likely intended | Evidence / lookup |
|---|---|---|
| Heisuke | `HSK` / Chinese deck work | Repo/session paths point to `~/apps/hsk-deck`; no separate Heisuke project surfaced in the session corpus. |
| Andy Matsuchak / Matuschak variants | Andy Matuschak | Known spaced-repetition / working-notes reference; relevant to memory prompts and primer design. |
| Fernando Berretti / Boretti variants | Fernando Borretti | Kagi result: `borretti.me`, `Effective Spaced Repetition`, and GitHub `eudoxia0/hashcards`. |
| Hashcards | `eudoxia0/hashcards` | Kagi result: GitHub repo `eudoxia0/hashcards`, plain text-based spaced repetition system. |
| Golden Nuggets | Golden Nuggets Podcast | Kagi result: podcast by `strategypattern` and Jamesb about learning with spaced repetition systems. |
| Gming / G-ming | Jimeng / Dreamina | Existing repo docs and package: `packages/jimeng-client`, `skills/provider/jimeng-browser-proxy`. |
| Opis | Claude Opus | Context: model/design-skill discussion; global role `designer: anthropic/claude-opus-4-6`. |
| brainrod / brenrod | brainrot | Context: UGC/media aesthetic lane. |
| Love in Deep Space | *Love and Deepspace* | AI companion inspiration; verify exact features on device/browser before copying details. |
| ArCAD AI | Arcads.ai / Arcads-style UGC ad tooling | Existing docs under `docs/research/arcads-alternative/`. |
| Higgs Field | Higgsfield AI | UGC/video generation interface inspiration; not a fixed implementation plan. |
| MIDI creation | likely media creation | Context was UGC/video creative interfaces; verify if audio/MIDI is actually meant in a later session. |
| OMP off sessions | likely OMP auth/profile/session storage | Use `omp --help`, `omp auth-broker`, `omp token`, `omp usage`, `OMP_PROFILE`, and `PI_CODING_AGENT_DIR`; do not invent token storage. |

## Unverified / needs source lookup

| Transcript phrase | Candidate meaning | How Fable should verify |
|---|---|---|
| Something Kirby | Unknown flashcard/SRS Twitter reference | Search Twitter/X archive, browser history, and `session-records.json` for Kirby + flashcard/SRS terms. Kagi web search did not identify a clear source. |
| voogel / thebes | likely a Twitter/X writer or handle, possibly `@voooooogel`; `thebes` uncertain | Search `packages/twitter-archive`, browser history, and session corpus. Do not assume the handle without evidence. |
| homey system | unclear; possibly Arthur's curated/home context system | Ask Arthur only if tools/session docs cannot disambiguate. |
| iPhone Max | Arthur's iPhone Pro Max device | Use approved local device-control tooling only; verify exact device name before writing automation. |

## Interpretation rule

If a dictated term is unclear, preserve both the raw phrase and the likely correction in notes. Do not hardcode a product/repo name from a guessed transcription unless a folder, URL, or source session confirms it.
