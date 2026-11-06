# 人物作品归档

每个角色一个目录，标准文件：

| 文件 | 说明 |
|---|---|
| `toyspec.json` | 造型规格（可改） |
| `chart.json` | 引擎生成的逐圈图解 |
| `gummy.html` | 自包含交付页（离线可开） |
| `gummy.md` | 可选 Markdown 导出 |
| `ref.*` | 可选参考照片 |

通用底模在 `_presets/`。变体放在角色下的 `variants/`。

## 目录

| 角色 | 路径 | 说明 |
|---|---|---|
| 软糖体底模 | [`_presets/softcandy-chibi.toyspec.json`](_presets/softcandy-chibi.toyspec.json) | Q 版通用起点 |
| 芙宁娜 | [`芙宁娜/`](芙宁娜/) | 原神 · 已交付 |
| 散兵 | [`散兵/`](散兵/) | 原神 · 流浪者软糖体（主） |
| └ 放浪者变体 | [`散兵/variants/放浪者/`](散兵/variants/放浪者/) | 此前试跑规格 |
| 绿发少女 | [`绿发少女/`](绿发少女/) | 参考原型成品 |

## 重新生成示例

```powershell
node tools/build-chart.mjs characters/芙宁娜/toyspec.json --out characters/芙宁娜/chart.json
node tools/validate-chart.mjs characters/芙宁娜/chart.json
node tools/render-html.mjs characters/芙宁娜/chart.json --out characters/芙宁娜/gummy.html
```
