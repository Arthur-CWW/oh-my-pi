# Ryan Lopopolo / OpenAI cleaned source manifest

Retrieved: 2026-06-05
Last updated: 2026-06-07

These are repo-local cleaned copies of canonical public sources.

The 2026 direct YouTube transcript files have YAML frontmatter with provenance metadata. See `../youtube-2026-direct-sources.md` for the search audit and excluded third-party summary/slop hits.

## Canonical sources

| Source | Canonical URL | Local file | Notes |
| --- | --- | --- | --- |
| OpenAI article | https://openai.com/index/harness-engineering/ | `openai-harness-engineering.md` | Cleaned article text from the canonical page. |
| AI Engineer Europe talk | https://www.youtube.com/watch?v=am_oeAoUhew | `youtube-ai-engineer-europe-harness-engineering.md` | 2026 direct Ryan talk; YAML frontmatter; cleaned from original YouTube auto-captions. |
| AI Engineer Europe livestream Ryan chapter | https://www.youtube.com/watch?v=O_IMsEg91g8 | `youtube-ai-engineer-europe-code-is-free-segment.md` | 2026 direct Ryan chapter only, 01:07:08-01:25:48; YAML frontmatter; avoids unrelated speakers in the multi-speaker livestream. |
| Latent Space interview | https://www.youtube.com/watch?v=CeOXx-XTYek | `youtube-latent-space-extreme-harness-engineering.md` | 2026 direct Ryan interview; YAML frontmatter; cleaned from original YouTube auto-captions. |
| Unprompted security interview | https://www.youtube.com/watch?v=U2O14Jd3MBU | `youtube-unprompted-code-is-free-securing-software.md` | 2026 direct Ryan/Paul McMillan talk; YAML frontmatter; cleaned from original YouTube auto-captions. |
| Aakash Gupta interview | https://www.youtube.com/watch?v=8suwvrF0Lv0 | `youtube-aakash-gupta-openai-pms-ship-code.md` | 2026 direct Ryan interview; YAML frontmatter; cleaned from original YouTube auto-captions. |
| OpenAI Build Hour: API & Codex | https://www.youtube.com/watch?v=rhsSqr0jdFw | `youtube-openai-build-hour-api-codex.md` | 2026 direct OpenAI panel/webinar with Ryan; YAML frontmatter; cleaned from original YouTube auto-captions. |
| AI Native Dev Ryan segment | https://www.youtube.com/watch?v=OfsWo6zyt-4 | `youtube-ai-native-dev-ryan-lopopolo-segment.md` | 2026 direct Ryan interview segment only, 00:26:10-00:35:02; YAML frontmatter; avoids unrelated speakers in the multi-speaker video. |
| AI Native DevCon London Harness Engineering talk | https://www.youtube.com/watch?v=c8bE0cj7vHY | `youtube-ai-native-devcon-harness-engineering.md` | 2026 direct Ryan talk; YAML frontmatter; cleaned from original YouTube auto-captions. |
| SREcon19 Asia/Pacific AWS billing talk | https://www.youtube.com/watch?v=I4BLfY54SsY | `youtube-srecon19-aws-billing-machine.md` | Direct Ryan talk; cleaned from original YouTube auto-captions. |
| DevOpsDays Seattle AWS billing talk | https://www.youtube.com/watch?v=QBpP3KpdM9c | `youtube-devopsdays-seattle-aws-billing-machine.md` | Direct Ryan talk; cleaned from original YouTube auto-captions. |
| RubyConf 2019 Artichoke talk | https://www.youtube.com/watch?v=QMni48MBqFw | `youtube-rubyconf-2019-artichoke-ruby-made-with-rust.md` | Direct Ryan talk; cleaned from original manual YouTube subtitles. |
| Alex Kotliarskyi article: Slow, Then Suddenly | https://frantic.im/suddenly/ | `frantic-slow-then-suddenly.md` | Related harness mental model; not Ryan-authored. Cleaned from canonical article page. |

## Comparison / fallback artifacts

The imported third-party corpus remains under:

- `../raw/ryan-lopopolo-openai/`

Use `raw/` only for comparison or spot-checking. Prefer the files in this directory for future agent reads.
