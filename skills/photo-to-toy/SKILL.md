---
name: photo-to-toy
description: 把人物照片转成「软糖图解」引擎可消费的 toySpec.json：读图 → 提取 3–6 个决定性特征 → Q 版简化 → 按契约 §3.5 产出部件/比例/配色/装饰。用户上传照片要做人形钩织玩偶时，第一步先读本技能。
whenToUse: 用户上传人物照片/角色图并要求做成钩织玩偶、Q 版娃娃、软糖玩偶；或需要把照片写成 toySpec.json 交给 GummyEngine.buildChart 时。
---

# 照片 → 造型规格

**职责边界**：本技能只产出 `toySpec.json`（造型语义：这部件是球还是柱、多高、什么颜色）。**针数、圈数、用线量一律由 `GummyEngine.buildChart` 计算，禁止手写**；手写针数视为交付失败。

## 1. 读图流程（三步，顺序不可跳）

1. **目视**：用 `read_image` 看原图，记下①发型外轮廓（长度/分缝/扎法/卷直）②眼睛大小与形状 ③有没有眼镜 ④衣服款式与主色 ⑤人像特写还是全身。
2. **量化**：`python <工作区>/tools/analyze_photo.py <照片> --k 8 --json` → `dominant[]`、`bands.top/middle/bottom`（上/中/下各占画面高 1/3，与引擎 `summarizePhotoRegions` 同一套定义）、`suggested.hair|skin|cloth`。
3. **交叉判定**：`suggested` 只是启发式，必须用「位置 + 目视」复核：

| 判断 | 主证据 | 目视复核点 |
|---|---|---|
| 头发色 | `bands.top` 占比最大且非背景 | 额头以上是否整片同色 |
| 肤色 | `bands.middle` 明度最高、饱和度最低的暖色 | 脸/手臂/腿是否同色 |
| 衣服色 | `bands.middle + bands.bottom` 合计占比最大 | 是否被手臂或包挡住 |
| 眼睛色 | 全图最暗 + 饱和度最高的小面积色 | 常为黑/深棕，别选成头发 |

- 半身/特写**不要硬套三段**，改按实际构图判读，并主动问用户「下半身什么颜色」；深肤色/强滤镜/逆光以 `read_image` 目视为准，量化只作参考，并把取舍理由写给用户。

## 2. 决定性特征提取（只留 3–6 条）

按「一眼认出是谁」排序，**到 6 条就停**：①发型轮廓（短发/双马尾/丸子头/长直发/长卷发）②发色 ③眼镜（有则必留，最强识别项）④服装主色 + 款式大类 ⑤标志性配件（1 件）⑥表情基调（笑/无表情，只分两档）。

**明确忽略（一律丢弃）**：发丝走向与分缝、布料纹理与褶皱、小碎花/条纹/格子/印花、背景与道具、妆容（眼影/高光/唇色渐变）、配饰小零件（链扣/纽扣/拉链/耳钉）、手写文字与 logo。判据：某特征「去掉后仍能认出是谁」就丢掉。

## 3. Q 版造型简化规则（可做性优先）

| 项 | 规则 | 禁止 |
|---|---|---|
| 头身比 | `chibi` 头 : 身 = **1 : 1.2**（契约 §6），强制，**不随照片真实头身比变** | 照抄真人 1:6 |
| 眼睛 | 2 个 `flat-round` 圆片（直径 ≈ 0.07 × 头径）缝上，或刺绣 1 圈 X | 眼白、高光、睫毛、渐变瞳孔 |
| 嘴/鼻 | 默认**全省略**；需要时只加 1 道刺绣弧线 | 鼻孔、嘴唇轮廓 |
| 手指 | 合并成**连指手套式**：手臂 `capsule` 直接收口 | 五指、分开的拇指 |
| 头发 | **发帽 1 件 + 前刘海片 1 件**（长发再加侧卷发条，共 ≤3 件） | 逐根发丝、编发细节 |
| 卷发/长发 | **靠 `decor` 表达，不靠加部件**：给发帽对应圈挂 `decor:[{kind:'curly',every:2,ch:6}]`，`count` 由引擎按 `stitchesOut/every` 补 | 一打「一缕一部件」 |
| 衣服 | 整体 1 段 `colorRounds`；领口/袖口各用 1 圈 accent | 花纹、口袋、拉链 |
| 荷叶边/下摆 | body 某圈 `loop:'blo'` 留外半针，再建 `attachTo` 部件接上（§4.4） | 硬做一圈褶皱针数 |
| 鞋 | 腿末端换 accent 色 2 圈代替鞋 | 鞋带、鞋型细节 |
| 配件 | 最多 1 件，且必须是凸起可钩的形状（球/柱/片） | 平面图案、贴纸类 |

