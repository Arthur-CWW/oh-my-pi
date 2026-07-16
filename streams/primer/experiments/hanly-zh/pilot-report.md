# Hanly → 简体中文字源试验报告

日期：2026-07-16  
状态：校准候选材料；**没有接入 ZhDict，也没有把结果当作权威**。

## 方法

- 数据源：`~/apps/hsk-deck/hanly-re/output/hanly-content.sqlite`，以只读方式打开。实际提取版本有 `characters`、`primitives` 等表；没有单独名为 `decomposition` 或 `etymology` 的表。字符的 `decomposition` 数组和英文 `story` 在 `characters.json` 中，部件的英文资料来自 `primitives` 表的 `meaning_informal`、`phonetic_name` 和 JSON `meaning`。
- 选择规则：`characters.hsk_level IN (1, 2)`、单 Unicode 字符、`frequency_rank` 非空，按 `frequency_rank ASC`；只保留有非空 `decomposition` 且有英文 `story` 的字符。结果是最高频的 50 个字符：

  `的 是 在 有 我 他 这 个 们 中 来 上 大 为 和 国 地 到 以 说 时 要 就 出 会 可 你 对 生 能 那 得 着 下 自 过 发 后 作 里 用 道 行 所 然 家 事 成 方 多`

- 运行器：`primer hanly-zh generate --limit 50`，逐字 `await`，并发为 1；模型取 `PRIMER_ENRICH_MODEL`（本次为 `google-antigravity/gemini-3.5-flash`），经过 `isForbiddenModel` 检查。Hanly 源库只读，生成结果写入 daemon ledger 的 `hanly_zh` 表。
- 输出检查：去掉可选 Markdown fence 后解析 JSON；检查 `char`、中文键、`信心` 枚举、`字源一句话` 不超过 30 字、`记忆提示` 以 `联想：` 开头，以及结果字段不能含拉丁字母。不满足就写入 `status=error`；错误行仍保存源资料和错误说明。
- 表字段：`char UNIQUE, source_summary, zh_explanation, components(JSON), model, status, created_at`。

## 使用的提示词（原文）

```text
你是给中文初学者讲汉字的老师。
只输出严格 JSON，不要 Markdown，不要前后解释，不要输出 JSON 以外的文字。
输出必须是简体中文；词语尽量使用 HSK 1-3 常用词。禁止英文、拼音和英文解释。
所有字源判断只能来自下面的 Hanly 输入资料，不能凭空补充历史；资料不够时写“暂无”。
字源一句话必须是简单中文，最多 30 个字。
记忆提示可以是帮助记忆的联想，但不是历史；必须以“联想：”开头，不能把联想说成字源。
输出格式必须完全是：{"char":"目标字","部件":[{"部件":"部件字","意思":"简单中文"}],"字源一句话":"……","记忆提示":"联想：……","信心":"高"|"中"|"低"}

目标字：
${char}
Hanly 分解：
${decomposition}
Hanly 部件资料：
${primitives}
Hanly 英文资料（只可据此判断，不要原样输出英文）：
${etymology}
```

`${char}`、`${decomposition}`、`${primitives}`、`${etymology}` 是每个字符运行时替换的输入槽；其余文字逐字不变。

## 运行结果

本次实际写入 **50 行：50 ok，0 error（错误率 0%）**。`ok` 只代表通过结构和语言护栏，不代表字源学正确。命令的人类摘要打印总数和前三个完整样例；`--json` 也会返回样例和全部行。

## 十个样例（Hanly 源资料紧邻生成结果）

### 1. 的

**Hanly 源：** 分解 `白、勺`。英文资料：`的 is THE most common Chinese character. It's a grammatical particle that indicates possession, the way 's does in "Hey, this is John's!" (我的 for "mine" or 你的 for "yours"). The components of 的 read as WHITE SPOON, so to remember it you can imagine a kid eating ice cream with a white plastic spoon and refusing to share: it's HIS and only his!`

**生成：**
```json
{"char":"的","部件":[{"部件":"白","意思":"暂无"},{"部件":"勺","意思":"暂无"}],"字源一句话":"暂无","记忆提示":"联想：小孩用白色的勺子吃冰淇淋，不给别人，说这是他的。","信心":"高"}
```

### 2. 是

**Hanly 源：** 分解 `日、𤴓`；部件 `𤴓` 的英文意思为 `correct`。英文资料：`This is the 3rd most common character, and it is used similarly to how "TO BE" is used in English. It's hard to give a mnemonic for such an abstract verb, but if it helps you can think of BEING STRAIGHT under the SUN.`

**生成：**
```json
{"char":"是","部件":[{"部件":"日","意思":"暂无"},{"部件":"𤴓","意思":"正确"}],"字源一句话":"暂无","记忆提示":"联想：可以想象是在太阳下站得很直。","信心":"高"}
```

### 3. 在

**Hanly 源：** 分解 `𠂇、㇑、土`；部件英文意思为 `by the side / stick`。英文资料：`Decomposition of this character is somewhat messy, but you can try to remember it as having the STICK in the GROUND BY YOUR SIDE, i.e. being AT specified location.`

**生成：**
```json
{"char":"在","部件":[{"部件":"𠂇","意思":"在旁边"},{"部件":"㇑","意思":"木棍"},{"部件":"土","意思":"土地"}],"字源一句话":"把木棍插在身边的土地里，表示物体在某个位置。","记忆提示":"联想：把一根木棍插在身边的泥土里，表示你正站在这里。","信心":"高"}
```

### 4. 有

**Hanly 源：** 分解 `𠂇、月`；部件 `𠂇` 的英文意思为 `by the side`。英文资料：`This character evolved from a drawing of a hand holding meat, a picture that still works for character's modern meaning: If you hold a piece of MEAT BY YOUR SIDE, it probably belongs to you, or you HAVE it.`

