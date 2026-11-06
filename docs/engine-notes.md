# 引擎实现笔记（engine-dev）

> 范围说明：`engine/gummy-engine.js` 最终由 Lead 接管并实现（我这边只在内存里设计了主体，未落盘；
> Lead 的实现在契约 §1/§3/§5b 上完整，并额外加了 R10 接针一致性）。
> 因此本文件记录的是**我负责的部分**（`tools/` 四个 CLI 及其自测），以及我在联调中发现的问题与对契约的保守解释。

---

## 1. 我交付了什么

| 文件 | 说明 |
|---|---|
| `tools/analyze_photo.py` | 契约 §4.4 照片调色板分析。PIL + numpy，零引擎依赖 |
| `tools/validate-chart.mjs` | 契约 §4.1 逐圈守恒表 + 结论 |
| `tools/build-chart.mjs` | 契约 §4.2 生成 chart + 用线量摘要 |
| `tools/render-html.mjs` | 契约 §4.3 占位符注入，产出单文件 HTML；含 `--check` 自检开关 |
| `tools/_load-engine.mjs` | tools/ 内部共享：引擎加载（UMD/CJS/ESM 三级回退）+ BOM 容错读取 |
| `tools/_selftest/selftest.mjs` | 我的自测，140 条断言，覆盖任务书 6 项 + R1–R9 + §5b |

自测运行：`node tools/_selftest/selftest.mjs`（中间产物写到系统临时目录，不污染仓库）

---

## 2. ⚠️ 发现一个引擎 bug（照片取色全链路失效）

**严重程度：高。** `templates/gummy-atelier.html` 的「照片取色」区直接调用
`GummyEngine.summarizePhotoRegions`，而该函数当前**对所有输入都返回 `#NANNANNAN`**。

### 复现

```js
const E = require('./engine/gummy-engine.js').GummyEngine;
const px = [[108,134,78],[108,134,78],[242,214,194],[242,214,194],[70,80,190],[70,80,190]];
const w = 2, h = 3;
E.summarizePhotoRegions(px, w, h, 3);
// → dominant: [{hex:"#NANNANNAN",...}, ...]
//   suggested: { hair:"#NANNANNAN", skin:"#NANNANNAN", cloth:"#NANNANNAN" }
```

对比：同样的像素直接喂 `quantize` 是**正确的**（`["#4650BE","#6C864E","#F2D6C2"]`）。
所以问题只出在 `summarizePhotoRegions` 这一条路径上。

### 根因

`normalizePixels()`（`engine/gummy-engine.js:1147`）**不是幂等的**：

- 输入 `[[r,g,b],...]` → 输出 `[{r,g,b},...]`
- 但输入 `[{r,g,b},...]` 时会掉进 `else` 分支（`Array.isArray(pixels[0])` 为 false），
  把对象当扁平数组按 ``pixels[j]`` 取值 → `pixels[j]` 是 `undefined` → `r/g/b` 全是 `undefined`
  → `rgbToLab` 出 `NaN` → `labToRgb` 出 `NaN` → `toHex` 拼成 `"#NANNANNAN"`。

而 `summarizePhotoRegions()`（`:1315`）先 `var px = normalizePixels(pixels)`，
随后又把 `px`（此时已是对象数组）传给 `quantize()`（`:1176` 内部**再**归一化一次）——
于是踩中上面那个非幂等分支。

### 验证过的补丁（在临时副本上测过，未改 `engine/`）

`normalizePixels` 开头加一条幂等分支即可：

```js
function normalizePixels(pixels) {
  var out = [];
  if (!pixels || !pixels.length) return out;
  // 幂等：已是 {r,g,b} 对象数组时直接透传，避免二次归一化产生 NaN
  if (typeof pixels[0] === 'object' && pixels[0] !== null && !Array.isArray(pixels[0])) {
    for (var k0 = 0; k0 < pixels.length; k0++) {
      var o0 = pixels[k0];
      out.push({ r: o0.r, g: o0.g, b: o0.b });
    }
    return out;
  }
  if (Array.isArray(pixels[0])) { /* …原有逻辑… */ }
  // …
}
```