`chibi` 强制：头径 = 0.45 × 总高。

## 4. toySpec.json 生成法（严格按契约 §3.5）

**快捷起点**：人形角色可复制 `characters/_presets/softcandy-chibi.toyspec.json`（Q 版软糖体底模）到 `characters/<角色>/toyspec.json`，只改 `palette` hex、标志配件与发型，再跑 `node tools/check-identity.mjs` 确认特征层齐备。成品一律落在该角色目录（`chart.json` / `gummy.html`）。

### 4.1 比例表（`diameterCm` 的唯一推导依据，以总高 `H = heightCm` 为单位）

| 部件 | `shape.kind` | 尺寸算法（chibi） |
|---|---|---|
| 头 | `sphere` | `diameterCm = 0.45H` |
| 躯干 | `capsule` | `heightCm = 0.28H`，`diameterCm = 0.24H` |
| 腿 ×2 | `capsule` | `heightCm = 0.18H`，`diameterCm = 0.11H` |
| 手臂 ×2 | `capsule` | `heightCm = 0.22H`，`diameterCm = 0.10H` |
| 发帽/后脑发片 | `sphere` | `diameterCm = 1.05 × 头径` |
| 前刘海片 | `flat-round` | `diameterCm = 头径` |
| 领口/袖口/卷边 | `cylinder` | `heightCm = 0.05H`，`diameterCm` 贴合所绕部件 |
| 荷叶边/下摆 | `cone` | `diameterCm` = 所接圈周长，`heightCm = 0.08H` |
| 围巾等片织物 | `flat-row` | `widthCm` 按需 |

- 0.45 + 0.28 + 0.18 + 0.09 = 1.00，**余下 0.09H 是颈部与粘合重叠量，不单独建部件**；结果圆整到 **0.5cm** 整数倍（`6.3 → 6.5`）。
- **字段必备**：`sphere`/`flat-round` 只写 `diameterCm`；`capsule`/`cylinder`/`cone` **必须同写 `diameterCm` + `heightCm`**（漏 `heightCm` 圈数会算成 0）；`flat-row` 写 `widthCm` + `heightCm`。
- `realistic` 才用照片真实比例：`头径 = (照片头高像素 ÷ 全身像素) × H`，其余按上表等比缩放。

### 4.2 字段推导表

| 字段 | 取值来源 |
|---|---|
| `name` | 用户给的作品名；没给就用「<主色>发Q版娃娃」 |
| `heightCm` | 用户明确要求的值；否则 chibi 默认 **14**，realistic 默认 22 |
| `style` | 默认 `chibi`；用户说「像真人一样/不要Q版」才用 `realistic` |
| `gauge` | 用户指定线材/针号时查 `crochet-craft` 常数表；否则用 `DEFAULT_GAUGE`（`2.2 / 2.2 / 2.5 / 4ply 牛奶棉`） |
| `palette[].id` | `C1…C8`，按 role 顺序编号 |
| `palette[].hex` | **照抄 `analyze_photo` 的 hex，不改亮度/饱和度**；归并后取组内占比最大者 |
| `palette[].role` | 按 §5 优先级分配，8 色内必须齐备 `skin/hair/main/eye` |
| `shape.kind` | 球→`sphere`；两端圆中间直→`capsule`；直筒→`cylinder`；锥/荷叶边→`cone`；圆片→`flat-round`；片织→`flat-row` |
| `colorRounds` | 只在**真要换色**的部件写（整件单色只写 `defaultColor`）；`to` **写 `99` = 直到收口**，不写死圈数（密度一变圈数就变） |
| `parts[]` 数量 | 单件只写一次；对称件写 1 个 part，`name` 里注明「织 2 只」 |

