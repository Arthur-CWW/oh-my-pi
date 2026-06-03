# Happy Horse Prompting Guide | Arcads Help Center

- URL: https://intercom.help/arcads/en/articles/14782448-happy-horse-prompting-guide
- Final URL: https://intercom.help/arcads/en/articles/14782448-happy-horse-prompting-guide
- Status: 200
- Content-Type: text/html; charset=utf-8
- Extracted: 2026-06-03T14:16:34.179333+00:00
- Description: How to prompt with this model?

---

Happy Horse is the AI video model powering generations on Arcads. It's Alibaba's text-to-video model — and it rewards brevity. Most shots only need about twenty words: subject, action, setting, one cinematography cue. This guide covers everything you need to get great results on the first generation.

## What is Happy Horse?

Happy Horse is a cinematic text-to-video model. You give it a text prompt describing a scene, and it generates a short video clip. It's particularly strong at camera moves, atmospheric lighting, and physical motion.

It is **not** a talking-head or UGC generator. It doesn't lip-sync actors to a script. Think of it as a cinematographer — it responds to descriptions of how a scene looks and moves, not what someone says.

---

## The default template

Start here. Every time.

```
[Subject] [does action] in [setting], [time of day], [one atmosphere or camera cue].
```

Twenty words gives the model enough to commit and not enough to dilute.

**Examples that work:**

- A woman in a dark jacket strides along a rain-soaked urban boulevard at dusk, storefronts glowing in the background.
- A vintage black sports car cruises down a coastal cliff road in the late afternoon sun, ocean glittering below.
- A grey cat stretched across a linen armchair springs up toward a wooden shelf stacked with books.

Skip the wardrobe novel. Skip the lighting recipe. The first sentence does most of the work.

---

## Why brevity wins

Long prompts dilute. Every extra detail eats into the same budget — faces drift toward a generic average, hands lose geometry, gait flattens.

A child running through a field with a simple prompt produces cleaner biomechanics than the same scene padded with hair detail, dust kick-up, and arm-swing notes. The padded version had shorter strides, less weight on the feet, a slightly puppety quality.

**The sweet spot: ~20 words.** Add length only when the shot depends on camera language, and structure it properly when you do (see below).

---

## Anti-slop: words to drop

These push output toward a generic, model-default look:

❌ **Drop these:** beautiful, stunning, amazing, gorgeous, masterpiece, epic, breathtaking, insane detail, ultra detailed, hyperrealistic

✅ **Use these instead:** overcast daylight, wet asphalt, neon pink and cyan reflections in puddles, warm amber backlight on her shoulder, 35mm telephoto, shallow depth of field, single hard top-down key, deep falloff to black, sodium vapor street lamps, mid-afternoon sun on chrome

**Stacked synonyms don't push harder.** "Crimson, scarlet, ruby, deep red" doesn't crank saturation — pick one color and move on.

**Most negative cues are wasted words.** "No people in frame" is worth writing when there's a real risk a person appears. "No camera shake" rarely helps — the model isn't adding shake unless you ask for it.

**Director name references almost never work.** "Roger Deakins cinematography" barely registered in testing. Describe the look in technique terms instead: "backlit silhouette, soft natural haze, restrained cool desaturated palette, slow tracking dolly behind." That beats the name by a clear margin.

---

## When to go longer — and how

Long prompts pay off in one situation: **when the shot leans on camera language.**

Happy Horse is unusually good at camera moves — Steadicam pushes, slow dolly-ins, lateral orbits with parallax, helicopter aerials, locked-off framing. If the shot depends on how the camera behaves, give the model room to read the direction. **Put the camera cue at the end of the prompt** — that's where it gets the most weight.

When you do go longer, **don't use plain prose**. Use one of these two structures:

## Structure 1: Shot list with timecodes

For multi-beat shots, label every beat and pin it to a time range.

```
Shot 1 (wide establishing, 0-1s): [setup] Shot 2 (mid tracking, 1-4s): [action] Shot 3 (slow push-in close, 4-5s): [resolution]
```

**Example:**

```
Shot 1 (wide establishing, 0-1s): Rain-slicked Manhattan side street at night, neon storefront signs, shallow puddles. Empty. Shot 2 (mid tracking, 1-4s): A woman in a crimson coat enters frame, walking briskly. Camera tracks alongside her. Warm amber backlight on her shoulder, cool blue in the shadows. Shot 3 (slow push-in close, 4-5s): Slow dolly-in onto her face. Breath visible in cold air, calm expression.
```

This is the strongest multi-beat structure. Each beat reads cleanly. "First X, then Y, then Z" in plain prose almost always collapses into one confused motion.

Use concrete framing terms in each label: "wide establishing," "mid tracking," "slow push-in close," "low-angle wide," "macro close-up."

## Structure 2: Markdown sections (single continuous take)

When the shot is one take but you need to specify many axes, split into headed sections. Action stays separate from lighting; camera direction doesn't bleed into wardrobe.