补丁在临时副本上的验证结果（8/8 通过）：

```
PASS  dominant 的 hex 全部合法  #4650BE,#6C864E,#F2D6C2
PASS  bands 的 hex 全部合法
PASS  suggested 的 hex 全部合法  {"hair":"#6C864E","skin":"#F2D6C2","cloth":"#4650BE"}
PASS  上段主色是绿色系（头发）  #6C864E rgb(108,134,78)
PASS  确定性：两次调用一致
PASS  大图 266x264 k=8 全部合法  8 色
PASS  quantize 仍正常
PASS  嵌套数组输入与对象数组输入等价
```

补上之后，我自测里当前失败的 5 条（`dominant`/`bands`/`suggested` 的 hex 合法性、
上段绿色判定、suggested 格式）应当全部转绿。**其余 135 条已经全部通过。**

`docs/CONTRACT.md` §7 规定 `engine/` 不是我的写入范围，所以我**没有**动它，交由 Lead 决定。

---

## 3. 我做的保守解释（契约歧义）

### 3.1 `bands` 三段定义（契约 §4.4 要求「与 JS 侧语义一致」）

我采用**行三等分**，并在 `analyze_photo.py` 里写成可对照的公式：

```
行号 y 属于第 min(2, floor(y * 3 / h)) 段
```

即 `top = 行 [0, ceil(h/3))`，`middle` 紧随，`bottom` 收尾；`h % 3 == 0` 时正好三等分。
引擎 `:1349` 的实现是 `Math.min(2, Math.floor((row / height) * 3))`，**与此等价**，无需改动。

另一个容易踩的点是 ratio 的分母，两侧必须说清：

- `dominant[].ratio` 分母是**整图像素数**（各项之和 = 1）
- `bands.*[].ratio` 分母是**该段像素数**（每段内部之和 = 1）

### 3.2 `analyze_photo.py` 的算法：中位切分 + CIELAB Lloyd 精修

契约 §4.4 只写「中位切分去噪」。但**单用中位切分统计占比是错的**：
median cut 的每个箱天生像素数相等，直接统计会得到「k 个色各占 1/k」的假数据
（我第一版就是这么错的：8 色全是 `ratio: 0.125`，`dominant` 排序完全失效）。

所以我的实现是：**中位切分只用来「确定性播种」，真正归属靠 CIELAB 空间的 Lloyd 精修**
（最多 30 轮，与契约 §3.9「k-means 最多 30 轮」对齐）。这样：

- 占比是真实最近邻归属，有意义；
- 与 `quantize` 同处 CIELAB 空间，两侧结论更接近；
- 全程无随机（种子来自 median cut 的确定性切分），可复现。

**这是对契约文字的一处扩展，请 Lead 知悉。** 如果希望严格只用 median cut，
把 `analyze()` 里调用 `lloyd_refine()` 那一行删掉即可，但 `dominant` 占比会退化。

### 3.3 R4 起针规则的语义冲突

契约 §3.2 原文：「第 1 圈 `kind==='magic-ring'` 时 `stitchesIn===0`；否则报错。」
若按字面反向读（非 magic-ring 就报错），会与 §5b.2 的 `kind:'attach'` 冲突——
attach 首圈的 `stitchesIn` 必须等于留针数（≠0）。两处取交集，唯一自洽的判据是：

- `kind === 'magic-ring'` → `stitchesIn` 必须为 0
- `kind === 'attach'` → `stitchesIn` 必须等于 `attachTo.stitches`
- 其它 kind 且首圈 `stitchesIn !== 0` → 报错

Lead 的实现（`engine:747-760`）与这个交集一致，我的自测按这个语义断言。

### 3.4 R5 在 R1∧R2 成立时是恒等式

`R5` 右式 `(#V + 2#W + #CH) - (#A + 2#M + #SL + #K)` 恰好等于
`Σ(produce − consume)·n`（因为 X/T/F 的 produce−consume = 0，V:+1，A:−1，W:+2，M:−2，CH:+1，SL:−1，K:−1）。
所以 **R1 ∧ R2 同时成立时 R5 必然成立**，无法构造「R1/R2 过但 R5 失败」的图解。
R5 的价值是冗余兜底（R1/R2 之一被浮点或取整绕过时能拦住）。
我的自测因此断言的是**不误报**（含 CH/SL/A/M/K 的正常图解必须通过），而不是「能命中」。