### 4.3 完整示例（H = 14cm，chibi，绿发卷发少女）

```json
{
  "name": "绿发少女", "heightCm": 14, "style": "chibi",
  "gauge": { "stPerCm": 2.2, "roundsPerCm": 2.2, "hookMm": 2.5, "yarn": "4ply 牛奶棉" },
  "palette": [
    { "id": "C1", "name": "雪白",   "hex": "#F7F3EE", "role": "skin"   },
    { "id": "C2", "name": "墨绿",   "hex": "#2E5B4E", "role": "hair"   },
    { "id": "C3", "name": "抹茶绿", "hex": "#7FB69A", "role": "main"   },
    { "id": "C4", "name": "燕麦米", "hex": "#E3D3BA", "role": "accent" },
    { "id": "C5", "name": "炭黑",   "hex": "#2A2622", "role": "eye"    },
    { "id": "C6", "name": "蜜桃粉", "hex": "#F2A6A0", "role": "blush"  }
  ],
  "parts": [
    { "id": "head", "name": "头部", "defaultColor": "C1", "shape": { "kind": "sphere", "diameterCm": 6.5 } },
    { "id": "body", "name": "躯干", "defaultColor": "C3", "shape": { "kind": "capsule", "diameterCm": 3.5, "heightCm": 4.0 }, "loopRounds": [ { "round": 6, "loop": "blo", "reservedFor": "hem" } ] },
    { "id": "hem", "name": "下摆荷叶边", "defaultColor": "C4", "shape": { "kind": "cone", "diameterCm": 6.0, "heightCm": 1.0, "attachTo": { "part": "body", "round": 6, "loop": "flo", "stitches": 30 } } },
    { "id": "arm", "name": "手臂（织 2 只）", "defaultColor": "C1", "shape": { "kind": "capsule", "diameterCm": 1.5, "heightCm": 3.0 }, "colorRounds": [ { "from": 1, "to": 2, "color": "C3" } ] },
    { "id": "leg", "name": "腿（织 2 只）", "defaultColor": "C1", "shape": { "kind": "capsule", "diameterCm": 1.5, "heightCm": 2.5 }, "colorRounds": [ { "from": 5, "to": 99, "color": "C5" } ] },
    { "id": "hair-cap", "name": "发帽（卷发）", "defaultColor": "C2", "shape": { "kind": "sphere", "diameterCm": 6.8 }, "decor": [ { "round": 8, "kind": "curly", "every": 2, "ch": 6 } ] },
    { "id": "bangs", "name": "前刘海片", "defaultColor": "C2", "shape": { "kind": "flat-round", "diameterCm": 6.5 } }
  ]
}
```

### 4.4 装饰与留针（契约 §5b）

| 键 | 写法 | 用途 |
|---|---|---|
| `decor` | `[{"round":8,"kind":"curly","every":2,"count":18,"ch":6}]` | 卷发 / 枣针颗粒 / 花瓣 |
| `loopRounds` | `[{"round":6,"loop":"blo","reservedFor":"hem"}]` | 内半针钩，外半针留用 |
| `shape.attachTo` | `{"part":"body","round":6,"loop":"flo","stitches":30}` | 荷叶边接留针：第 1 圈 `stitchesIn=30`、`kind='attach'` |

