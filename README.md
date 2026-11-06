# 软糖图解 · Gummy Diagram

上传一张人物照片，得到一份**能照着钩完**的人形钩织玩偶图解：
逐圈针数（每圈消耗/产出并自检）、配色分段、用线量与成品尺寸，交付**单个自包含 HTML**（离线可开，可打印，记进度）。

---

## 它解决什么问题

用照片做钩织玩偶，真正的难点不是「画图」，是**针数算术**：
球体每圈加 6 针、收口要镜像对称、一个部件末圈针数必须等于下一个部件的起针数、
换色必须落在圈的起始处……任何一处算错，钩到一半就废。

模型擅长「看图说造型」，不擅长也不应该手算几十圈针数。
所以这个预设把两件事分开：

| 谁 | 负责什么 |
|---|---|
| **模型**（视觉 + 判断） | 看照片、提炼决定性特征、做 Q 版简化、配色归并、产出 `toySpec.json` |
| **引擎**（确定性代码） | 尺寸 → 圈数 → 针数、逐圈守恒校验、可钩性门槛、还原度自检、用线量、符号图坐标 |

模型**不许**手写针数；引擎**不碰**审美判断。

---

## 工作流

```
人物照片
   │  ① read_image 看 + python tools/analyze_photo.py 量化配色
   ▼
characters/<角色>/toyspec.json   ← 模型产出：部件/比例/配色
   │  ② node tools/build-chart.mjs
   ▼
characters/<角色>/chart.json     ← 引擎产出：逐圈图解 + 用线量
   │  ③ node tools/validate-chart.mjs  （不过就改 spec 重跑）
   ▼
characters/<角色>/gummy.html     ← ④ node tools/render-html.mjs，present 交付
```

---

## 快速开始

```powershell
# 0. 新角色目录（示例：芙宁娜）
New-Item -ItemType Directory -Force characters/芙宁娜 | Out-Null

# 1. 分析照片配色（输出主色、上中下三段占比、发/肤/衣建议色）
python tools/analyze_photo.py characters/芙宁娜/ref.jpg --k 8 --json

# 2. 手写或让模型生成 toyspec（可从底模复制）
#    Copy-Item characters/_presets/softcandy-chibi.toyspec.json characters/芙宁娜/toyspec.json
#    结构见 docs/CONTRACT.md §3.5；参考 docs/reference/example-toyspec.json

# 3. 生成图解
node tools/build-chart.mjs characters/芙宁娜/toyspec.json --out characters/芙宁娜/chart.json

# 4. 校验（不通过会打印具体哪一圈、差多少针）
node tools/validate-chart.mjs characters/芙宁娜/chart.json

# 4b. 还原度自检（特征层是否够认出是谁）
node tools/check-identity.mjs characters/芙宁娜/toyspec.json

# 5. 渲染成品（可加 --ref 把参考图嵌进 HTML）
node tools/render-html.mjs characters/芙宁娜/chart.json --out characters/芙宁娜/gummy.html
# node tools/render-html.mjs characters/芙宁娜/chart.json --ref characters/芙宁娜/ref.jpg --out characters/芙宁娜/gummy.html

# 6. 可选：导出 Markdown（校验不过默认拒绝写出）
node tools/export-markdown.mjs characters/芙宁娜/chart.json --out characters/芙宁娜/gummy.md
```

跑一次全量回归：

```powershell
node tests/run-tests.mjs
```

---

## 桌面应用（Tauri · 无 AI）

本地窗口改底模配色即可生成图解，不调用模型：

```powershell
cd desktop
npm install
npm run dev
```

说明见 [`desktop/README.md`](desktop/README.md)。产物仍写入 `characters/<角色>/`。

---

## 在 DSH 里使用

安装预设 bundle（本仓库已含）：

```
bundles/gummy-diagram-preset/   ← @local/dsh-gummy-diagram-preset
```

然后在 Web GUI 新建会话时选择 **「软糖图解」** 预设，直接上传人物照片即可。
该预设挂载了 `read_image`（看照片）、`pwsh`（跑引擎）、`skill-filesystem`（读两个技能）、`present`（交付）。

> ⚠️ `bundles/gummy-diagram-preset/cordis.patch.yml` 里 `skill-filesystem.customSkillDirs`
> 写的是绝对路径 `D:\Workspace\软糖图解\skills`。**移动仓库后要改这一行**并重装 bundle。

---

## 目录

按**功能**（引擎/工具/模板/技能/测试/文档）与**人物**（作品归档）分开：

