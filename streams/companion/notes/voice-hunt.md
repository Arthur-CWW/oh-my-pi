# Voice Hunt — VTuber/ASMR voice-clone reference catalog

Date: 2026-07-03 · Agent: VoiceHunt · Trigger: Kokoro `af_nicole` rejected as "not a pleasing VTuber ASMR voice" (see `tts-stt-survey.md`). Goal: ground a future voice-clone lane in who audiences actually pay to hear, then pull local voice references.

## Method (and honesty notes)

1. **Playboard** (playboard.co, the Korean YouTube analytics site) rendered client-side, so charts were pulled with a headless-Chromium tab (`read` got only nav): all-time worldwide all-channels, all-time worldwide **VTuber-only**, Jun 2026 monthly worldwide, Jun 2026 monthly Japan. **7 total requests, zero retries, no 429/403 seen, no auth.** Per Arthur's rate-limit warning mid-run, all Playboard traffic stopped immediately after and every captured chart was cached to **`data/voice-refs/_cache/playboard/`** (3 extracted-text snapshots + 1 full HTML). All Playboard numbers below are from that cache. Amounts display in **AUD** (Playboard geo-localizes currency); treat as relative ranking, not payout.
2. Popularity cross-checked against press coverage of Playboard data (Crunchyroll, Anime Corner, official ANYCOLOR news, VTuber Awards results).
3. ASMR-activity verified per channel via `yt-dlp --flat-playlist` listings (public videos only).
4. Downloads: `yt-dlp -f bestaudio --write-info-json`, concurrency 1, 18–26 s sleeps between downloads + `--sleep-requests 1`. Public videos only; no cookies, no member content.

## Leaderboard findings

### All-time worldwide super chat (Playboard, cached 2026-07-03) — VTubers in the top 34

Source: <https://playboard.co/en/youtube-ranking/most-superchatted-all-channels-in-worldwide-total> (cache: `_cache/playboard/most-superchatted-all-channels-in-worldwide-total.txt`, top-80 captured). Non-VTubers in the top 30 are pastors/prayer (#1, #2, #27), radio/podcast/sports (#3, #4, #12, #19, #22, #24, #26). Everything else is a VTuber:

| # | Channel | Super chat (AUD) | VTuber? | Agency | Gender | Lang |
|---|---------|------------------|---------|--------|--------|------|
| 5 | Uruha Rushia 潤羽るしあ | 4.75M | ✔ | hololive (terminated 2022) | F | JP |
| 6 | Usada Pekora 兎田ぺこら | 4.69M | ✔ | hololive | F | JP |
| 7 | Houshou Marine 宝鐘マリン | 4.43M | ✔ | hololive | F | JP |
| 8 | Kiryu Coco 桐生ココ | 4.27M | ✔ | hololive (graduated 2021) | F | JP |
| 9 | Amane Kanata 天音かなた | 3.91M | ✔ | hololive | F | JP |
| 10 | Kuzuha 葛葉 | 3.89M | ✔ | NIJISANJI | M | JP |
| 11 | Minato Aqua 湊あくあ | 3.70M | ✔ | hololive (graduated 2024) | F | JP |
| 13 | Yukihana Lamy 雪花ラミィ | 3.41M | ✔ | hololive | F | JP |
| 14 | Tsunomaki Watame 角巻わため | 3.38M | ✔ | hololive | F | JP |
| 15 | Sakura Miko さくらみこ | 3.32M | ✔ | hololive | F | JP |
| 16 | Fuwa Minato 不破湊 | 3.30M | ✔ | NIJISANJI | M | JP |
| 17 | Hakui Koyori 博衣こより | 3.30M | ✔ | hololive | F | JP |
| 18 | Sakamata Chloe 沙花叉クロヱ | 3.22M | ✔ | hololive (graduated 2025) | F | JP |
| 20 | Inugami Korone 戌神ころね | 3.11M | ✔ | hololive | F | JP |
| 21 | Kagami Hayato 加賀美ハヤト | 3.08M | ✔ | NIJISANJI | M | JP |
| 23 | Mori Calliope | 3.04M | ✔ | hololive EN | F | EN |
| 25 | Shirogane Noel 白銀ノエル | 3.03M | ✔ | hololive | F | JP |
| 28 | Shiranui Flare 不知火フレア | 2.94M | ✔ | hololive | F | JP |
| 29 | Takanashi Kiara | 2.83M | ✔ | hololive EN | F | EN |
| 30 | Oozora Subaru 大空スバル | 2.81M | ✔ | hololive | F | JP |
| 31 | **Nekomata Okayu 猫又おかゆ** | 2.80M | ✔ | hololive | F | JP |
| 33 | **Vox Akuma** | 2.65M | ✔ | NIJISANJI EN | M | EN |
| 34 | **Kanae 叶** | 2.61M | ✔ | NIJISANJI | M | JP |

