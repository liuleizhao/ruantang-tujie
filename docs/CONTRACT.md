# 软糖图解 · 引擎契约 v1

本文件是**接口契约**，由 Lead 维护，其他人只读。
`engine/`、`templates/`、`skills/`、`tests/` 都必须严格按此契约实现，任何一方不得单方面改动本文件。

---

## 0. 总体架构

```
人物照片  ──① 视觉理解(read_image) + ② 调色板量化(tools/analyze_photo.py)
              ↓
        toySpec.json  (造型规格：部件/比例/配色，人写的中间层，可读可改)
              ↓
   ┌──────────┴───────────┐
   │ GummyEngine.buildChart │   ③ 确定性换算：尺寸→圈数→针数
   └──────────┬───────────┘
              ↓
         chart.json  (逐圈图解 + 配色 + 用线量)
              ↓
   ┌──────────┴───────────┐
   │ GummyEngine.validate   │  ④ 自检：每圈消耗/产出守恒
   └──────────┬───────────┘
              ↓
   templates 渲染 →  单个自包含 HTML 交付
```

**关键原则**：所有针数一律由引擎计算，模型不得凭感觉手写针数。
模型只负责「造型语义」（这个部件是球还是柱、多高、什么颜色），引擎负责「针数算术」。

---

## 1. 记号 (OPS)

| 符号 | 名称 | 消耗针数 | 产出针数 | 说明 |
|---|---|---|---|---|
| `X` | 短针 sc | 1 | 1 | |
| `V` | 加针 inc | 1 | 2 | 同一针目 2 短针 |
| `A` | 减针 dec | 2 | 1 | 两针并一针 |
| `T` | 中长针 hdc | 1 | 1 | |
| `F` | 长针 dc | 1 | 1 | |
| `W` | 一针三短针 | 1 | 3 | 转角用 |
| `M` | 三针并一针 | 3 | 1 | |
| `CH` | 锁针 | 0 | 1 | 起立/桥接，不消耗上一圈 |
| `SL` | 引拔 | 1 | 0 | 收口/换色用 |
| `K` | 空针 skip | 1 | 0 | 片织空针 |
| `B` | 爆米花针 bobble | 1 | 1 | 软糖体手脚（同针 5F 收口），不改变增减差 |
| `✱` | 重复分隔 | — | — | 不是针法，仅排版 |

重复体写作 `3(X,V)` 表示「(X,V) 重复 3 次」。引擎内部一律展开成 `ops` 数组，`n` 表示该 op 连续次数。

---

## 2. 数据模型

### 2.1 chart.json

```jsonc
{
  "version": 1,
  "name": "绿发少女",
  "createdAt": "2026-10-29T00:00:00.000Z",
  "spec": { /* 原始 toySpec，原样内嵌，便于复现 */ },
  "gauge": { "stPerCm": 2.2, "roundsPerCm": 2.2, "hookMm": 2.5, "yarn": "4ply 牛奶棉" },
  "palette": [
    { "id": "C1", "name": "雪白", "hex": "#F7F3EE", "role": "skin", "yarnMetersPerGram": 4.2 }
  ],
  "parts": [ /* Part[] */ ],
  "reference": { /* 参考图 + 部件热区，见 §2.4；buildChart 自动补齐 */ },
  "yarn": { /* yarnEstimate() 的输出，见 3.6 */ },
  "validation": { /* validateChart() 的输出，见 3.2 */ }
}
```

`role` 取值：`skin` | `hair` | `main` | `accent` | `eye` | `blush` | `tool`。

### 2.4 `reference`（参考图 · 部件对照）

```jsonc
{
  "caption": "参考图 · 部件对照",
  "image": "data:image/jpeg;base64,...",   // 可选；由 render-html --ref 嵌入
  "width": 100, "height": 140,             // 归一化坐标系
  "regions": [
    {
      "partId": "hat-brim", "name": "笠帽宽檐", "color": "#2A2E55",
      "shape": "ellipse", "cx": 50, "cy": 28, "rx": 34, "ry": 7,
      "mirror": null                       // 手臂/腿等可给对称副本
    }
  ]
}
```

