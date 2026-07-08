---
title: 3D character mashups — first five, via jimeng-5.0
date: 2026-07-08
agent: CharacterMashups + Fable
status: shipped
---

## The cast (4 variants each in `workflows/scene-lab/assets/characters/`)

| | |
|---|---|
| ![aschenbrenner](aschenbrenner-orange-00.png) | **Aschenbrenner × Orange** — the founding meme. Chubby citrus-bodied blond nerd, wire glasses, smug grin. (First submit hit ret=3018, retry succeeded; manifest kept the error flag — images are real.) |
| ![sonic](sonic-gigachad-00.png) | **Gigachad Sonic** — six-pack, smirk, glossy figurine finish. |
| ![claude](claude-suit-swag-00.png) | **Suit Claude** — starburst-flower head, gray suit, crossed arms, ceramic gloss. |
| ![peach](peach-hypershiny-00.png) | **Hyper-shiny Peach** — humanized, wet-gloss PVC. |
| ![catmouse](cat-mouse-duo-00.png) | **Cat & Mouse duo** — Tom-and-Jerry-shaped, house style. |

**Missing:** pernicious penguin — workbench UI-state error ("prompt editor missing"), retry next session.

## Spend + auth story

~5 submits on jimeng-5.0 (`high_aes_general_v50`, 2k, 2:3), 4 variants per submit — within the 10-submit cap, concurrency 1, no risk-control hits. The worker first proved the Helium agent profile is **logged out** (no passport cookies → 1015) via non-spending probes, then succeeded through the direct-submit path. Full forensics: `history://CharacterMashups`.

## Prompt scaffold (full playbook: `docs/research/jimeng-prompting-playbook.md`)

`[figurine wrapper] — [subject fusion clause] — [meme-mascot disclaimer] + negative prompt`. Seeds + full prompts in each character's `manifest.json`.

## Rerun

Re-login Jimeng in the Helium profile first (only blocker for scale-up), then rerun per manifest prompts with jimeng-client's text2image capture flow.
