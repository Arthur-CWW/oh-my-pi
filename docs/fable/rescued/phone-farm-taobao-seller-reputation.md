> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-automations/2026-07-06T01-39-37-694Z_019f3514-b65e-7000-84fa-412d5ffaa2b8/local/phone-farm-taobao-seller-reputation.md

# Phone-Farm Taobao Sourcing — Seller Reputation & Social-Proof Layer

Author: TaobaoPhoneScout. Extends the hardware shortlist already yielded to Main.
Scope: research/tracking only — no purchase, checkout, captcha/login bypass.

## 0. Why this layer / access note

Taobao search results are **login-gated** (probed `s.taobao.com/search` live → "亲，请登录",
no product grid without auth) and Tmall/Taobao heavily bot-protect DSR/sold/review data.
Per the no-bypass constraint I did **not** log in or defeat the wall, so live per-listing
numbers must be captured at cart time under the user's own logged-in session.
What follows is therefore: (a) a concrete signal rubric + thresholds, (b) named reputable
brand/official stores per category with buy/avoid calls, (c) the exact fields to record.
Observed social-proof snippets (from search, thin) are labelled `[OBSERVED]`; everything
else is `[FRAMEWORK]` domain judgement.

## 1. Reputation signals to record per candidate (with thresholds)

1. **店铺评分 / DSR** — three sub-scores: 宝贝描述 (item-as-described), 卖家服务 (service),
   物流 (logistics), each /5. **Colour matters**: a RED number = above category average (good);
   GREEN = below average (caution). Threshold: prefer all three ≥ 4.8 **and red**. Any green sub-score → downgrade.
2. **Store type / grade** — trust order: 天猫 品牌旗舰店/官方店/授权专卖 (brand-authorised, 7-day
   no-reason return mandatory) > 天猫店 > 淘宝 C店 by 信誉 icons (心 hearts < 钻 diamonds <
   蓝冠 blue-crown < 金冠 gold-crown). Prefer Tmall official/flagship or 皇冠/金冠 C-shops. For
   branded parts, prefer the **brand's own 官方旗舰店**, not a reseller.
3. **销量** — 月销 (monthly) + 累计销量 (cumulative). Rough floors: commodity parts (cables, hubs,
   adapters, stands, fans) prefer ≥ 500 cumulative / ≥ 100 monthly; niche dev boards ≥ 100 cumulative OK.
4. **评价** — 累计评价数 + 有图评价 (photo reviews) + 追评 (follow-up-after-use). Prefer ≥ 100 reviews
   with visible 有图 and positive 追评. **Read 中差评** (neutral/negative) specifically for the failure
   mode you care about: "不识别 / 键鼠无效 / 掉线 / 苹果不能用 / 充电不能传数据 / 系统更新后失效".
5. **店铺年限 (store age)** — prefer ≥ 2 yrs. New store (< 6 mo) + huge sales = 刷单 (fake-order) risk.
6. **退换政策** — 7天无理由退换 (mandatory on Tmall; verify on C-shop) + 运费险 (shipping insurance) is a plus.
   Critical for adapters/cables where a charge-only surprise needs a return.
7. **问大家 (buyer Q&A)** — search farm-relevant Qs: "能接键盘鼠标吗 / 苹果能用吗 / 支持数据传输吗 / N16R8真的吗".
8. **刷单 red flags** — sales spike + generic 5-star one-liners + no 有图 + brand-new store + price far below market.

## 2. Per-category reputable stores + buy/avoid