- `decor` 的 `count` 可由引擎按 `stitchesOut / every` 补全；**正面中央卷曲针用 `4CH` 短卷**（否则挡脸），写进 `note`。
- `attachTo.stitches` **必须等于**所接留针圈的 `stitchesOut`，差 1 针就缝不上。
- 三个都是契约 §5b 的 Round 级字段，toySpec 侧同名透传；可用 `buildOrder: string[]` 指定装配顺序（省略时引擎按部件序生成）。**引擎若尚未支持 `decor`/`attachTo`，先出 chart 再核对，并向 Lead 报契约缺口**。

**可行性自查（不做针数，只确认引擎不会算出违法值）**：头径 6.5 → 周长 π×6.5 = 20.4cm → `20.4 × 2.2 ≈ 45` → `maxStitches` 取 6 的倍数 = **42**，落在 6–200 内 ✓。任一步 `maxStitches` > 200（部件太粗或密度太高），先降 `heightCm` 或换细线再交给引擎。

## 5. 配色归并：8–20 色 → ≤ 8 个线色

钩织现实上限 **8 色**（每色都要买线、换色、藏线头）。按顺序执行：

1. **丢弃**占比 < 2% 的颜色；但 `eye`/`blush` 这类小面积语义色**不受此限**，必须保留。
2. **合并** CIELAB 色差 ΔE < 8 的两色（同物体明暗差别、同布料褶皱阴影），**代表色取组内占比最大的 hex**，不自己调色。
3. **超预算裁切**：仍 > 8 色时依次砍 `blush` → 第二件主色 → 第二个 `accent` → `tool`。**`skin/hair/main/eye` 四色永不裁。**

| 优先级 | role | 判定规则 |
|---|---|---|
| 1 | `skin` | `bands.middle` 明度最高、饱和度最低的暖色（V > 65%，S < 45%），且被手臂/腿复用 |
| 2 | `eye` | 全图最暗 + 饱和度最高的小面积色 |
| 3 | `hair` | `bands.top` 占比最大且非肤色、非背景 |
| 4 | `main` | `bands.middle + bands.bottom` 合计占比最大的非肤色色 = 服装主色 |
| 5 | `accent` | 第二大服装色，或鞋/领口/配件 |
| 6 | `blush` | 仅当 `main` 与 `skin` 间有粉红过渡色时才加，否则省一色 |
| 7 | `tool` | 针/别针等，最多 1 色，通常并入 `accent` |

## 6. 自检清单（交付前逐项打勾，任一项不过就改）

1. `palette` ≤ 8 项，`skin/hair/main/eye` 四 role 齐备（`accent/blush/tool` 可缺）。
2. 每个 hex 都能在 `analyze_photo` 结果里找到（或 ΔE < 8），**没有凭感觉编的颜色**。
3. 部件数 ≤ 10（对称件按 2 计）；头发相关 ≤ 3 件；**卷发是 `decor` 不是部件**。
4. `0.45H + 0.28H + 0.18H + 0.09H` = H，头径 ≤ 0.5H。
5. 每个 `capsule`/`cylinder`/`cone` 都写了 `diameterCm` **和** `heightCm`；`colorRounds[].to` 用 99 不写死。
6. 决定性特征 3–6 条，每条都能在 `toySpec` 里找到对应部件或颜色——**找不到对应物的就删**。
7. 无任何五官细节部件（无眼白、高光、睫毛、鼻孔、唇线）；手指已合并为连指手套式；无逐根发丝部件。
8. 用了 `decor`/`loopRounds`/`attachTo` 时：`count = stitchesOut / every`、`attachTo.stitches` = 留针圈产出，且未为装饰改动任何 `stitchesOut`。
9. JSON 可 `JSON.parse`：无注释、无尾逗号、hex 为**大写** `#RRGGBB`；`parts[].id` 唯一，所有色 id 都在 `palette` 里。
10. **没有手写任何针数/圈数**；下一跳必须是 `GummyEngine.buildChart(toySpec)`，跑 `node <工作区>/tools/build-chart.mjs toySpec.json --out chart.json`，`chart.validation.ok === true` 才算通过。
11. 把「砍掉了哪些特征、合并了哪些颜色、为什么」3 行以内说明给用户。