- 缺省由 `layoutPartMap` / `resolveReference` 按 Q 版正面素体自动生成。
- 交付 HTML 必须渲染「参考图 · 部件对照」：点击热区/列表跳到对应 `#part-{id}`；部件标题可反向定位。

### 2.2 Part

```jsonc
{
  "id": "head",
  "name": "头部",
  "shape": { "kind": "sphere", "diameterCm": 8 },   // 引擎换算的输入，保留便于复现
  "rounds": [ /* Round[] */ ],
  "subtotal": { "stitches": 168, "rounds": 14 }
}
```

`shape.kind` 取值：`sphere` | `capsule` | `cylinder` | `cone` | `flat-round` | `flat-row`。

若部件自带手工 `rounds[]`（软糖体 / 发条），则**跳过** `buildShape`，直接采用该圈序；`shape` 仅作语义标注（可写 `{ "kind": "softcandy" }`）。
`Round.kind` 增补：`strand`（锁针发条，不进 R1/R2/R5 环内守恒）。

### 2.3 Round

```jsonc
{
  "r": 1,
  "kind": "magic-ring",          // magic-ring | round | row
  "color": "C3",
  "stitchesIn": 0,               // 本圈消耗针数（= 上一圈产出）
  "stitchesOut": 6,              // 本圈产出针数
  "ops": [ { "sym": "X", "n": 6 } ],
  "note": "环形起针 6X"
}
```

- `kind === "magic-ring"`：只有第 1 圈使用，`stitchesIn === 0`。
- `kind === "row"`：片织（来回翻面），`stitchesIn` 仍按上一行产出算。
- `color` 必须是 `palette[].id` 之一。

---

## 3. 引擎 API（`engine/gummy-engine.js`）

必须同时满足：**浏览器全局 `window.GummyEngine`** 和 **Node `import`/`require`**（UMD，零依赖，纯 ES5+ 语法可运行）。

### 3.1 常量

```js
GummyEngine.VERSION              // "1.1.0"
GummyEngine.OPS                  // { X: {cn:'短针', consume:1, produce:1}, ... } 完整 §1
GummyEngine.DEFAULT_GAUGE        // { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5 }
GummyEngine.SHAPE_KINDS          // ['sphere','capsule','cylinder','cone','flat-round','flat-row']
```

### 3.2 `validateChart(chart)` → Validation

```js
{
  ok: true,
  errors: [],                       // 全局错误（字符串数组）
  parts: [
    {
      id: "head", ok: true, errors: [],
      rounds: [
        { r: 1, consumed: 0, declaredIn: 0, produced: 6, delta: 6, ok: true, errors: [] }
      ]
    }
  ],
  summary: { parts: 5, rounds: 62, totalStitches: 1240, colorChanges: 9 }
}
```

**校验不变量（必须全部实现，逐条可测）**

- **R1 环内守恒**：`sum(consume * n) === round.stitchesIn`。
- **R2 产出正确**：`sum(produce * n) === round.stitchesOut`。
- **R3 衔接守恒**：第 `i>1` 圈 `stitchesIn === 第 i-1 圈 stitchesOut`。
- **R4 起针**：第 1 圈 `kind==='magic-ring'` 时 `stitchesIn===0`；否则报错。
- **R5 增减一致**：`stitchesOut - stitchesIn === (#V + 2#W + #CH) - (#A + 2#M + #SL + #K)`，
  即增量必须能由增减针完全解释。若不等，报错并给出差值。
- **R6 配色合法**：`color` 必须存在于 `palette`；`colorChanges` = 相邻圈配色变化次数。
- **R7 可钩性下限**：任意圈 `stitchesOut >= 5` 且为整数；`stitchesOut <= 200`。
  - 软糖体经典 **5X** 起针合法；几何球体推导仍常用 6X。
  - **例外**：部件**最后一圈**允许 `stitchesOut === 0`（全减完收口）；`kind==='strand'` 发条允许 0；中间圈不得为 0。
