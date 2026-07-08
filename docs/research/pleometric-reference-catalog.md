# Pleometric Reference Catalog (Visual & Textual Analysis)

This catalog details the cultural references, visual techniques, and style tags identified across a 30-video slice of the Pleometric corpus.

## Visual & Textual Methodology

1. **Video Selection**: 30 Pleometric videos listed in the reference table below.
2. **Frame Sampling**: For each video, 8 evenly-spaced keyframes were extracted via ffmpeg, scaled to a max width of 640px.
3. **Provider**: All visual inferences were generated through the Google Antigravity subscription lane (`google-antigravity/gemini-3.5-flash`) using `omp -p`.
4. **Prompt**: Each run combined the catalog prompt in `docs/prompts/pleometric-reference-catalog-prompt.md` with the tweet text and a transcript excerpt from `data/inspiration/pleometric/manifest.json` and `transcripts.json`.
5. **Coverage**: 30/30 videos processed successfully via the subscription lane; per-video JSON outputs live in `data/provider-evals/video-understanding/runs/reference-catalog-antigravity/`.

## Reference Catalog Table

| Video ID | Date | Visual One-Line | Observed References (Kind, Confidence) | Visual Techniques | Style Tags |
|---|---|---|---|---|---|
| **2041310438583877970-1** | Apr 7, 2026 | A surreal podcast pilot interviewing a gigachad pickle next to Subway Surfers gameplay. | Gigachad (meme, 0.95), Subway Surfers (brand, 0.99), Club Penguin (brand, 0.8) | split-screen, picture-in-picture gameplay, psychedelic feedback tunnel background, caption typography | shitpost, surrealist, retention-bait, internet-lore |
| **2041711217677320452-1** | Apr 8, 2026 | A surreal 3D-animated character with a sun-shaped head and a trench coat performs a rhythmic dance against a stark black background | Sun-faced character (character, 0.9), Matrix / Neo (character, 0.85) | 3D character animation, Looping animation, Minimalist black background | surrealist, internet-lore, absurdist |
| **2044829644910641471-1** | Apr 16, 2026 | A purple Club Penguin avatar with heart eyes stands under a rotating ring of golden 3D 'UNEMPLOYED!' text. | Club Penguin (brand, 0.95), Unemployed Friend Meme (meme, 0.9) | 3D text rotation, Low-poly rendering, Looping animation | shitpost, internet-lore, retro-digital |
| **2045554597280813392-1** | Apr 18, 2026 | A dancing Club Penguin penguin is abruptly obliterated by a sudden explosion. | Club Penguin (brand, 0.99), Explosion meme (meme, 0.95) | 3D loop animation, Abrupt cut, Visual effects overlay | shitposting, surrealist, internet-lore |
| **2046685420142932151-1** | Apr 21, 2026 | A rotating low-poly purple Club Penguin avatar wearing a military helmet. | Club Penguin (brand, 0.99), Military Helmet (meme, 0.9) | 3D turntable rotation, Low-poly rendering | internet-lore, shitpost, retro-gaming |
| **2070631349778579630-1** | Jun 26, 2026 | A surreal journey through cyber-mystical diagrams, glowing skulls, and eye-filled screens. | seedance (artwork, 0.95), All-Seeing Eye (meme, 0.9), Three Wise Monkeys (meme, 0.8) | tunnel zoom, holographic projection, diagram animation, CRT static filter | cyber-occult, tech-gnosticism, weirdcore, surrealist |
| **2049999955834568734-1** | Apr 30, 2026 | A parodic HR compliance video detailing how employees should navigate having a dominatrix boss. | JPMorgan Chase (brand, 0.95), Windows 95 (brand, 0.9) | VHS tracking emulation, CRT scanlines, Analog glitch effects, 3D character head replacement, Kinetic typography | Corporate surrealism, Dystopian humor, Weirdcore, Analog horror |
| **2050364782411202781-1** | May 2, 2026 | A surreal accelerationist meme depicting Leopold Aschenbrenner as Sonic commenting on AI takeoff speed. | Sonic the Hedgehog (character, 0.99), Leopold Aschenbrenner (person, 0.98), Sanic (meme, 0.95) | Kinetic typography, 3D character animation, Meme overlay | accelerationist, tech-doomer, surrealist, internet-lore |
| **2054594912717312476-1** | May 13, 2026 | A CGI banana avatar explains how AI agent compute costs will cap and reduce white-collar wages. | Leopold Aschenbrenner (person, 0.9), Agent Peely (character, 0.85), Club Penguin Penguin (character, 0.95) | CGI character animation, Kinetic typography, Data visualization overlays, Picture-in-picture cloning, Semiconductor B-roll inserts | Accelerationist, Surrealist, Tech-doomer, Internet-lore |
| **2055420576714408309-1** | May 15, 2026 | A glossy 3D animation of Tom Tucker walking past a giant chrome Tom the Cat against a cosmic background. | Tom Tucker (character, 1.0), Tom Cat (character, 1.0), Thomas Shelby (character, 0.9), iShowSpeed Fan Aura Pose (meme, 0.95) | 3D CGI animation, Glossy plastic texture rendering, Slow-motion loop, Parallax layering | brainrot, internet-lore, surrealist, glossy-plastic |
| **2056378137831682359-1** | May 18, 2026 | An analysis of investor Leopold Aschenbrenner's hedge fund portfolio shifts using a 3D avatar and stock charts. | Leopold Aschenbrenner (person, 0.99), Club Penguin (character, 0.95) | Kinetic typography, 3D avatar animation, Stock chart visualization, Logo overlay | Finance-meme, Tech-doomer, Accelerationist, AI-lore |
| **2057289057483346095-1** | May 21, 2026 | A surreal math explanation overlaying CM field equations on a distressed 3D OpenAI logo head. | OpenAI Logo (brand, 0.99), Meme Man (meme, 0.9), Trolls (character, 0.8) | kinetic typography, clone fields, formula overlays, opacity transitions | academic-shitpost, surrealist, tech-doomer, retro-futuristic |
| **2063699116991869299-1** | Jun 7, 2026 | A 3D motion graphics video of a purple penguin mascot navigating geometric paths to promote Pleometric. | penguin (character, 0.95), Pleometric (brand, 0.98) | kinetic typography, 3D path animation, loop animation | tech-corporate, minimalist 3D, purple aesthetic |
| **2064045757515063502-1** | Jun 8, 2026 | A surreal brainrot shitpost featuring dancing cutouts and Peter Griffin promoting Pangram's AI detector. | Pangram (brand, 1.0), Peter Griffin (character, 1.0), Terminator (character, 0.95) | Chroma keying, Kinetic typography, Cutout animation, ASMR background loops | brainrot, shitpost, surrealist, internet-lore |
| **2067252216130376109-1** | Jun 17, 2026 | A parody broadcast detailing a dramatic life-or-death security pledge for AI developers. | Claude / Opus 4.5 (brand, 0.9), Gemini 3 Pro (brand, 0.9), Anonymous / Guy Fawkes (meme, 0.95), Seppuku (meme, 0.95), Takeru Satoh (person, 0.85) | Variety show HUD overlay, Chroma key character rendering, Stock footage compilation, Kinetic typography | tech-satire, shitpost, japanese-tv-parody, surrealist |
| **2067386489403503090-1** | Jun 17, 2026 | A bot-farm vertical TikTok video pasting Monster High footage over a nonsensical AI-narrated story. | Draculaura (character, 0.9), Monster High (brand, 0.9), Disney (brand, 0.8) | Vertical reframing, Split-screen layout, Pillarbox blur, Kinetic typography | botcore, slop, AI-narrated, content-farm |
| **2067431750951690447-1** | Jun 18, 2026 | A speaker questions the significance of the global AI race and whether leading the advancement matters if no one slows down. | Kevin Kelly (person, 0.9), Amtrak (brand, 0.99) | kinetic typography, vertical reframing, talking head | accelerationist, tech-doomer, podcast-clip |
| **2067433262159409208-1** | Jun 18, 2026 | Kevin Kelly discusses the geopolitical dynamics of AI development, arguing that unilateral deceleration is ineffective. | Kevin Kelly (person, 0.95), Amtrak (brand, 0.99) | kinetic typography, vertical framing, jump cuts | geopolitical-tech, accelerationist, interview-clip |
| **2067662803721220310-1** | Jun 18, 2026 | A chaotic montage featuring anthropomorphic AI vegetables, gaming screenshots, datamoshed transitions, and outdoor scenes. | Minecraft (brand, 0.9), Annoying Orange (meme, 0.8) | Datamoshing, AI face-tracking filter, Split-screen overlay, Glitch transitions | Surrealist, AI-weirdness, Internet-lore, Shitpost |
| **2067714664348229948-1** | Jun 18, 2026 | A spinning purple Club Penguin character floats against a colorful psychedelic background while a dramatic, nonsensical rant about Bangladesh and open-flame sausages plays. | Club Penguin (brand, 0.9), Bangladesh Song / Meme Sound (meme, 0.85) | character animation, 3d rotation, psychedelic background, picture-in-picture / corner overlay, looping animation | surrealist, shitposting, internet-lore, psychedelic, meme-core |
| **2067715247679402255-1** | Jun 18, 2026 | Humorous acoustic song performance of 'Bangladesh' by Ian McConnell with synchronized text overlays. | Ian McConnell (person, 0.99), Bangladesh (artwork, 0.95) | on-screen text overlays, motion blur | indie-folk, comedy-music, performance-clip |
| **2068025479026593909-1** | Jun 19, 2026 | An ironic shitpost parodying financial advice by urging viewers to stop thinking. | Club Penguin Penguin (character, 0.95), Drooling Cat (meme, 0.9), Talking Cat (meme, 0.85) | kinetic typography, tiled background, AI mouth animation | absurdist, brainrot, accelerationist |
| **2050907411259490462-1** | May 3, 2026 | A reaction loop showing Red from Angry Birds cupping a human ear to listen. | Red (character, 1.0), Angry Birds (brand, 1.0), Angry Bird Listening (meme, 0.95) | Image manipulation, Looping frame | shitposting, surrealist, internet-lore |
| **2052979237678653532-1** | May 9, 2026 | A parody of y2k-era web banner ads featuring a Club Penguin sticker promoting audience enlargement pills. | Club Penguin (character, 0.95), Albion Medical (brand, 0.9) | Retro banner design, Kinetic text flashing, Sprite frame animation | y2k-aesthetic, retro-web, shitpost, internet-lore |
| **2049658654538785254-1** | Apr 30, 2026 | A rotating low-poly purple Club Penguin avatar wearing a banana hat. | Club Penguin (brand, 0.98) | 3D character rotation, turntable preview, low-poly rendering | internet-nostalgia, retro-gaming, web-core |
| **2071346891367792806-1** | Jun 28, 2026 | A mockup newspaper front page reporting the fictional demise of a banana-hat penguin avatar. | Pleometric (meme, 0.95), Club Penguin (brand, 0.9), Chicago Tribune (brand, 0.99) | 3D turntable animation, Newspaper mockup generation, Picture-in-picture overlay | internet-lore, shitposting, surrealist, dark humor |
| **2055621213431468424-1** | May 16, 2026 | TikTok reaction meme about calling a straight man 'girl'. | calling a straight man 'girl' mid convo (meme, 0.95) | text overlay, jump cuts, lip sync, handheld camera work | relatable comedy, TikTok humor, internet-lore |
| **2071047326869664178-1** | Jun 28, 2026 | An uncanny AI-animated hamster with human teeth rotates and snarls next to retro birthday text. | Hamster with human teeth (meme, 0.95), WordArt (brand, 0.85) | AI video interpolation, Digital compositing, 3D rotation effect | weirdcore, cursed-aesthetic, shitposting |
| **2047074844483731515-1** | Apr 22, 2026 | A nomadic Club Penguin character stands beside a Turkic stone statue under a rotating starry sky. | Club Penguin (character, 0.9), Balbal (Kurgan Stela) (artwork, 0.95), Nomadic Headwear (artwork, 0.9) | Collage animation, Chroma keying, Star trail time-lapse | surrealist, internet-lore, steppe-wave |
| **2069782589171261567-1** | Jun 24, 2026 | A highly distorted, deep-fried compilation of streamer Tyler1 screaming and raging in psychic agony, illustrating the painful process of writing. | Tyler1 (person, 0.98) | Deep-frying, Chromatic distortion, High-contrast color grading, Glitch effects, Pixelation | Internet-lore, Deep-fried, Cyber-grunge, Surrealist |