```
## Subject [Subject and one wardrobe detail]  ## Action [What happens, including motion direction]  ## Setting [Location, time of day, weather, props]  ## Camera [Camera move, lens, depth of field, framing]  ## Lighting [Key light direction, color temperature, contrast]  ## Mood [Two or three words]
```

Only use this when you have content for most sections. Empty headers hurt. If you only have a subject and a camera move, write twenty words and stop.

---

## What works well

- **Camera moves** — Steadicam glides, slow dolly-ins, locked-off wide shots, helicopter aerials. Plain English direction lands.
- **Atmospheric lighting** — Blue hour, neon noir with mist and puddle reflections, single hard top-down key with deep falloff. The model picks these up and gives back convincing color and contrast.
- **Vehicles and large rigid objects** — Chrome highlights, reflections, and metallic paint render cleanly.
- **Cloth and fabric in wind** — Capes, flags, hair on a windswept cliff. Secondary motion holds when cloth is the main feature.
- **Fire and embers** — Flames render with real warmth; embers trace convincing arcs. Note: if you add a rising camera move, the framing pulls back and the fire may appear to shrink — that's the camera move, not the model losing the flame.
- **Wide establishing shots** — Drone aerials and vast landscapes carry the shot on framing alone.
- **Mirrors and reflections** — Reflections stay geometrically consistent with the source figure across the take.
- **Short legible text** — Book titles in window displays, 2–3 word signage. The model rendered "THE STARS BELOW" exactly as written. Long signage and dense paragraphs still hallucinate.
- **Style anchors with visual translation** — "Wong Kar-wai aesthetic" works when you also write out the visual elements (saturated greens and reds, slow motion, telephoto compression). The anchor alone with no supporting cues did almost nothing.

---

## What struggles

- **Multi-step sequences in plain prose** — "First X, then Y, then Z" compresses into a single motion. Use the shot-list format with timecodes.
- **Extreme slow-motion** — "1000fps slow-motion" rarely produces dramatic time dilation. The model slows the action somewhat but doesn't freeze droplets mid-air. Write it as a normal slow shot and accept what you get.
- **Wardrobe specifics under heavy motion** — "Yellow sundress" and "striped t-shirt" prompts rendered as plain white tees once subjects started running fast. Wardrobe details survive in static or slow shots; expect drift in fast action.

---

## Copy-paste templates

## 20-word single-character beat

```
[Subject in one phrase] [does action] in [setting], [time of day], [one atmosphere cue].
```

## Single character with camera move (40–60 words)

```
[Subject and one wardrobe detail] [does action] in [setting]. [Camera move + lens]. [Lighting cue]. [Mood word].
```

Spend the extra words on camera and lighting — that's what the model picks up cleanly.

## Multi-beat shot list

```
Shot 1 ([framing], 0-Xs): [setup beat] Shot 2 ([framing], X-Ys): [action beat] Shot 3 ([framing], Y-Zs): [resolution beat]
```

## Atmospheric establishing shot (under 25 words)

```
[Setting] at [time of day], [one weather or atmosphere cue], [one composition cue].
```

Skip the subject entirely for pure environment shots — atmosphere carries the frame.

## Continuous take with markdown sections

```
## Subject [Subject and wardrobe]  ## Action [What happens, including motion direction]  ## Setting [Location, time of day, weather, props]  ## Camera [Camera move, lens, depth of field, framing]  ## Lighting [Key light direction, color temperature, contrast]  ## Mood [Two or three mood words]
```

---

## Checklist before generating

- [ ] Subject and action in the first sentence?
- [ ] Under 30 words, or a real reason to go longer?
- [ ] If longer: shot-list timecodes or markdown sections — not plain prose?
- [ ] Exactly one strong cinematography cue, not five?
- [ ] Cut every adjective that wasn't specific?
- [ ] If a camera move is the point of the shot, is it the last thing in the prompt?
- [ ] Multi-beat action: shot-list format?
- [ ] Plain English prose — not booru tags, JSON, or weighted parentheses?

If you're on the fifth or sixth generation of the same shot, the prompt is doing too much. Strip it back to 20 words and rebuild from there.

---

Related Articles

[How to extend your videos ?](https://intercom.help/arcads/en/articles/13230010-how-to-extend-your-videos)[How to Create a Custom "Talking Actor" ?](https://intercom.help/arcads/en/articles/13240351-how-to-create-a-custom-talking-actor)[How to show a product in a video ?](https://intercom.help/arcads/en/articles/13281882-how-to-show-a-product-in-a-video)[Understanding Omnihuman 1.5, Audio-Driven, and Arcads 1.0](https://intercom.help/arcads/en/articles/13429441-understanding-omnihuman-1-5-audio-driven-and-arcads-1-0)[How Are Credits Counted?](https://intercom.help/arcads/en/articles/13725589-how-are-credits-counted)