- **R10 接针一致性**：`attachTo` 引用的目标圈必须存在；声明的 `stitches` 必须等于该圈 `stitchesOut`（差 1 即失败）。目标圈未标 `loop` 时给警告。
- **R11 主体可钩性门槛**（仅 `head` / `body` / `hair*` 等主体部件）：
  - 最宽圈 `stitchesOut < 18` → **错误**（几乎不可钩 / 难塞棉）；
  - `18 ≤ 最宽圈 < 24` → **警告**（不影响 `ok`）；
  - 四肢、眼、荷叶边等小件不参与。
  - `summary.craftability` 记录 `{ hardFails, softWarns, checked }`。

> R5 允许 `CH`/`SL` 参与，因此起立与引拔不会误报。

### 3.3 `buildRound(ops)` → `{ stitchesIn, stitchesOut, note }`

工具函数：把 `[{sym:'X',n:6}]` 折算成针数并生成人类可读 `note`（如 `6X`、`3(X,V)`、`R1 环形起针 6X`）。

### 3.4 `buildShape(shape, gauge)` → `{ rounds: Round[], plan: {...} }`

纯确定性换算，`plan` 记录推导中间量（`maxStitches` / `incRounds` / `straightRounds` 等）便于自查。

**已确定的推导规则（必须按此实现，可调常数但不得改公式）**

所有形状共用：`circumference = π × diameterCm`；`maxStitches = 取 6 的整数倍，最接近 circumference × stPerCm`。

- **sphere**（头、身体球）：
  - `incRounds = maxStitches / 6 - 1`（第 2 圈起每圈 +6）
  - 高度约束：`totalRounds = round(diameterCm × roundsPerCm)`
  - `straightRounds = max(0, totalRounds - 2 × incRounds)`
  - 圈序：`magic-ring 6` → `incRounds` 圈递增 → `straightRounds` 圈平织 → 对称递减收口 `incRounds` 圈
    最后一圈减到 6 针后以 `A`/`SL` 收口；收口圈 `stitchesOut` 允许为 0 表示「全减完」。
  - **强制**：递增与递减必须镜像对称（第 `n` 圈与倒数第 `n` 圈针数相同），由校验断言。

- **capsule**（躯干、手臂、腿）：
  - 两端半球 + 中间圆柱。`incRounds` 同 sphere；
  - `straightRounds = max(1, round((heightCm - diameterCm) × roundsPerCm))`
  - 两端口径一致时，头部用 sphere 逻辑收口，尾端用平底或圆形收口（由 `close: 'round' | 'flat'` 指定，默认 `round`）。

- **cylinder**（直筒，如帽子）：`magic-ring 6` → 递增到 `maxStitches` → 平织 `round(heightCm × roundsPerCm)` 圈，不做递减。

- **cone**（锥形，如斗篷）：`magic-ring 6` → 递增到 `maxStitches` → 递减/或不递减直接收口，按 `taper` 参数线性分配。

- **flat-round**（圆片，如脸底、花瓣）：纯递增到 `maxStitches` 后 `SL` 收尾。
- **flat-row**（片织，如围巾）：`CH 起针 n` → 每行 `n` 针来回，`n = round(widthCm × stPerCm)`。

**字段要求**（漏字段会导致圈数算成 0，engine 必须报错而不是静默产出）：

| kind | 必填字段 |
|---|---|
| `sphere` | `diameterCm` |
| `capsule` | `diameterCm` **和** `heightCm` |
| `cylinder` | `diameterCm` **和** `heightCm` |
| `cone` | `diameterCm` **和** `heightCm` |
| `flat-round` | `diameterCm` |
| `flat-row` | `widthCm` **和** `heightCm` |

### 3.4b toySpec → Round 映射（`buildChart` 如何把 §5b 字段落到圈上）

`toySpec` 是**输入**，`Round` 是**输出**。§5b 定义的 `decor` / `loop` / `attachTo` 属 Round 级字段，
toySpec 侧用下列三个键透传，`buildChart` 负责换算落位：

