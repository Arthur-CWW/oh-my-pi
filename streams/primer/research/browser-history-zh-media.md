# Browser-history zh media forensics

**Scope.** Read-only copies were queried; no browser profile was modified. Sources copied to `/tmp/arthur-browser-history-forensics/` before querying:

- Chrome `Default/History` (8,803 visits; 2026-04-28 09:32:10 through 2026-07-16 21:47:22)
- Chrome `Guest Profile/History` (empty)
- Chrome `Default/History.db` (supplementary database found beside `History`; 217,441 visits; 2025-03-13 18:04:08 through 2025-06-11 17:01:20)
- Firefox `jsobtawl.default-release-1758944537323/places.sqlite`, with its `-wal` and `-shm` copied too (137,928 visits; 2026-03-26 13:48:42 through 2026-07-15 12:51:59)

Timestamps below are local time from the SQLite timestamps. A history visit proves a page was opened; it does **not** prove playback duration or completion.

## 1. Vertical-drama investigation

### Verdict: not identified in the real histories

No URL/title match for the exact Chinese terms `短剧`, `竖屏`, `穿越`, `博士`, `抖音`, `红果`, `快手`, `douyin`, `hongguo`, `kuaishou`, or their literal percent-encoded URL forms was found for a drama page in either standard Chrome `History`, supplementary Chrome `History.db`, or Firefox `places.sqlite`. Candidate-name searches for `家里家外` and `逃出大英博物馆` were also empty. Generic platform checks found **0 iQiyi URLs, 0 Tencent video URLs, and 0 Youku video URLs** in Firefox; the sole `qq.com` hit was an unrelated Weixin Official Accounts page.

Every plausible short-drama-related history hit found:

| URL | Title | Visit time(s) | Assessment |
|---|---|---|---|
| https://www.youtube.com/watch?v=EnAC_RVdd3Q&t=114s | Can Short Dramas Really Make $100M? China’s Global Formula in Short Drama Industry - YouTube | 2026-04-06 21:16:32 (Firefox) | Industry explainer, not an identifiable drama |
| https://x.com/tphuang/status/2069568416256573560 | tphuang on X: “As ByteDance/Seed team is releasing new models… China’s short drama industry took a sudden turn…” | 2026-06-25 10:19:15, 10:19:46 (Firefox) | Generic industry discussion; no title |
| https://www.douyin.com/ | 抖音-记录美好生活 | 2026-06-09 21:12:30 (Firefox) | Platform landing page |
| https://www.douyin.com/jingxuan | 抖音精选电脑版 - 抖音旗下优质视频平台 | 2026-06-09 21:12:36, 22:48:47 (Firefox) | Platform landing page; no drama title |
| https://www.douyin.com/jingxuan?modal_id=7634535245555594875 | 抖音精选电脑版 - 抖音旗下优质视频平台 | 2026-06-09 22:48:42, 22:48:47 (Firefox) | Generic modal; no drama title |
| https://www.douyin.com/jingxuan?modal_id=7638526811265109299 | 抖音精选电脑版 - 抖音旗下优质视频平台 | 2026-06-09 22:48:46 (Firefox) | Generic modal; no drama title |
| https://www.douyin.com/user/MS4wLjABAAAAaCJY_PGQHA3Xvj0Ozf3clwa8d1Ck88N5HDd_FRTJ9Ng | (no title) | 2026-06-30 18:50:20 (Firefox) | User page; no drama title |
| https://x.com/xiaoyueyue520 | 抖音😍快手各网红（接推广） (@xiaoyueyue520) | 2025-06-03 22:29:40, 22:29:44, 22:29:51, 22:29:53 (Chrome `History.db`) | Influencer profile, not a drama |

The standard Chrome profile also had only a generic `bilibili.com` visit/search cluster and no drama-title match. No Red Fruit/Hongguo or Kuaishou URL was found.

### Web cross-check and ranking against the memory

The required web search (`竖屏短剧 穿越 博士 获奖`, plus targeted follow-ups) produced these candidates. **None occurred in the copied histories**, so this is a semantic ranking, not an identification:

1. **《权御山河》 — strongest plot match, but not history-confirmed.** Web results describe a Tencent vertical short drama whose protagonist is a **history PhD and military uploader** who time-travels to the Five Dynasties. Sources: [Douban](https://movie.douban.com/subject/38384508/), [Tencent episode page](https://v.qq.com/x/cover/mzc003i4uqig68y/i3269h1xf7o.html), [launch/vertical-chart report](https://www.toutiao.com/article/7645343548593668627/). The web evidence supports “history PhD + time travel + vertical”; it supports chart success, not a clear award win.
2. **《开局摊牌，我是穿越者》 — strong PhD/time-travel match, no award evidence found.** A 64-episode 2025 short drama about modern history PhD 沈念之 time-traveling into an ancient general’s household. Sources: [Baidu Baike](https://baike.baidu.com/item/%E5%BC%80%E5%B1%80%E6%91%8C%E7%89%8C%EF%BC%8C%E6%88%91%E6%98%AF%E7%A9%BF%E8%B6%8A%E8%80%85/66302179), [Douban](https://m.douban.com/movie/subject/37331982/), [Bilibili recommendation](https://www.bilibili.com/video/BV1U8Jgz3E2M/).
3. **《历史学博士穿越古代，现代知识步步登天》 — plot wording matches, but appears to be a generic iQiyi short-video upload, not a securely identified award-winning series.** [iQiyi](https://www.iqiyi.com/v_fdyqy5hmtg.html).
4. **《家里家外》 — award/vertical match, plot mismatch.** Search results describe a 79-episode vertical drama and report its 50th industry award, but explicitly say it is a “生活流” family story with **no time travel**. [Tencent/News](https://news.qq.com/rain/a/20250321A071E400), [Sohu award report](https://www.sohu.com/a/1040863837_121948396).
5. **《逃出大英博物馆》 — short-drama/award context, plot mismatch.** It is a three-episode network micro-drama about a personified Chinese jade vessel escaping the museum, not a PhD/classics-history scholar. [Baidu Baike](https://baike.baidu.com/item/%E9%80%83%E5%87%BA%E5%A4%A7%E8%8B%B1%E5%8D%9A%E7%89%A9%E9%A6%86/63387336), [award report](https://www.sznews.com/news/content/2024-01/14/content_30698647.htm).

**Bottom line:** if the memory is accurate, `《权御山河》` is the closest web candidate, but the real-browser evidence does not establish that Arthur watched or discussed it. Per the acceptance criterion, the defensible verdict is **not found in the checked histories** rather than a forced identity.

## 2. Bilibili/cartoon evidence

### 大耳朵图图

Direct episode-page visits are extensive and strongly indicate opening this show (but not completion). Canonical URLs below collapse tracking-query variants; timestamps include every observed direct-page visit for that URL family.

**Season 1:**

- [BV16c6bB2E2C](https://www.bilibili.com/video/BV16c6bB2E2C) — 《出生的秘密》01 — 2026-05-29 14:48:22, 14:54:45, 14:55:12.
- [BV11wFVzbEs7](https://www.bilibili.com/video/BV11wFVzbEs7) — 《让图图害怕的人（上）》03 — 2026-06-01 11:15:06.
- [BV1TqfzBqEkQ](https://www.bilibili.com/video/BV1TqfzBqEkQ) — 《护绿小天使》22 — 2026-06-01 11:15:13.
- [BV1bgZXBzEuQ](https://www.bilibili.com/video/BV1bgZXBzEuQ) — 《住家小病号》18 — 2026-06-02 10:15:22.
- [BV11fZrBTEsj](https://www.bilibili.com/video/BV11fZrBTEsj) — 《全家享用自助餐》19 — 2026-06-02 10:26:42.

**Season 2:**

- [BV1BLqLYBEuQ](https://www.bilibili.com/video/BV1BLqLYBEuQ) — 《第一天上幼儿园（上）》01 — 2026-05-29 15:31:27, 15:31:29, 16:22:59, 16:23:03.
- [BV1CcqmYME8s](https://www.bilibili.com/video/BV1CcqmYME8s) — 《第一天上幼儿园（下）》02 — 2026-05-29 16:35:20.
- [BV19f6uYRETQ](https://www.bilibili.com/video/BV19f6uYRETQ) — 《小豆班的战争》03 — 2026-05-29 16:46:21.
- [BV1ExqYYREqg](https://www.bilibili.com/video/BV1ExqYYREqg) — 《奇怪的友谊》04 — 2026-05-29 16:59:10.
- [BV1KfkiYtEkC](https://www.bilibili.com/video/BV1KfkiYtEkC) — 《伟大的妈妈》15 — 2026-05-29 15:23:44, 15:23:46 (Firefox) and 2026-07-16 21:38:18, 21:38:22 (standard Chrome).
- [BV1FGC3Y2Eor](https://www.bilibili.com/video/BV1FGC3Y2Eor) and [BV1BFCGYCEgA](https://www.bilibili.com/video/BV1BFCGYCEgA) — 《图图家的非常时期》16 — 2026-05-29 15:37:24, 15:51:08.
- [BV1j2kQYQEE8](https://www.bilibili.com/video/BV1j2kQYQEE8), [BV1PBkdYCEja](https://www.bilibili.com/video/BV1PBkdYCEja), [BV1RuCAY1ErC](https://www.bilibili.com/video/BV1RuCAY1ErC), [BV13BCPY1EQj](https://www.bilibili.com/video/BV13BCPY1EQj), [BV1JpCBY9Eq2](https://www.bilibili.com/video/BV1JpCBY9Eq2) — 《全托第一天（上）》18 — 2026-05-29 16:04:51, 16:18:31, 16:32:14, 16:45:58, 16:59:33.
- [BV11vCzYeENV](https://www.bilibili.com/video/BV11vCzYeENV) — 《永远的朋友（上）》23 — 2026-05-29 17:13:04.
- [BV152CyYaEAa](https://www.bilibili.com/video/BV152CyYaEAa) — 《永远的朋友（下）》24 — 2026-05-29 17:26:41.
- [BV176CyYiEM8](https://www.bilibili.com/video/BV176CyYiEM8) — 《王子来做客》25 — 2026-05-29 17:40:16.
- [BV1rJ67YsEAu](https://www.bilibili.com/video/BV1rJ67YsEAu) and [BV1mq4y1u7jq](https://www.bilibili.com/video/BV1mq4y1u7jq) — 《过年真快乐》26 — 2026-05-29 17:53:54, 18:07:37.

**Season 4 / other 图图 pages:**

- [BV1SWGB6WExX](https://www.bilibili.com/video/BV1SWGB6WExX) — 《和图图一样》S4 — 2026-05-29 14:48:14; 2026-05-30 16:26:22, 16:26:23.
- [BV1nRLM6aEAi](https://www.bilibili.com/video/BV1nRLM6aEAi) — 《减肥真浪费（上）》S4 — 2026-05-29 14:54:57, 15:11:06; 2026-06-01 08:55:49, 11:13:05; 2026-06-02 10:15:14.
- [BV1dYL26cEPu](https://www.bilibili.com/video/BV1dYL26cEPu) — 《减肥真浪费（下）》S4 — 2026-06-01 09:07:23.
- [BV1bxG46WEM5](https://www.bilibili.com/video/BV1bxG46WEM5) — 《理发真舒服》S4 — 2026-05-30 16:26:32; 2026-06-01 08:55:48, 08:55:50, 11:00:05, 11:00:10, 14:14:12, 14:14:18.
- [BV1XrVw6FEeN](https://www.bilibili.com/video/BV1XrVw6FEeN) — 《刷子妈妈来电话》S4 — 2026-05-30 16:38:02; 2026-06-01 11:14:06, 14:20:54.
- [BV1AuV86dEmw](https://www.bilibili.com/video/BV1AuV86dEmw), [BV1sWjbz7EfV](https://www.bilibili.com/video/BV1sWjbz7EfV), [BV1mq4y1u7jq](https://www.bilibili.com/video/BV1mq4y1u7jq) — 《虫虫特工队》S4 — 2026-05-31 17:07:52, 17:07:57; 2026-06-01 11:32:30, 11:37:57, 11:50:52, 14:22:39.
- [BV1J3516YEUp](https://www.bilibili.com/video/BV1J3516YEUp) — 《小怪和拉布拉多》S4 — 2026-05-31 17:21:52; 2026-06-01 11:00:10.
- [BV19PGC6kEby](https://www.bilibili.com/video/BV19PGC6kEby) — 《自由的脚丫》S4 — 2026-06-01 11:18:41.
- [BV1tWV96YEs8](https://www.bilibili.com/video/BV1tWV96YEs8) — 《安全最重要（上）》S4 — 2026-06-01 14:24:41.
- [BV1vWVnzeE86](https://www.bilibili.com/video/BV1vWVnzeE86) — 《月饼大作战》 — 2026-06-02 10:15:14, 10:15:16.

Search-page evidence: Bilibili searches for `大耳朵图图` occurred repeatedly from 2026-05-29 through 2026-06-02; these are search visits, not additional episode evidence.

### 小猪佩奇

- [BV1EZYwemEDT](https://www.bilibili.com/video/BV1EZYwemEDT) — Peppa Pig 小猪佩奇英文原版 - Bubbles（每日更新） — 2026-05-29 14:47:15, 14:48:04, 14:54:45.
- [BV1UQzABQEJE](https://www.bilibili.com/video/BV1UQzABQEJE), [BV1Lvq3BUEQj](https://www.bilibili.com/video/BV1Lvq3BUEQj), [BV1iQzpBWEMZ](https://www.bilibili.com/video/BV1iQzpBWEMZ) — 佩奇一家去游泳 / 完整剧集 — 2026-05-29 15:02:07, 15:02:12, 15:05:28, 15:05:32; 15:02:17, 15:02:40; 15:05:38.
- [BV1RTm8YiERF](https://www.bilibili.com/video/BV1RTm8YiERF) — 小猪佩奇｜合集 — 2026-05-29 15:03:06, 15:03:09.
- [BV1ektJzYE8W](https://www.bilibili.com/video/BV1ektJzYE8W) — 第一季52集全、中英双语、精读笔记 — 2026-05-29 15:03:54, 15:03:56; the same video with `p=2` was opened at 15:04:09 and titled `小猪佩奇第2集`.
- [BV1Fbx8zKExv](https://www.bilibili.com/video/BV1Fbx8zKExv) — 第1–9季全集（英文版） — 2026-05-29 15:03:55, 15:03:57.
- [BV1osAmzHEQU](https://www.bilibili.com/video/BV1osAmzHEQU) — 小猪佩奇免费看带娃必备 — 2026-05-29 15:03:57, 15:04:00.
- [BV1xawkzEEPc](https://www.bilibili.com/video/BV1xawkzEEPc) — 小猪佩奇第二季 — 2026-05-29 15:05:30, 15:05:31.

Chrome standard also records Google/Bilibili searches for `peppa pig` at 2026-05-26 23:41:05–23:41:23, but no Peppa episode page in that Chrome database.

### Other direct animation/episode pages

- Chrome supplementary `History.db`: [凸变英雄X PV1](https://www.bilibili.com/bangumi/play/ep693311) — 2025-05-11 17:20:41, 17:21:34, 17:22:33, 17:22:34 (six visits total).
- Firefox: [式守同学不只可爱而已第1集](https://www.bilibili.com/bangumi/play/ep508401) — 2026-05-29 18:25:10; [大道朝天第1集](https://www.bilibili.com/bangumi/play/ep836549) — 18:39:01; [伍六七之记忆碎片第1集](https://www.bilibili.com/bangumi/play/ep836525) — 2026-06-01 21:45:52; [爱上她的理由第1集](https://www.bilibili.com/bangumi/play/ep740457) — 2026-06-26 14:55:55.
- Firefox: [无职转生同人动画：血契之约](https://www.bilibili.com/video/BV1miHfzEET2/) — 2026-07-07 22:27:22, 22:27:26; [崩铁16+动画：乱破的一天](https://www.bilibili.com/video/BV1yVS3YqERe/) — 22:39:26, 22:39:28; [无职同人动画：勇者](https://www.bilibili.com/video/BV1XnUKYYEoS/) — 22:41:46, 22:41:48; [崩铁16+动画：飞霄的一天](https://www.bilibili.com/video/BV1y1tWeqEX2/) — 22:41:48, 22:41:50.

## 3. Chinese-learning inventory

### Dedicated sites and local learning surfaces

| URL | Title | Visit time(s) |
|---|---|---|
| https://duchinese.net/ | Du Chinese / Read and Learn Mandarin | 2026-05-26 17:51:09, 17:51:21; 2026-05-28 11:57:06 (Firefox) |
| https://duchinese.net/lessons/courses/147-famous-sayings-and-stories-from-the-three-kingdoms | Course / Famous Sayings and Stories from the Three Kingdoms / Du Chinese | 2026-05-26 17:51:25 (Firefox) |
| https://duchinese.net/lessons/2780-losing-the-bride-and-the-soldiers-too?from=course | Losing the Bride and the Soldiers Too / Du Chinese | 2026-05-26 17:51:28 (Firefox) |
| https://www.hackingchinese.com/how-to-reach-a-decent-level-of-chinese-in-100-days/ | How to reach a decent level of Chinese in 100 days / Hacking Chinese | 2026-05-30 16:56:18 (Firefox) |
| https://www.hackingchinese.com/ | Hacking Chinese / A better way of learning Mandarin | 2026-06-01 10:05:01 (Firefox) |
| http://localhost:8081/ | HSK Reader | 2026-05-26 19:39:25 through 2026-06-08 20:23:18 (17 visits; Firefox) |
| http://localhost:18765/render | HSK Card | 2026-05-28 11:43:42 (Firefox) |
| http://127.0.0.1:18765/render | HSK Card | 2026-05-28 12:29:36, 12:36:56 (Firefox) |
| http://127.0.0.1:18888/ | HSK Sentence Review | 2026-06-01 12:03:29 (Firefox) |
| https://www.pleco.com/ | Pleco Software – Chinese dictionary app | 2026-05-26 11:37:44 (Firefox) |
| https://www.youdao.com/ | 网易有道 | 2026-05-16 20:32:05 (Firefox) |
| https://hsklord.com/dictionary/%E5%BE%97%E5%88%B0 | 得到 (dé dào) — to get / Chinese Dictionary / HSKLord | 2026-05-29 18:08:41 (Firefox) |
| https://www.hsklevel.com/ | Test how many Chinese words, characters and chengyu you know | 2026-05-29 13:22:03 (Firefox) |

### Translation, HSK, and sentence-mining materials

- Google Translate Chinese/Cantonese drills: `https://translate.google.com/?sl=auto&tl=yue&text=...` pages with Chinese sentences/words (for example `他在电话里跟我说了这件事。`, `超过`, `召唤`, `解决`) from 2026-05-26 12:24:20–12:43:28; 63 distinct Google Translate URLs / 63 visits in Firefox. Chrome supplementary `History.db` also shows Mandarin/Cantonese translation pages on 2025-04-22 15:18:38–15:18:47.
- Kagi Translate: `https://translate.kagi.com/?from=...&to=...&text=...` used heavily for Mandarin/Cantonese conversion, including `那些书是我的，不是你的。` at 2026-05-29 00:10:15, `正在` at 10:17:53, and Cantonese-to-Simplified Chinese examples at 11:38:13–12:50:18. Firefox totals: 250 distinct URLs / 250 visits, 2026-05-28 23:43:21–2026-07-06 16:06:54.
- HSK 5 resource run on Firefox, 2026-05-30 16:56:01–17:00:22: [HanyuAce](https://www.hanyuace.com/blog/conquering-hsk-level-5-journey-through-language-perseverance), [eChineseLearning](https://www.echineselearning.com/blog/master-the-leap-from-hsk4-to-hsk5-overcoming-challenges), [Nanyang Mandarin](https://nanyangmandarin.com.sg/blog/how-to-pass-hsk-5-your-comprehensive-guide-to-success/), [HSKMock](https://hskmock.com/en/blog/231.html), [ReadSavor](https://readsavor.com/blog/en/hsk5-real-world-reading), and [ImproveMandarin](https://improvemandarin.com/hsk-levels/).
- [Pleometric HSK deck](https://github.com/Pleometric/HSK-deck) — 2025-05-17 11:56:51, 11:57:02; 2025-05-24 23:47:35; 2025-05-26 11:10:25 (Chrome supplementary).
- [Complete HSK vocabulary lists](https://github.com/drkameleon/complete-hsk-vocabulary) — 2026-06-26 14:03:05 (Firefox).
- [Methods of Mandarin](https://isaak.net/mandarinmethods/) and [12 Months of Mandarin](https://isaak.net/mandarin/) — repeated visits 2025-04-07 through 2025-05-16 (Chrome supplementary), including sections on Pleco, radicals, FSRS, simplified/traditional, and listening-based cards.
- [Mandarin Companion](https://mandarincompanion.com/) — 2025-04-22 11:20:10; 2025-05-12 19:12:28 (Chrome supplementary).
- [Migaku: 6 Anki Decks That Will Actually Help You Learn Chinese](https://migaku.com/blog/chinese/best-chinese-anki-decks) — 2025-05-16 21:42:59, 22:04:57, 22:12:20 (Chrome supplementary).
- [Chinese sentence mining guide](https://imlearningmandarin.com/2022/07/03/your-ultimate-guide-to-chinese-sentence-mining-in-5-basic-steps/) — 2025-05-16 22:04:59 (Chrome supplementary).

### Mandarin-dubbed animation/search materials

The supplementary Chrome database also records a 2025-05-16 browsing session for Mandarin/Cantonese learning media: [Mandarin Chinese Anime/Donghua/Cartoons Index](https://docs.google.com/spreadsheets/d/15ePAgVgzODjoxxaxjTETXiPNlS7Kl6VqzroUJl2HNIU/htmlview#), [Fire Fly Mandarin Anime](https://fireflyanime.blogspot.com/p/mandarin-anime.html), and Mandarin-dub/subtitle pages for Frieren, Spy x Family, Mushishi, Mushoku Tensei, Urusei Yatsura, Evangelion, Chuunibyou, Jujutsu Kaisen, and Demon Slayer. These are acquisition/index pages, not proof that every listed show was watched.