---

## Rollup Section

### 1. Recurring References (Character-Asset Backlog Candidates)

These entities appear across multiple videos and are strong candidates for reusable character assets, brand templates, or subject backlogs:

| Reference Name | Kind | Video Count | Videos | Action |
|---|---|---|---|---|
| Club Penguin | character | 10 | 2041310438583877970-1, 2044829644910641471-1, 2045554597280813392-1... | Template/backlog candidate |
| Leopold Aschenbrenner | person | 3 | 2050364782411202781-1, 2054594912717312476-1, 2056378137831682359-1 | Template/backlog candidate |
| Club Penguin Penguin | character | 2 | 2054594912717312476-1, 2068025479026593909-1 | Template/backlog candidate |
| Pleometric | meme | 2 | 2063699116991869299-1, 2071346891367792806-1 | Template/backlog candidate |
| Kevin Kelly | person | 2 | 2067431750951690447-1, 2067433262159409208-1 | Template/backlog candidate |
| Amtrak | brand | 2 | 2067431750951690447-1, 2067433262159409208-1 | Template/backlog candidate |

### 2. Recurring Visual Techniques (Style-Recipe Candidates)

These editing patterns appear frequently and should be modularized as reusable pipelines:

| Technique | Video Count | Notes |
|---|---|---|
| kinetic typography | 12 | High-frequency editing pattern |
| looping animation | 3 | High-frequency editing pattern |
| low-poly rendering | 3 | High-frequency editing pattern |
| 3d character animation | 2 | High-frequency editing pattern |
| chroma keying | 2 | High-frequency editing pattern |
| vertical reframing | 2 | High-frequency editing pattern |
| jump cuts | 2 | High-frequency editing pattern |

### 3. Recurring Style Tags

| Style Tag | Video Count |
|---|---|
| internet-lore | 17 |
| surrealist | 16 |
| shitpost | 7 |
| accelerationist | 6 |
| shitposting | 5 |
| tech-doomer | 5 |
| weirdcore | 3 |
| brainrot | 3 |
| absurdist | 2 |
| retro-gaming | 2 |