| Category | Prefer (reputable brands / official stores) | Buy / Avoid call |
|---|---|---|
| **ESP32-S3 board** | 微雪 Waveshare 官方旗舰店, 安信可 Ai-Thinker 官方, 合宙 Luat, DFRobot, 立创/嘉立创 LCSC-JLC | **BUY** brand/official even at +¥10 (genuine WROOM-1, real 16MB/8MB). **AVOID** unrated C-shop selling "N16R8" at ~¥20 with <50 sales — relabeled N8/fake-PSRAM is common. Verify PSRAM via 问大家/追评. |
| **CH9329 module** | Stores showing WCH/沁恒 logo; 立创商城 LCSC; sellers with HID-confirmed reviews | **BUY** store with ≥200 reviews explicitly confirming 模拟键盘鼠标/HID works. **AVOID** modules labelled only 串口/CDC. |
| **Lightning camera/OTG adapter** | Apple 授权专卖 (genuine); MFi brands 绿联 UGREEN, 毕亚兹 Biaze, 安克 Anker, 品胜 PISEN | **BUY** brand MFi 旗舰店 with cert photo + 键鼠 support (¥40-90). **CAUTION** budget clone even w/ good reviews (may die on iOS update — check 追评 for "更新后失效"). **AVOID** no-brand ¥14 w/o 键鼠 mention. |
| **USB-C OTG / data cable** | 绿联 UGREEN, 毕亚兹 Biaze, 山泽 Samzhe, 品胜 PISEN, Anker (官方旗舰店) | **BUY** brand flagship stating 全功能/USB2.0/数据. **AVOID** 快充线 with no data spec. |
| **Powered data hub (per-port switch)** | 西普莱 sipolar (industrial 群控/刷机 specialist — official store), 绿联 UGREEN, 优越者 UNITEK, 奥睿科 ORICO | **BUY** sipolar 官方 (device-lab grade ¥160-250) or UGREEN/UNITEK 旗舰 (¥129-169). **AVOID** sub-¥40 7-port no-brand (bus-powered/charge-only). |
| **USB switch / smart plug** | 米家 Mijia, 涂鸦 Tuya, 公牛 BULL (strips), 绿米 Aqara, 易微联 Sonoff | **BUY** 米家/公牛/Tuya official with energy metering. Low risk. |
| **Phone stand / rack** | 天猫 store ≥500 sales w/ 有图 reviews showing sturdiness; 绿联 exists | **BUY** any Tmall w/ good photo reviews. Low stakes. |
| **Cooling fan** | 九州风神 DEEPCOOL, 超频三 PCCOOLER (120mm); generic USB fans OK | **BUY** DEEPCOOL/PCCOOLER for reliability; generic USB fans acceptable. |
| **OTG box (手机农场/群控)** | — | **AVOID regardless of reputation** — gray-use closed 上位机 software, unauditable. Prefer DIY ESP32-S3. Only if forced: seller >1yr + high sales + visible support. |

## 3. Observed social-proof snippets [OBSERVED — thin, verify live]

- CH9329+CH340 串口转USB HID 双头线 — Taobao top-list: "已售100以内件, 200+评价" (a mature listing exists).
- 西普莱 sipolar FS803 10口 USB3.0 分控 带电源 — has a full 用户购买反馈/评价 review section; ~¥211; appears in curated 淘宝逛一逛 topics (established SKU).
- 绿联 UGREEN 7口 分控 带电源 hub — ~¥161; store promises 48h 发货 (active brand store).
- 毕亚兹 Biaze 苹果 OTG 转接头 (Lightning→USB, lists 键盘鼠标/U盘) — ~¥14-27 (data-capable Lightning OTG does exist at low price when it names 键鼠).

## 4. "Reputable over cheapest" rule (the judgement)

- **Load-bearing data-path parts** (Lightning/USB-C adapters, powered data hubs, data cables): pay the
  brand premium. A ¥15 charge-only or fake-N16R8 surprise costs more in debugging + a return cycle than a
  ¥50 known-good part. Buy from brand 官方旗舰店 with high DSR + real photo/追评 reviews.
- **Non-critical parts** (stands, fans, cable ties): cheapest *reputable* (Tmall, ≥500 sales) is fine.
- When two listings tie on price, pick higher 累计销量 + more 有图评价 + longer store age + 天猫官方.

## 5. Fields to capture at cart time → tracker mapping

Populate the tracker's `sellers` + `listings` rows (schema-aligned):

- `sellers`: name (store name), marketplace (`taobao`|`tmall`), feedback_score (DSR e.g. "4.9/4.9/4.8 red"),
  location (发货地), returns_policy ("7天无理由 + 运费险"?), trust_notes (store_type, store_age_yrs, crown level).
- `listings` (per offer): seller, seller_feedback (DSR), returns_policy, risk_level (`low`/`med`/`high`),
  status (`candidate`/`shortlisted`/`rejected`), notes.
- Social-proof note fields to record in `notes` (or a `social_proof` column if added):
  `rating_dsr`, `monthly_sold`, `total_sold`, `review_count`, `photo_review_count`,
  `followup_sentiment`, `store_age_years`, `store_type`, `buy_avoid`.

## 6. Seller questions to ask via 旺旺 before shortlisting (EN/ZH)