Deeper cuts (same cache): Towa #49, kson (indie) #51, Fubuki #52, Gura #54, Saegusa Akina #58, Leos Vincent #65, Ibrahim #67, Lauren Iroas #68, **Suou Patra (indie) #73**, Suisei #76, IRyS #78. The VTuber-only chart (`_cache/playboard/most-superchatted-v-tuber-channels-in-worldwide-total.txt`, <https://playboard.co/en/youtube-ranking/most-superchatted-v-tuber-channels-in-worldwide-total>) confirms the same ordering with non-VTubers stripped.

**Takeaway**: of the top ~30 super-chatted channels *ever*, 23 are VTubers; hololive JP females dominate, with NIJISANJI males (Kuzuha, Fuwa, Kagami, Kanae) and NIJISANJI EN's Vox Akuma as the male high-water marks. Corroborating press: Playboard's 2020 "world's biggest super-chat earner is Kiryu Coco" ([tweet](https://x.com/anime/status/1297228301979836421)), Crunchyroll on Playboard's 2020 top-30 VTuber earners ([article](https://www.crunchyroll.com/ko/news/latest/2021/1/1/hololives-top-vtubers-brought-in-over-500-million-yen-in-just-super-chats-in-2020)), Anime Corner on Rushia topping the all-time list ([article](https://animecorner.me/hololive-vtubers-dominate-top-10-list-of-most-super-chats-received/)), Wikipedia's hololive entry citing Playboard ([link](https://en.wikipedia.org/wiki/Hololive_Production)).

### Recent pulse — Jun 2026 monthly (Playboard, cached)

Sources: worldwide <https://playboard.co/en/youtube-ranking/most-superchatted-all-channels-in-worldwide-monthly>, Japan <https://playboard.co/en/youtube-ranking/most-superchatted-all-channels-in-japan-monthly> (cache: `_cache/playboard/most-superchatted-all-channels-monthly-jun2026.txt`).

- Worldwide monthly top-20 is now mostly Latin-American/religious/politics channels; VTubers present: **Nagisa Trout** (NIJISANJI, #14), **Kagami Hayato** (#17), **Watame** (#20).
- Japan monthly is still VTuber country: Nagisa Trout #2, Kagami Hayato #3, Watame #4, Chiyomi (あおぎり高校) #8, Sakayori Soma (NIJISANJI) #9, **Minase Rio (HOLOSTARS UPROAR!!) #10**, Patoneko (indie) #12, Kaida Haru #13, Hanabusa Miyabi (HOLOSTARS) #15, Hibachi Mana #16, Aruran #17, Pota (Varium) #19, Mizumiya Su (hololive FLOW GLOW) #20.
- Signal: male-VTuber super-chat weight has shifted toward NIJISANJI JP males + HOLOSTARS; hololive JP female all-timers still chart monthly (Watame).

## ASMR-active shortlist (voice-quality beloved, verified public ASMR output)

Seeds from Arthur's taste data (`data/youtube-liked-asmr-refs/20260624/`): Vox Akuma (2 binaural ASMR m4a archived) and Kurune Kokuri 来音こくり (ear-cleaning ASMR metadata archived).

| Name | Agency | Gender | Lang | Voice description | ASMR evidence |
|------|--------|--------|------|-------------------|---------------|
| **Vox Akuma** | NIJISANJI EN | M | EN | Deep gravel-velvet bass, slow deliberate pacing, close-mic whisper mastery | Dedicated BINAURAL ASMR series; RP ASMR at 1.1M views ([channel](https://www.youtube.com/channel/UCckdfYDGrjojJM28n5SHYrA)); "often broadcasts ASMR… based on his unique low-pitched voice" ([namu](https://en.namu.wiki/w/%EB%B3%B5%EC%8A%A4%20%EC%95%84%EC%BF%A0%EB%A7%88)) |
| **Kanae 叶** | NIJISANJI | M | JP | Soft young-male tenor, "healing/fluffy" delivery, intimate binaural chats | Monthly バイノーラル雑談 series ([PeakX ASMR index](https://www.peakx.net/en/nijisanji/channels/UCspv01oxUFf_MTSipURRhkA/asmr)) |
| **Nekomata Okayu 猫又おかゆ** | hololive | F | JP | Low rounded alto, husky-sweet, warm whisper | 51 ASMR VODs indexed ([vinforadar](https://ckworks.jp/vinforadar/vtuber/%E7%8C%AB%E5%8F%88%E3%81%8A%E3%81%8B%E3%82%86/label/ASMR)); KU-100 uploads 1.1–2.8M views; fan voice-guide ([ekusu-chan](https://ekusu-chan.com/nekomata_okayu/)) |
| **Ceres Fauna** | hololive EN (grad. 2025-01) | F | EN | Gentle mid-high, controlled sibilance, "healing mommy" soft-spoken register | VTuber Awards **Best ASMR 2023** ([namu](https://en.namu.wiki/w/%EC%84%B8%EB%A0%88%EC%8A%A4%20%ED%8C%8C%EC%9A%B0%EB%82%98)) + **Best RP/ASMR 2024** ([results](https://www.reddit.com/r/VirtualYoutubers/comments/1hee4mz/all_the_nominations_and_winners_of_the_vtuber/)) |
| **Kurune Kokuri 来音こくり** | indie | F | JP | Feather-light zero-distance whisper, breathy-sweet, KU100 | ASMR-only channel, 401+ uploads ([index](https://asmr.mintparm.jp/channel/UC2rIXE0D3Vb8kS48DQrW-Jg)); "ささやきだけで眠くなる…癒しボイス" ([userlocal](https://live-ranking.userlocal.jp/youtuber/45BBDBEADD142D5D_32afc4)) |
| Suou Patra 周防パトラ | indie (ex-774inc/HoneyStrap) | F | JP | Seductive-soft mature female, ASMR craftswoman (own KU100 rig); "ASMR 160K DL" in her own bio | Playboard all-time #73 (cache); [wiki](https://virtualyoutuber.fandom.com/wiki/Suou_Patra), [X bio](https://x.com/Patra_HNST), [DLsite feature](https://www.j-asmr-wiki.com/features/voice-actress-suou-patra) |
| Ike Eveland | NIJISANJI EN | M | EN | Calm low-mid male voice, ASMR regular | $74,671 super chats in Jan 2022 alongside Vox's $74,863 ([Playboard via r/Nijisanji](https://www.reddit.com/r/Nijisanji/comments/sikndn/top_60_nijisanji_superchats_january_2022/)) |
| Minase Rio 水無世燐央 | HOLOSTARS UPROAR!! | M | JP | Low sultry male voice, ASMR-heavy output | Japan monthly super-chat #10, Jun 2026 (cache) `[ASMR verified only via title listings; deeper check pending]` |

## Download manifest — `data/voice-refs/` (gitignored)

All fetched 2026-07-03, `yt-dlp -f bestaudio --write-info-json`, concurrency 1, 18–26 s inter-download sleeps. Every dir carries `NOTES.md` with who/agency/language/voice rationale/link + license/consent note.

| Dir | Talent (gender/lang) | Video | Duration | Size |
|-----|----------------------|-------|----------|------|
| `vox-akuma/` | Vox Akuma (M/EN) | [Hypnotherapy CD For Sleep & No Stress【BINAURAL ASMR】](https://www.youtube.com/watch?v=DbdYdEd9Ql4) | 61m49s | 62.1 MB opus + info.json |
| `kanae/` | Kanae (M/JP) | [Kanae Binaural 2月号](https://www.youtube.com/watch?v=jlnUx6Y63sU) | 51m01s | 50.6 MB opus + info.json |
| `nekomata-okayu/` | Okayu (F/JP) | [【ASMR】一週間を頑張る君へ… 耳かき/吐息/囁き](https://www.youtube.com/watch?v=RmbJFdH5kdM) | 59m13s | 52.4 MB opus + info.json |
| `ceres-fauna/` | Fauna (F/EN) | [【KU100 ASMR】 Elf ASMR ♡ Whispers](https://www.youtube.com/watch?v=zfqoSzt69_k) | 48m28s | 49.6 MB opus + info.json |
| `kurune-kokuri/` | Kokuri (F/JP) | [【ASMR/KU100】密着囁きと癒しの吐息&耳かき](https://www.youtube.com/watch?v=aulfoToFxBM) | 76m01s | **partial** — audio-only formats 403 on her channel (also in 06-24 run); HLS mp4 fallback was mid-download (~484 MB .part) at wrap-up; info.json complete; recovery command in its NOTES.md |

Complete: 4 dirs (2 male, 2 female) + 1 partial. None <30 min — these talents simply don't publish short ASMR; picks favored whisper-density over brevity within the shortest available.

## Ethics / consent (applies to every artifact here)

Samples are personal, local prototyping references for a private entertainment bot. Real people's voices are their identity: any clone trained on these stays on this machine, is never published, never commercialized, never passed off as the performer, and is deleted on request. Nothing here was accessed behind auth; member-only content was excluded.

## Clone-lane next steps

Per `tts-stt-survey.md` TTS #2: F5-TTS (f5-tts-mlx) does zero-shot voice matching from a **5–10 s reference clip** ([f5-tts-mlx](https://github.com/lucasnewman/f5-tts-mlx)). Next: for each sample, cut 3–4 candidate 5–10 s clips of *clean whispered/soft speech* (no ear-brushing foley, no BGM — e.g. Vox's hypnotherapy intro monologue, Fauna's trigger-intro whispers, Okayu's 囁き segment, Kanae's chat lulls) via ffmpeg, normalize to -16 LUFS mono 24 kHz, and A/B them through f5-tts-mlx for register match; keep the winner as the persona's "soft mode" reference. Note F5 weights are CC-BY-NC-4.0 — fine for this private lane. Chatterbox (`exaggeration` dial) is the backup engine if F5's ~4 s/utterance generation is too slow even for pre-rendered lines; finish the Kokuri fetch for the pure-whisper JP female reference.