```
软糖图解/
├── engine/          # 功能 · 确定性引擎
├── tools/           # 功能 · CLI 流水线
├── templates/       # 功能 · HTML 交付模板
├── skills/          # 功能 · Agent 技能
├── tests/           # 功能 · 回归测试
├── bundles/         # 功能 · DSH 预设
├── docs/            # 功能 · 契约 / 语料 / 分析
├── characters/      # 人物 · 每角色 toyspec/chart/gummy
│   ├── _presets/    #     通用软糖体底模
│   ├── 芙宁娜/
│   ├── 散兵/
│   └── 绿发少女/
├── assets/          # 素材 · 未归类图片
└── scripts/         # 辅助脚本
```

| 路径 | 内容 |
|---|---|
| `engine/gummy-engine.js` | 确定性引擎（UMD，零依赖，浏览器+Node 双用） |
| `tools/` | CLI：`analyze_photo.py` / `build-chart` / `validate-chart` / `render-html` / `check-identity` / `export-markdown` |
| `templates/gummy-atelier.html` | 自包含交付模板（占位符注入） |
| `skills/photo-to-toy/` | 技能：照片 → 造型规格 |
| `skills/crochet-craft/` | 技能：钩织工艺 |
| `tests/` | 回归测试，入口 `run-tests.mjs` |
| `docs/CONTRACT.md` | **接口契约** |
| `docs/reference/` · `docs/corpus/` | 参考原型与语料 |
| `bundles/` | DSH Agent 预设 |
| `characters/` | **按人物归档**作品与底模（见该目录 README） |
| `assets/` | 未归入角色的素材 |
| `scripts/` | 辅助脚本 |

---

## 校验不变量

引擎对每一圈强制以下规则，任何一条不满足即判定图解不可交付：

| # | 规则 |
|---|---|
| R1 | 本圈所有针法的消耗总数 = 本圈 `stitchesIn` |
| R2 | 本圈所有针法的产出总数 = 本圈 `stitchesOut` |
| R3 | 第 *i* 圈的 `stitchesIn` = 第 *i−1* 圈的 `stitchesOut` |
| R4 | 第 1 圈若为环形起针，`stitchesIn` 必须为 0 |
| R5 | 增量 = 加针数 − 减针数（含 `W`/`M`/`SL`/`K`） |
| R6 | 配色 id 必须存在于 `palette` |
| R7 | 任意圈 6 ≤ `stitchesOut` ≤ 200 且为整数 |
| R8 | 装饰针迹 `count × every` = 本圈 `stitchesOut` |
| R9 | 留了半针却没有部件接上 → 警告（不影响通过） |
| R10 | `attachTo` 目标圈存在且针数一致 |
| R11 | 主体（头/身/发）最宽圈 &lt; 18 → 失败；&lt; 24 → 警告 |

---

## 自我学习 / 自我改进

这个预设被设计成**越用越准**，靠三条闭环，不靠「模型记得」：

1. **契约冻结算术** — `docs/CONTRACT.md` 是唯一真相。引擎改了公式、模板改了字段，必须先改契约。
   模型每次会话都读同一份契约，不会因为上下文漂移而换算法。

2. **测试即记忆** — `tests/` 里每条 R1–R9 都有「能通过的用例」与「人为构造的反例」。
   任何改动让旧结论失效，`node tests/run-tests.mjs` 立刻变红。这是可执行的记忆，不是文档。

3. **错误回流到知识层** — 当真实钩织暴露了引擎的盲区（例如「卷曲针不改变针数」这种
   算术上看不见、成品上却关键的工艺），处理路径是固定的：

   ```
   真实作品暴露问题
      → 归档到 docs/reference/（保留原始证据）
      → 判断是「算术」还是「工艺」问题
            算术 → 改 engine/ + 扩 tests/ 的反例
            工艺 → 改 skills/ 的规则表
      → 更新 docs/CONTRACT.md
      → node tests/run-tests.mjs 全绿才算完
   ```

   **实例**：参考原型 `docs/reference/build-prototype.py` 是一份真实交付过的图解，
   它用了「在 36 针圈上挂 18 个卷曲针做卷发」和「只钩内半针、把外半针留给荷叶边」两种工艺。
   这两种工艺在原始契约里完全没有位置——按原契约，卷发根本无法表达。
   于是契约升到 v1.1，新增 `decor`（装饰针迹，R8）与 `loop`（半针留针，R9），
   并把这条经验写进两个技能。**这就是一次完整的学习闭环。**

4. **参考原型即语料** — `docs/reference/` 保留手工版与示例，让后续改进有对照物：
   新引擎的输出应当与手工版在工艺细节上可比，但覆盖范围远超它（任意造型 vs 一个作品）。

---

## 已知边界

- **只处理正面单人照**。侧脸、多人、全身远景会走「主动问用户」分支。
- **配色上限 8 色**。再多就是买线不现实，引擎会强制归并。
- **不生成实物**：交付的是图解与用量，钩针动作本身仍需人来做。
- **织物的软塌无法建模**：图解保证针数自洽，但真实张力、手感、塞棉多少仍靠手。
- `analyze_photo.py` 依赖 PIL + numpy（本机已具备）。