### 3.5 `✱` 不进 `OPS`

契约 §1 表格里 `✱` 标注「不是针法，仅排版」。所以 `OPS` 只有 10 个针法记号是对的，
我的自测按 10 个断言，并额外断言 `OPS['✱']` 不该带 `consume/produce`。

### 3.6 BOM 容错

Windows 上 PowerShell 5.1 的 `Set-Content -Encoding UTF8`、记事本「另存为 UTF-8」、
Excel 导出的 JSON 都会带 BOM，而 `JSON.parse` 遇到 BOM 会抛
`Unexpected token '﻿'`（报错里的 BOM 不可见，极难排查）。
`tools/_load-engine.mjs` 的 `readJsonFile()` 统一剥掉 BOM，三个 Node CLI 都用它。

### 3.7 CLI 加载引擎的三级回退

契约要求引擎是 UMD，但落地形式（CJS / ESM / 有无 `"type":"module"`）不确定。
`_load-engine.mjs` 依次尝试 `import()` → `createRequire().require()` →
「源码当 `data:url` 再 `import()`」，然后按
`GummyEngine` → `default.GummyEngine` → `default` → 模块自身 取导出。
缺 API 时给出精确提示，而不是让调用方在深处崩掉。

### 3.8 `render-html.mjs` 的 `--check`

`--check` 渲染后调用 `tools/_selftest/render-check.mjs`（Lead 写的 DOM 桩）跑一遍产物，
确认「脚本执行无异常 + 每圈都渲染 + SVG 生成」，用来抓「渲染出来是白屏」这类问题。
失败时**HTML 已写出**但退出码 1。

---

## 4. 自测结果

```
node tools/_selftest/selftest.mjs
→ 135 / 140 通过
```

**失败的 5 条全部源于第 2 节那一个引擎 bug**（`summarizePhotoRegions` 的 `#NANNANNAN`）。
补丁在临时副本上验证后，这 5 条全部转绿（见第 2 节）。

覆盖内容（任务书要求的 6 项全部覆盖）：

1. ✅ sphere 从 6 针起针到收口，逐圈守恒全通过（19 圈，含镜像对称断言）
2. ✅ 人为构造错位圈（`stitchesIn` 写错）→ 报 R3，中文、带圈号 R5、带差值
3. ✅ `buildChart` 跑 5 部件完整玩偶（头/身/双臂/腿）→ `validation.ok === true`
4. ✅ `yarnEstimate` 总用线 38.0 m（在 20–60 m 量级内），`withBuffer` 47.5 m
5. ✅ `quantize` 对同一批像素调用两次结果完全一致（含扁平/嵌套输入等价、seed 可覆盖）
6. ✅ `node tools/validate-chart.mjs` 对合格 chart 退出码 0

额外覆盖：R1/R2/R3/R4/R5/R6/R7/R8/R9 逐条命中、`decor` 不参与守恒、
`attachTo` 接针（`kind:'attach'` / `stitchesIn === 留针数` / R9 消警）、
`circleLayout` 的 12 点起点与 `sqrt` 半径、`toNotation` 装饰标注、
三个 Node CLI 的 0/1/2 三种退出码、模板缺失降级、BOM 容错、
`analyze_photo.py` 对真实照片的绿发识别与确定性。

## 5. 照片分析链路验证

参考照片（266×264，绿发钩织娃娃）实测：

```
python tools/analyze_photo.py <photo> --k 8 --json
→ 主导色 #CBCDBF 24.63% / #6C864E 15.80% / #B7A894 11.94% / #9DAD68 11.42% …
→ 建议配色：头发 #6C864E   肤色 #B7A894   衣服 #CBCDBF
```

头发被正确识别为大面积的抹茶绿 `#6C864E`，与肉眼看图一致。
（修复前这一栏是恒定的 12.5% × 8，因为只用 median cut 统计——见 3.2。）