```jsonc
{
  "id": "hair-back", "name": "后脑发片",
  "shape": { "kind": "sphere", "diameterCm": 6.8 },

  // ① 装饰针迹：只写 kind/every/ch，count 由引擎按「本圈 stitchesOut / every」自动补
  "decor": [
    { "kind": "curly", "every": 2, "ch": 6,
      "roundFrom": 8, "roundTo": 99,        // 落位圈范围；99 = 直到收口
      "note": "正面中央 3 个用 4CH，其余用 6CH" }
  ],

  // ② 半针留针：本部件哪些圈只钩内/外半针，留给谁
  "loopRounds": [
    { "round": 6, "loop": "blo", "reservedFor": "hem" }
  ]
}
```

以及部件级 `shape.attachTo`（接别人的留针，见 §5b.2）：

```jsonc
{ "id": "hem", "shape": { "kind": "flat-round", "diameterCm": 5.0,
    "attachTo": { "part": "body", "round": 6, "loop": "flo", "stitches": 30 } } }
```

**映射规则（engine-dev 必须按此实现）**

1. `decor[].roundFrom ≤ r ≤ roundTo` 的圈，逐圈写入
   `round.decor = [{ kind, every, ch, count: round.stitchesOut / every, note }]`。
   `count` **必须整除**，除不尽时向下取整并写入 `validation.warnings`。
2. `loopRounds[]` 中 `round === r` 的圈，写入 `round.loop` 与 `round.reservedFor`；未列出的圈默认 `loop: 'both'`。
3. `shape.attachTo` 存在时：该部件第 1 圈 `kind = 'attach'`，`stitchesIn = attachTo.stitches`，
   并跳过 R4（不算环形起针）。
4. `chart.buildOrder` 优先用 toySpec 的 `buildOrder`；缺省时按「主体 → 附着件 → 装饰 → 缝合」生成默认值。

> **与 §5b 的关系**：§5b 描述 Round（输出）上的字段；§3.4b 描述 toySpec（输入）上的字段。
> 两者名字不同是刻意的——输入是给人写的，输出是给校验和渲染用的。

### 3.5 `buildChart(toySpec)` → chart

```jsonc
// toySpec 输入
{
  "name": "绿发少女",
  "heightCm": 14,                       // 成品总高
  "style": "chibi",                     // chibi 头身比 1:1.2，realistic 1:2
  "gauge": { "stPerCm": 2.2, "roundsPerCm": 2.2, "hookMm": 2.5, "yarn": "4ply 牛奶棉" },
  "palette": [ { "id":"C1", "name":"雪白", "hex":"#F7F3EE", "role":"skin" } ],
  "parts": [
    {
      "id": "head", "name": "头部",
      "shape": { "kind": "sphere", "diameterCm": 8 },
      "colorRounds": [ { "from": 1, "to": 4, "color": "C1" } ]   // 缺省用 defaultColor
    }
  ]
}
```

`buildChart` 必须：按 `parts[]` 顺序生成每圈；应用 `colorRounds`（缺省 `defaultColor`，再缺省 `palette[0]`）；
写入 `chart.yarn` 与 `chart.validation`。**内部必须调用 `validateChart`，`ok===false` 时在 `chart.validation` 中带出错误但不抛异常**。

### 3.6 `yarnEstimate(chart, opts)` → Yarn

```js
{
  perPart: [ { id:"head", stitches: 168, meters: 4.2, grams: 1.0 } ],
  perColor: [ { color:"C1", stitches: 120, meters: 3.0, grams: 0.71 } ],
  total: { stitches: 1240, meters: 31.0, grams: 7.4 },
  withBuffer: { meters: 38.8, grams: 9.3 },     // 默认 +25% 损耗
  bufferRatio: 0.25,
  constants: { metersPerStitch: 0.025, note: "..." }
}
```

- `metersPerStitch` 默认 `0.025`（2.5mm 钩针 + 4ply 棉线，单短针约 2.5cm 用线）。
  可由 `opts.metersPerStitch` 覆盖。
- `grams = meters / yarnMetersPerGram`，`yarnMetersPerGram` 取 palette 项，缺省 `4.2`。
- 必须四舍五入到 1 位小数。

### 3.7 `circleLayout(part, opts)` → 符号图坐标

```js
// 返回每个部件每一圈的针目环状布局，供 SVG 绘制
[ { r: 1, stitches: [ { i: 0, x: 0, y: 0 } ] } ]
```

