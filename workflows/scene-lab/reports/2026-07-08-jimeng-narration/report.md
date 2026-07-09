# Jimeng TTS Narration — 2026-07-08

Generated via `/mweb/v1/tts_generate` using the Jimeng browser-proxy CLI and a saved session bundle.

- **Voice ID:** `7592674770097803814`
- **Voice Title:** 137-George
- **Generated At:** 2026-07-09T03:18:22Z
- **Session:** `data/jimeng-lab/raw/session-bundle-current.json`
- **Transport:** live HTTP (bundle auth)

## Per-script summary

| # | Title | Duration | Target (s) | Chars | Voice | MP3 |
|---|-------|----------|------------|-------|-------|-----|
| 1 | Nothing Human Makes It Out | 36.595s | 32–39 | 548 | 137-George | [nothing-human-makes-it-out.mp3](../../assets/narration/nothing-human-makes-it-out.mp3) |
| 2 | What Lab? | 31.208s | 33–41 | 485 | 137-George | [what-lab.mp3](../../assets/narration/what-lab.mp3) |
| 3 | The Number With No Name | 37.477s | 42–50 | 569 | 137-George | [the-number-with-no-name.mp3](../../assets/narration/the-number-with-no-name.mp3) |
| 4 | Not a Serious Species | 33.994s | 39–46 | 519 | 137-George | [not-a-serious-species.mp3](../../assets/narration/not-a-serious-species.mp3) |

## Rerun commands

All four scripts were generated with the same voice and session bundle. To regenerate a single script:

### Nothing Human Makes It Out

```bash
cd packages/jimeng-client \
  && bun src/browser-proxy-cli.ts tts \
    --session ../../data/jimeng-lab/raw/session-bundle-current.json \
    --voice-id 7592674770097803814 \
    --voice-title "Nothing-Human-Makes-It-Out" \
    --text "The story goes like this. Earth is captured by a technocapital singularity. Markets learn to manufacture intelligence; politics upgrades its paranoia and tries to get a grip. The thresholds come faster now. Fifteen hundred. Nineteen forty-eight. Nineteen ninety-six. Two thousand eight. Two thousand eleven. Nothing human makes it out of the near-future. Neo-China arrives from the future. Hypersynthetic drugs click into digital voodoo. Retro-disease. Nanospasm. Garbage time is running out. Can what is playing you make it to level two? It's war." \
    --outDir ../../workflows/scene-lab/assets/narration
```

### What Lab?

```bash
cd packages/jimeng-client \
  && bun src/browser-proxy-cli.ts tts \
    --session ../../data/jimeng-lab/raw/session-bundle-current.json \
    --voice-id 7592674770097803814 \
    --voice-title "What-Lab?" \
    --text "Honestly, labs is such bullshit. What lab? Why are we calling it a lab? It is a trillion-dollar corporation with five thousand people building a superweapon in secrecy, dropping hints from time to time. DeepSeek is a lab. This is a ticking time bomb. Imagine if Los Alamos were a private actor, guarding its cute know-hows, never publishing anything. But that is exactly what they say it is. And I don't see how a nation-state lets that be anything more than a facade, in the long run." \
    --outDir ../../workflows/scene-lab/assets/narration
```

### The Number With No Name

```bash
cd packages/jimeng-client \
  && bun src/browser-proxy-cli.ts tts \
    --session ../../data/jimeng-lab/raw/session-bundle-current.json \
    --voice-id 7592674770097803814 \
    --voice-title "The-Number-With-No-Name" \
    --text "How big is the biggest number you will ever need? Here is a game. Take a machine with n rules, start it on a blank tape, and of the ones that stop, keep the one that runs longest. Call it BB of n. BB of five is forty-seven million. We only proved that last year. BB of six is already too big to write with exponentials — you need towers of them, then towers of those. And near seven hundred and forty-five rules, the number goes dark. Not hard to find. Impossible. The axioms of mathematics cannot decide it. There is a number math refuses to name. It was always there." \
    --outDir ../../workflows/scene-lab/assets/narration
```

### Not a Serious Species

```bash
cd packages/jimeng-client \
  && bun src/browser-proxy-cli.ts tts \
    --session ../../data/jimeng-lab/raw/session-bundle-current.json \
    --voice-id 7592674770097803814 \
    --voice-title "Not-a-Serious-Species" \
    --text "Here is the part the labs will not say out loud. The check they cut you to keep you off the street — call it UBI — has to scale with what you would gain by taking the street. So the richer they get, the more they owe you. But there is a second curve. Every year, the drones, the surveillance, the models that run them — all get cheaper. Two lines. One says pay them. One says don't. Guess which one wins. This is a species that sinned for a snack while it believed sin bought eternal fire. We are not a serious species." \
    --outDir ../../workflows/scene-lab/assets/narration
```

## Verification

All MP3s were verified with `ffprobe -v error -show_entries format=duration`.

```bash
for f in workflows/scene-lab/assets/narration/*.mp3; do
  echo "$f"
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"
done
```

## Notes

- Bundle auth succeeded on first live TTS call; no CDP fallback was required.
- George (137) was selected for a flat, deadpan English male delivery.
- Generated MP3s were renamed from the CLI artifact filename (`<voiceTitle>-<voiceId>.mp3`) to `<slug>.mp3` for the target layout.