- ESP32-S3: "这块是不是真 N16R8（16MB Flash / 8MB PSRAM）？原生USB口直连芯片吗？" (real N16R8? native USB direct to chip?)
- Lightning OTG: "苹果接键盘鼠标能用吗？支持数据不只是充电吗？iOS 最新版还识别吗？" (works for kbd/mouse HID? data not just charge? still works on latest iOS?)
- Hub: "带独立分控开关吗？外置电源多少V/A？上行是数据口不是充电口吧？" (per-port switch? external PSU V/A? upstream is data not charge?)
- Cable: "这条是数据线支持数据传输吗，不是纯充电线吧？" (data cable, not charge-only?)

## 7. Numeric reputation floors per category (buy/avoid gate)

| Category | DSR floor | Sales floor | Reviews floor | Store age | Hard avoid |
|---|---|---|---|---|---|
| ESP32-S3 board | ≥4.7 (描述≥4.7) | ≥100 月销 | ≥200, ≥15% 有图 | ≥2 yr | DSR<4.6, <50 sales, no 7天无理由 |
| CH9329 module | ≥4.6 | ≥20 月销 | ≥30, ≥2 有图 (chip visible) | ≥1 yr | chip marking blurred; title only 串口/CDC |
| Lightning OTG | ≥4.8 (描述≥4.8) | ≥30 月销 | ≥50, ≥20% 有图 (kbd/U盘 shown) | ≥3 yr | no MFi/键鼠 evidence; only shows charging |
| USB-C / data cable | ≥4.7 | ≥100 月销 | ≥100, ≥10% 有图 | ≥1 yr | 快充线 w/o 数据/USB2.0 |
| Powered data hub | ≥4.7 | ≥50 月销 | ≥100 (DC brick + switches shown) | ≥2 yr | called 充电站/充电HUB; no DC-brick photo |
| WiFi smart plug/strip | ≥4.7 | — | ≥200 | ≥1 yr | **no 3C认证 (CCC)** — mains safety, non-negotiable |
| Phone stand / fan | ≥4.6 | ≥30 | ≥20-50 有图 | ≥1 yr | <20 reviews |
| OTG box (群控) | ≥4.7 | — | ≥50, ≥5 追评 + ≥2 video | ≥3 yr | <2yr store, 0 video — but AVOID category anyway |

Reputation premium vs absolute-cheapest is ~¥5-20/item → across a 10-phone build ~¥150-250 (AU$32-53).
Cheap insurance against DOA parts and charge-only/fake-PSRAM traps.

## 8. Named official-store anchors (search by store name)

- ESP32-S3: **乐鑫官方旗舰店 (Espressif Official Tmall)** ¥48-60 genuine; **安信可官方店 (Ai-Thinker)** ¥40-55; 微雪 Waveshare; 立创商城 LCSC.
- CH9329: stores with WCH/沁恒 branding; 立创商城 LCSC.
- Lightning/USB-C adapters + cables: 绿联 UGREEN, 毕亚兹 Biaze, 倍思 Baseus, 安克 Anker, 品胜 PISEN, 罗马仕 ROMOSS, 山泽 Samzhe (all have Tmall 官方旗舰店).
- Powered hub: 西普莱 sipolar (industrial 群控/刷机), 绿联 UGREEN, 优越者 UNITEK, 奥睿科 ORICO.
- Smart plug/strip: 米家 Mijia, Gosund, 涂鸦 Tuya, 公牛 BULL, 易微联 Sonoff (S26 Tasmota-flashable), 绿米 Aqara.
- Fans: 九州风神 DEEPCOOL, 超频三 PCCOOLER.

## 9. Unfakeable pre-shipment verification (ESP32-S3 PSRAM/flash fraud)

PSRAM/flash fraud is rampant on clone boards: N8R2 relabeled as N16R8, PSRAM that boots but
fails under load, or PSRAM entirely absent. A yes/no "是8MB吗?" is uselessly easy to lie about.
**Ask the seller for a hardware readout screenshot** (cannot be faked by editing the listing):
```
esptool.py --chip esp32s3 --port <PORT> flash_id
```
Output must show `Detected flash size: 16MB` and (with PSRAM query) `8MB` PSRAM. Request:
"能发一张 esptool flash_id 的截图吗？要看到 16MB flash 和 8MB PSRAM。" On arrival, re-run it yourself.
Caveat: the CP2102 UART on cheap clones is sometimes a relabeled CH340/CH341 — harmless for HID
(native USB is separate) but can cause bulk-flashing driver hiccups. Genuine CP2102/FTDI is another
reason to pay the Waveshare/安信可/LCSC premium over the ¥27-35 lottery clones.