在以 `maxStitches` 为最大半径的归一化坐标系（`-1..1`）中：
第 `r` 圈半径 `radius = sqrt(stitchesOut / maxStitches)`（面积均分，符合钩织平面扩张直觉），
针目均匀分布在该圆上，起始角固定 `-π/2`（12 点方向），顺时针。

### 3.8 `toNotation(part)` → `string[]`

每圈一行人类可读记法，如：
`R1 环形起针 6X` / `R5 (4X,V)×6 = 36` / `R12 (2X,A)×9 = 18`

### 3.9 `quantize(pixels, k, opts)` → `{ palette: [{hex, count, ratio}] }`

`pixels` = `[[r,g,b], ...]` 或 `[r,g,b,...]` 扁平数组。
用 **k-means（k-means++ 初始化，固定随机种子，最多 30 轮）** 在 **CIELAB** 空间聚类，
输出按 `count` 降序，`hex` 为大写 `#RRGGBB`。必须确定性：同输入同输出（种子固定为 `opts.seed ?? 42`）。

### 3.10 `summarizePhotoRegions(pixels, w, h, k)` → 区域占比

把图像按 `k` 色量化后，输出各色在整图中的占比 `ratio`，以及上/中/下三段的占比，
供模型判断「头发色 / 肤色 / 衣服色」哪块是哪块：

```js
{ dominant: [{hex, ratio}],
  bands: { top: [{hex, ratio}], middle: [...], bottom: [...] },
  suggested: { hair: "#...", skin: "#...", cloth: "#..." } }   // 按占比+位置启发式
```

### 3.12 `layoutPartMap(chart|parts)` / `resolveReference(chart, existing?)`

- `layoutPartMap`：按 Q 版正面素体（100×140）为每个部件生成椭圆热区（含 arm/leg 镜像）。
- `resolveReference`：合并用户 `reference` 与自动布局；用户 `regions` 非空时优先保留。

### 3.11 `assessIdentity(toySpec|chart)` → IdentityReport

只看规格/图解（不看照片），评估「特征层是否够认出是谁」：

```js
{
  ok: true,
  score: 100,                 // 0–100，按必检项通过比例
  style: "chibi",
  heightCm: 14,
  checks: [{ id, ok, detail }],
  missing: [],                // 未通过的必检 id
  accents: ["hat"],           // 识别到的标志配件 id
  notes: ["…"]
}
```

必检：`role-hair/main/eye/skin`、`part-head/body/hair/eye`、`proportion`。
`accent-optional` / `blush` 缺失只进 `notes`，不拉低 `ok`。

---

## 4. CLI（`tools/`）

全部用 **Node ESM**，退出码：`0` 成功，`1` 校验失败，`2` 用法/IO 错误。

### 4.1 `node tools/validate-chart.mjs <chart.json>`

读取 chart，调 `validateChart`，人类可读打印逐圈表 + 结论。校验不通过 → 退出码 1。

### 4.2 `node tools/build-chart.mjs <toySpec.json> --out <chart.json>`

`buildChart` → 写 chart.json；同时打印用线量摘要。校验失败仍写出文件但退出码 1。

### 4.3 `node tools/render-html.mjs <chart.json> --out <x.html> [--ref <照片>]`

读 `templates/gummy-atelier.html`，把 chart 与 palette 注入（替换占位符），输出最终自包含 HTML。
`--ref` 可选：将本地照片以 data URL 写入 `chart.reference.image`（仍零外链）。

### 4.4 `python tools/analyze_photo.py <photo> --k 8 --json`

用 PIL + numpy：EXIF 矫正 → 缩放到长边 ≤ 512 → 中位切分去噪 → 输出 JSON：
`{ width, height, dominant:[{hex,ratio}], bands:{...}, suggested:{...} }`。
**必须与 `GummyEngine.summarizePhotoRegions` 的 `bands` 语义一致**（同一套上/中/下三段定义）。

### 4.5 `node tools/export-markdown.mjs <chart.json> --out <x.md> [--force]`