**生成：**
```json
{"char":"有","部件":[{"部件":"𠂇","意思":"手或侧旁"},{"部件":"月","意思":"肉"}],"字源一句话":"古文字像用手拿着肉，表示拥有。","记忆提示":"联想：手在身旁拿着一块肉，说明你拥有它。","信心":"高"}
```

### 5. 我

**Hanly 源：** 分解 `手、戈`。英文资料：`Remarkably, the character for I or ME in Chinese is written as a HAND holding a BATTLE AXE.`

**生成：**
```json
{"char":"我","部件":[{"部件":"手","意思":"手"},{"部件":"戈","意思":"战斧"}],"字源一句话":"这个字表示一只手拿着战斧。","记忆提示":"联想：我手拿武器保护自己。","信心":"高"}
```

### 6. 他

**Hanly 源：** 分解 `亻、也`；部件 `亻` 的英文意思为 `person`。英文资料：`You CALL a MAN HE.`

**生成：**
```json
{"char":"他","部件":[{"部件":"单人旁","意思":"人"},{"部件":"也","意思":"暂无"}],"字源一句话":"称呼一个人为“他”。","记忆提示":"联想：旁边站着一个人（亻），就是“他”。","信心":"高"}
```

### 7. 这

**Hanly 源：** 分解 `辶、文`；部件 `辶` 的英文意思为 `road`。英文资料：`This character's components read as WRITING on the ROAD. You can imagine a large X marked on the road, signifying "THIS is the spot!"`

**生成：**
```json
{"char":"这","部件":[{"部件":"辶","意思":"路"},{"部件":"文","意思":"暂无"}],"字源一句话":"这个字表示在路上写字。","记忆提示":"联想：在路上画一个大大的叉号，表示“就是这里”。","信心":"高"}
```

### 8. 个

**Hanly 源：** 分解 `𠆢、㇑`；部件英文意思为 `umbrella / stick`。英文资料：`个 is the most common classifier (aka counter word) character in Chinese, used for both people and objects, and 12th most common character in general, so you'll see it everywhere. You can see this character as an INDIVIDUAL person (STICK) strolling along with his UMBRELLA.`

**生成：**
```json
{"char":"个","部件":[{"部件":"𠆢","意思":"雨伞"},{"部件":"㇑","意思":"小木棍"}],"字源一句话":"暂无","记忆提示":"联想：一个人拿着雨伞在散步。","信心":"高"}
```

### 9. 们

**Hanly 源：** 分解 `亻、门`；部件 `亻` 的英文意思为 `person`。英文资料：`们 is a plural marker for pronouns, i.e. it turns "I" into "We", and "He" into "They". Imagine a PERSON opening the DOOR to a surprise party with many people.`

**生成：**
```json
{"char":"们","部件":[{"部件":"亻","意思":"人"},{"部件":"门","意思":"暂无"}],"字源一句话":"表示代词的复数，比如把“我”变成“我们”。","记忆提示":"联想：想象一个人打开门，看到里面有很多人在办惊喜派对。","信心":"高"}
```

### 10. 中

**Hanly 源：** 分解 `口、㇑`；部件英文意思为 `stick`。英文资料：`This character is just a LINE drawn right in the MIDDLE of a rectangle (MOUTH).`

**生成：**
```json
{"char":"中","部件":[{"部件":"口","意思":"暂无"},{"部件":"㇑","意思":"棍子"}],"字源一句话":"在长方形中间画一条线表示中间。","记忆提示":"联想：口中间穿过一根竖线，表示正中间。","信心":"高"}
```

## 质量评估（诚实版）

- **结构成功率高：** 50/50 行通过 JSON、字符一致、简体中文/无拉丁字母、30 字上限和 `联想：` 标记；0/50 进入 error。
- **保守性明显：** 19/50 的 `字源一句话` 是 `暂无`。这是比凭空编造历史更安全的结果，但说明输入英文资料与“字源”边界不清时，试验的教学收益有限。
- **有用样例：** `有` 和 `我` 把 Hanly 明确给出的“手拿肉”“手拿战斧”改成了短中文，同时把联想单独标记；这两个可以进入人工校准候选。
- **需要修订的信号：** `们` 的输出把“门”说成“表示读音”，但本次 Hanly 输入只给了“人开门的联想”，没有给出这个语音判断；不能直接保留为字源事实。部分“高”信心也偏乐观，尤其是 `暂无` 的行。`战斧`、`矩形`、`引申` 等词也可能超过简单中文目标。
- **结论：** 这批适合当作 Arthur 的校准候选，不适合自动写入卡片或作为字源权威。下一轮应把“历史/字源事实”和“Hanly 记忆联想”分成更严格的字段，并把 `暂无` 的高信心改成中/低，除非人工确认。

## Arthur 校准表（请填写）

| # | 字 | 保留 | 修改 | 拒绝 | Arthur 修改意见 |
|---:|:---:|:---:|:---:|:---:|:---|
| 1 | 的 | [ ] | [ ] | [ ] | |
| 2 | 是 | [ ] | [ ] | [ ] | |
| 3 | 在 | [ ] | [ ] | [ ] | |
| 4 | 有 | [ ] | [ ] | [ ] | |
| 5 | 我 | [ ] | [ ] | [ ] | |
| 6 | 他 | [ ] | [ ] | [ ] | |
| 7 | 这 | [ ] | [ ] | [ ] | |
| 8 | 个 | [ ] | [ ] | [ ] | |
| 9 | 们 | [ ] | [ ] | [ ] | |
| 10 | 中 | [ ] | [ ] | [ ] | |