把 chart 导出为可读 Markdown（配色 / 制作顺序 / 逐圈表 / 还原度自检）。
**默认校验失败拒绝写出**（对齐「自检不过不导出」）；`--force` 仍写出但文首标注未通过。

### 4.6 `node tools/check-identity.mjs <toySpec.json|chart.json>`

调用 `assessIdentity`，打印特征完备性得分与逐项结论。缺关键特征 → 退出码 1。

---

## 5. 交付 HTML（`templates/gummy-atelier.html`）

单个文件、零外链、离线可用。必须包含：

1. **顶部**：作品名、成品尺寸、工具/线材、总用线量（含缓冲）。
2. **参考图 · 部件对照**：渲染 `chart.reference`（有 `image` 则叠照片，否则画 Q 版素体示意图）；
   热区/列表点击 → 滚动到对应部件；部件「在图上定位」→ 反向高亮参考图。每部件旁可有迷你对照缩略。
3. **图解区**：逐圈表格（圈号/配色/记法/消耗/产出/增减），点击行高亮该圈；配色用色块显示。
4. **符号图区**：内嵌 SVG，每部件一张，按 `circleLayout` 绘制针目圆点，图例齐全；当前高亮圈加粗。
5. **校验区**：把 `chart.validation` 的逐圈守恒表渲染出来，顶部给出通过/不通过结论。
6. **打印**：`@media print` 隐藏交互控件，A4 友好分页。
7. **进度**：勾选已钩完的圈 → `localStorage` 保存，刷新后保留。

注入方式：模板内保留两个占位符，`render-html.mjs` 做字符串替换：
- `/*__GUMMY_CHART__*/null`  → 替换为 chart JSON
- `/*__GUMMY_ENGINE__*/`     → 替换为引擎源码（保证单文件自包含）

---

## 5b. 装饰针迹与半针留针（v1.1 增补）

> 增补原因：`docs/reference/build-prototype.py`（一份真实交付过的「绿发女孩」图解）用了两种真实工艺，
> 缺少它们就无法表达参考照片里的**卷发**与**荷叶边**。engine-dev 请在第 3 项完成后补实现。

### 5b.1 装饰针迹 `decor`

一串**不改变针数**的额外针迹，挂在某一圈上，只影响成品外观。典型：
- **卷曲针（curly）**：在某个针目上钩 `n` 个锁针 + 若干短针，自然卷成螺旋 → 卷发。
- **枣针（bobble）**：同一针目里钩 3 个未完成长针并一 → 颗粒感。
- **花瓣（petal）**：`k(CH) + 2T + k(CH) + SL` → 花瓣。

在 `Round` 上加可选字段：

```jsonc
{
  "r": 8,
  "decor": [
    {
      "kind": "curly",          // curly | bobble | petal | picot
      "every": 2,               // 每 2 针挂 1 个（从第 1 针起算）
      "count": 18,              // 共 18 个；必须 === 本圈 stitchesOut / every
      "ch": 6,                  // 每个卷曲针的锁针数（curly 用）
      "note": "正面中央 3 个用 4CH，其余 15 个用 6CH"
    }
  ]
}
```

**校验规则 R8（新增）**：`decor[].count * decor[].every === round.stitchesOut`，
否则报错「R{n} 装饰针迹数量与本圈针数不匹配」。
`decor` **不参与** R1/R2/R5 的针数守恒计算——它不消耗也不产出针数。

`toNotation` 输出时，带 `decor` 的圈要在行尾附加标注，如：
`R8 36X  ⟡ 18×卷曲针(6CH)`。

### 5b.2 半针留针 `loop`

钩织里「只钩内半针（BLO）」，把外半针留下来给后加的荷叶边用。这是做**下摆/领口荷叶边**的标准手法。

在 `Round` 上加可选字段：

```jsonc
{ "r": 6, "loop": "blo", "reservedFor": "hem" }   // blo = 只钩内半针，外半针留用
```

`loop` 取值：`both`（默认）| `blo`（内半针）| `flo`（外半针）。
`reservedFor` 指向一个后续部件的 `id`，描述「这些针目给谁用」。

**部件 `start` 也要支持接在留针上**：某部件的 `shape.attachTo` 形如
`{ "part": "body", "round": 6, "loop": "flo", "stitches": 30 }`，
表示「这个部件起针接在 body 第 6 圈留下的 30 个外半针上」。
此时该部件第 1 圈 `stitchesIn === 30`（而不是 0），`kind` 用 `'attach'`。

**校验规则 R9（新增）**：`loop !== 'both'` 的圈，必须有另一个部件通过 `attachTo` 引用它，
或显式写 `"reservedFor": null` 表示「留针但不用」。否则给出**警告**（`warnings` 数组，不影响 `ok`）。

### 5b.3 `validateChart` 返回值增补

```jsonc
{
  "ok": true,
  "errors": [],
  "warnings": [ "R6 留下 30 个外半针，但没有部件接上去" ],   // 新增
  "parts": [...],
  "summary": { ..., "decorCount": 38, "reservedLoops": 1 }     // 增补两个字段
}
```

### 5b.4 制作顺序 `buildOrder`

`chart.buildOrder`：`string[]`，人类可读的装配步骤（如「身体 R6 内半针，留 30 个外半针」→「在下摆外半针上钩荷叶边」）。
`buildChart` 若 `toySpec` 未提供，按 `parts[]` 顺序生成一个合理默认（先主体、后附件、最后缝合并绣五官）。
模板 §5 需渲染这一节。

---

## 6. 领域常量（由 chart-expert 校准，engine 只读取）

| 常量 | 默认值 | 说明 |
|---|---|---|
| `DEFAULT_GAUGE.stPerCm` | 2.2 | 2.5mm 钩针 + 4ply 棉线，10cm ≈ 22 短针 |
| `DEFAULT_GAUGE.roundsPerCm` | 2.2 | 10cm ≈ 22 圈 |
| `metersPerStitch` | 0.025 | 单短针用线 2.5cm |
| `yarnMetersPerGram` | 4.2 | 4ply 牛奶棉典型值 |
| `bufferRatio` | 0.25 | 损耗/接头预留 |
| `chibi` 头身比 | 头:身 = 1 : 1.2 | Q 版软糖风 |
| `realistic` 头身比 | 头:身 = 1 : 1.9 | |

---

## 7. 目录与写入分工（互不越界）

| 路径 | 负责人 |
|---|---|
| `docs/CONTRACT.md` | **Lead 独占** |
| `engine/`、`tools/` | engine-dev |
| `templates/` | template-dev |
| `skills/` | chart-expert |
| `tests/` | qa-verifier |
| `bundles/`、`README.md` | Lead |
| `docs/reference/` | Lead（只读参考，勿修改） |
| `characters/` | Lead（按人物归档：`toyspec.json` / `chart.json` / `gummy.html`；底模在 `_presets/`） |
| `assets/`、`scripts/` | Lead |

任何人不得修改别人目录下的文件；发现契约需要变更，报告 Lead。

**人物作品约定**：新角色建 `characters/<角色名>/`，标准文件名为 `toyspec.json`、`chart.json`、`gummy.html`（可选 `gummy.md`、`ref.*`）。变体放 `variants/<名>/`。

---

## 附录 A：参考原型

`docs/reference/build-prototype.py` 是一份**真实交付过的**图解生成器（「绿发女孩」，726 行）。
它的价值在于**工艺知识**，不在于代码结构——它把 11 个部件的全部图解硬编码了，只服务一个作品。

可借鉴的工艺点：
- 内半针留针做荷叶边（已吸收进 §5b.2）
- 卷曲针做卷发、枣针做颗粒、花瓣针做花（已吸收进 §5b.1）
- 制作顺序与缝合位置的具体描述（已吸收进 §5b.4）
- FAQ 与「换针换线尺寸换算」章节的写法（chart-expert 请参考）
- 中文排版与卡片式 CSS（template-dev 请参考，但不要照抄结构）

**不可借鉴**：硬编码的部件数据、`manual_inc` 这种绕过校验的补丁、只支持 `X/V/A` 的解析器。
新引擎必须是通用的：任意造型、任意部件数、完整记号集。
