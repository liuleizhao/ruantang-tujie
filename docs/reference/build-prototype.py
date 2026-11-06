# -*- coding: utf-8 -*-
"""
「软糖图解」生成器：gummy-绿发女孩
- 逐圈数据 + 针数自动校验
- 内嵌 SVG 符号图（每个部件一张）
- 输出单个自包含 HTML
"""
import re, math, json, html as _html

# ---------------- 配色 ----------------
C = {
    "cream":   ("#F6E9D8", "#C9B49A", "奶油米白"),
    "lgreen":  ("#A5D06B", "#7BA648", "浅草绿"),
    "dgreen":  ("#3D6B3A", "#2A4C28", "深森林绿"),
    "white":   ("#FAF7F0", "#C4BEAF", "本白"),
    "taupe":   ("#8C7F6B", "#6A5F4F", "灰褐（绣线）"),
}

# ---------------- 针法解析 ----------------
ST_NAME = {"X": "短针", "V": "加针", "A": "减针", "T": "中长针", "F": "长针", "SL": "引拔"}

def parse(pat):
    """解析图解串 -> (seq, produced, inc, dec)
    支持: '30X' | '6V' | '6(X,V)' | '6(3X,A)' | '6(4X,V)' | '18X'
    """
    p = pat.replace(" ", "")
    m = re.fullmatch(r"(\d+)\(([^()]+)\)", p)
    if m:
        n = int(m.group(1)); inner = m.group(2)
        unit = []
        for mm in re.finditer(r"(\d*)([XVA])", inner):
            k = int(mm.group(1)) if mm.group(1) else 1
            unit += [mm.group(2)] * k
        seq = unit * n
        inc = unit.count("V") * n
        dec = unit.count("A") * n
        return seq, len(seq), inc, dec
    m = re.fullmatch(r"(\d+)([XVA])", p)
    if m:
        n = int(m.group(1)); st = m.group(2)
        seq = [st] * n
        return seq, len(seq), seq.count("V"), seq.count("A")
    raise ValueError("无法解析: " + pat)

# ---------------- 部件数据 ----------------
# 每个 round: r 圈号, pat 纯图解, cons 消耗, prod 产出, note 备注, extra 额外针跡
# start: 'ring'（魔术环，R1 消耗=产出）| 数字（链环，消耗=该数）
PARTS = [
    {
        "id": "head", "name": "头部", "color": "cream", "start": "ring",
        "spec": "奶油米白 · 2.0–2.5 mm 钩针 · 环起 6X",
        "note": "球体，正面留平面做脸。R8 起塞棉，边塞边收，塞到八分满再收口。",
        "rounds": [
            ("环起 6X",        "6X"),
            ("6V",            "6V"),
            ("6(X,V)",        "6(X,V)"),
            ("6(2X,V)",       "6(2X,V)"),
            ("6(3X,V)",       "6(3X,V)"),
            ("30X",           "30X"),
            ("30X",           "30X"),
            ("6(3X,A)",       "6(3X,A)"),
            ("6(2X,A)",       "6(2X,A)"),
            ("6(X,A)",        "6(X,A)"),
            ("6A",            "6A"),
        ],
        "finish": "收紧 6 针，藏线头。成品约 4.0 cm 宽 × 3.9 cm 高。",
    },
    {
        "id": "body", "name": "身体", "color": "lgreen", "start": "ring",
        "spec": "浅草绿 · 环起 6X · 由下往上",
        "note": "R6 只钩**内半针**，把 R5 的 30 个外半针留下来给下摆荷叶边用。",
        "rounds": [
            ("环起 6X",        "6X"),
            ("6V",            "6V"),
            ("6(X,V)",        "6(X,V)"),
            ("6(2X,V)",       "6(2X,V)"),
            ("6(3X,V)",       "6(3X,V)"),
            ("内半针 30X",     "30X"),
            ("6(3X,A)",       "6(3X,A)"),
            ("6(2X,A)",       "6(2X,A)"),
            ("18X",           "18X"),
        ],
        "finish": "留约 20 cm 线头，与头部缝合一圈。成品约 4.0 cm 宽 × 3.2 cm 高。",
    },
    {
        "id": "hem", "name": "下摆荷叶边", "color": "white", "start": 30,
        "spec": "本白 · 接在身体 R5 的 30 个外半针上",
        "note": "起针位置 = 身体最宽那一圈的外半针，钩出来的边朝下翻。",
        "rounds": [
            ("30X",           "30X"),
            ("15(X,V)",       "15(X,V)"),
            ("45X",           "45X"),
        ],
        "finish": "不加不减收针，边会自然外翻成荷叶。成品外径约 6.0 cm。",
    },
    {
        "id": "collar", "name": "领口荷叶边", "color": "white", "start": "ring",
        "spec": "本白 · 环起 18X（= 领口 3.0 cm）",
        "note": "单独钩一片，内圈 18 针套进脖口，沿内圈缝一圈即固定。",
        "rounds": [
            ("环起 18X",      "18X"),
            ("18V",          "18V"),
            ("36X",          "36X"),
        ],
        "finish": "套过头部，内圈与身体脖口对齐缝合。外径约 5.0 cm。",
    },
    {
        "id": "arm", "name": "手臂（钩 2 只）", "color": "cream", "start": "ring",
        "spec": "奶油米白 · 环起 6X · ×2",
        "note": "塞极少量棉，收口后压扁。缝在身体 R9 上方、左右距中线 1 cm 处。",
        "rounds": [
            ("环起 6X",        "6X"),
            ("6V",            "6V"),
            ("12X",           "12X"),
            ("12X",           "12X"),
            ("6A",            "6A"),
        ],
        "finish": "收 6 针，藏线。每只约 1.6 cm 宽 × 1.8 cm 长。",
    },
    {
        "id": "hat", "name": "帽冠", "color": "dgreen", "start": "ring",
        "spec": "深森林绿 · 环起 6X",
        "note": "R7 可在每 3 针钩 1 个 3 长针枣针（共 12 个），做出图中的颗粒感；枣针不改变针数。",
        "rounds": [
            ("环起 6X",        "6X"),
            ("6V",            "6V"),
            ("6(X,V)",        "6(X,V)"),
            ("6(2X,V)",       "6(2X,V)"),
            ("6(3X,V)",       "6(3X,V)"),
            ("6(4X,V)",       "6(4X,V)"),
            ("36X",           "36X"),
            ("36X",           "36X"),
        ],
        "finish": "翻面（反面朝外），帽檐边缘略压扁成贝雷帽的扁圆顶。宽约 4.8 cm。",
    },
    {
        "id": "brim", "name": "帽檐白卷边", "color": "white", "start": 36,
        "spec": "本白 · 36CH 环连",
        "note": "钩 4 圈直筒后纵向对折成双层，套在帽冠下缘缝住，就是图中那条厚白边。",
        "rounds": [
            ("36CH 环连，36X", "36X"),
            ("36X",           "36X"),
            ("36X",           "36X"),
            ("36X",           "36X"),
        ],
        "finish": "对折（4 圈变 2 层），环宽约 0.7 cm。",
    },
    {
        "id": "hair", "name": "头发（发帽 + 卷发）", "color": "lgreen", "start": "ring",
        "spec": "浅草绿 · 环起 6X",
        "note": "R8 是卷发圈：在每 2 针上钩 1 个卷曲针，共 18 个。卷曲针属于额外针跡，不改变主体针数，所以 R8 仍是 36 针。正面中央 3 个用短卷（4CH），其余 15 个用长卷（6CH）。",
        "rounds": [
            ("环起 6X",        "6X"),
            ("6V",            "6V"),
            ("6(X,V)",        "6(X,V)"),
            ("6(2X,V)",       "6(2X,V)"),
            ("6(3X,V)",       "6(3X,V)"),
            ("6(4X,V)",       "6(4X,V)"),
            ("36X",           "36X"),
            ("18×卷曲针",      "36X"),
        ],
        "finish": "发帽套在头上，前缘压在眉毛上方，18 条卷发自然垂下到下巴。",
    },
    {
        "id": "curl", "name": "侧长卷发（钩 2 条）", "color": "lgreen", "start": 15,
        "spec": "浅草绿 · 起 16CH · ×2",
        "note": "从第 2 个锁针起，每个锁针内钩 3X（共 15 个可用锁针）。3 针挤 1 针会自己卷成螺旋，边钩边卷属正常。",
        "rounds": [
            ("16CH 起，15×3X", "15(3X)"),
        ],
        "finish": "末端 SL 收，线头藏进螺旋里。每条长约 3.5 cm，缝在耳侧。",
        "manual_inc": 30,
    },
    {
        "id": "flower", "name": "花饰", "color": "white", "start": "ring",
        "spec": "象牙白 · 环起 5X · 缝在帽子右侧",
        "note": "R2 的 5 片花瓣是额外针跡（每片 2CH + 2T + 2CH + SL），中心保持 5 针不变。",
        "rounds": [
            ("环起 5X",       "5X"),
            ("5×(2CH,同针2T,2CH,SL)", "5X"),
        ],
        "finish": "中心缝 1 颗小珍珠当花蕊。花径约 1.4 cm。",
    },
    {
        "id": "leaf", "name": "叶片", "color": "dgreen", "start": "ring",
        "spec": "深森林绿 · 环起 6X",
        "note": "钩完压扁成椭圆，用浅色绣线在中间绣 1 条叶脉。",
        "rounds": [
            ("环起 6X",       "6X"),
            ("6V",           "6V"),
            ("12X",          "12X"),
        ],
        "finish": "压扁，长约 1.5 cm。缝在花下方。",
    },
]

# ---------------- 校验 ----------------
def validate():
    report = {}
    ok_all = True
    for part in PARTS:
        rows = []
        prev = None
        start = part["start"]
        for i, (label, pat) in enumerate(part["rounds"], start=1):
            seq, prod, inc, dec = parse(pat)
            if part.get("manual_inc") is not None and i == 1:
                inc = part["manual_inc"]
                prod = len(seq)
            cons = prod if i == 1 and start == "ring" else (start if i == 1 else prev)
            delta = prod - cons
            incdec = inc - dec
            ok1 = (i == 1) or (cons == prev)
            ok2 = (delta == incdec)
            ok_all = ok_all and ok1 and ok2
            rows.append({
                "r": i, "label": label, "pat": pat, "seq": seq,
                "cons": cons, "prod": prod, "inc": inc, "dec": dec,
                "delta": delta, "ok1": ok1, "ok2": ok2,
            })
            prev = prod
        report[part["id"]] = {"rows": rows, "final": prev,
                              "ok": all(r["ok1"] and r["ok2"] for r in rows)}
    return report, ok_all

REPORT, OK_ALL = validate()

# ---------------- SVG 符号图 ----------------
def mark_path(st):
    if st == "X":
        return '<path class="mk" d="M-3.6,-3.6 L3.6,3.6 M3.6,-3.6 L-3.6,3.6"/>'
    if st == "V":
        return '<path class="mk" d="M-4.4,3.2 L0,-3.6 L4.4,3.2"/>'
    if st == "A":
        return '<path class="mk" d="M-4.4,-3.2 L0,3.6 L4.4,-3.2"/>'
    return ""

def chart(part):
    rows = REPORT[part["id"]]["rows"]
    fill, stroke, _ = C[part["color"]]
    n_r = len(rows)
    r0, pitch = 36.0, 20.0
    rmax = r0 + (n_r - 1) * pitch
    pad = 70
    size = (rmax + pad) * 2
    cx = cy = size / 2
    out = []
    out.append(f'<svg viewBox="0 0 {size:.0f} {size:.0f}" class="chart" role="img" aria-label="{_html.escape(part["name"])} 符号图">')
    # 背景
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{rmax+34:.1f}" fill="#FFFFFF" stroke="#E7E1D4" stroke-width="1"/>')
    for k, row in enumerate(rows, start=1):
        r = r0 + (k - 1) * pitch
        n = row["prod"]
        g = [f'<g class="ring" id="{part["id"]}-r{k}">']
        # 圈线
        g.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="none" stroke="{stroke}" stroke-opacity=".22" stroke-width="1" stroke-dasharray="2 3"/>')
        # 针目
        for i, st in enumerate(row["seq"]):
            ang = -90 + 360.0 * i / n
            g.append(f'<g transform="translate({cx:.2f},{cy:.2f}) rotate({ang:.3f}) translate(0,{-r:.2f})" '
                     f'stroke="{stroke}" stroke-width="1.7" stroke-linecap="round">'
                     f'{mark_path(st)}</g>')
        # 圈号
        g.append(f'<text x="{cx + r + 9:.1f}" y="{cy + 4:.1f}" class="rnum" fill="{stroke}" '
                 f'stroke="#FFFFFF" stroke-width="3.2" paint-order="stroke">R{k}</text>')
        g.append('</g>')
        out.append("".join(g))
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4" fill="{stroke}" fill-opacity=".55"/>')
    out.append('</svg>')
    return "".join(out)

def legend_svg():
    items = [("X", "短针 X"), ("V", "加针 V（1 针里钩 2 针）"), ("A", "减针 A（2 针并 1 针）")]
    w, h = 640, 86
    parts = [f'<svg viewBox="0 0 {w} {h}" class="legend-svg" role="img" aria-label="符号图例">']
    parts.append(f'<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="10" fill="#FCFAF4" stroke="#E7E1D4"/>')
    x = 28
    for st, label in items:
        parts.append(f'<g transform="translate({x},34)" stroke="#3D6B3A" stroke-width="2" stroke-linecap="round">{mark_path(st)}</g>')
        parts.append(f'<text x="{x+16}" y="39" font-size="13" fill="#4A4438">{_html.escape(label)}</text>')
        x += 215
    parts.append(f'<text x="28" y="70" font-size="12" fill="#8C8272">同心圆 = 圈号 R1…Rn；沿顺时针从圆心向外读；每一针的位置按等分角度排布，加针/减针落在实际位置上。</text>')
    parts.append('</svg>')
    return "".join(parts)

# ---------------- HTML ----------------
def esc(s): return _html.escape(str(s), quote=True)

CSS = """
:root{
  --ink:#3B3730; --ink2:#6B6458; --ink3:#948C7E;
  --line:#E6E0D3; --bg:#FBF8F1; --card:#FFFFFF;
  --green:#3D6B3A; --green2:#7BA648; --lime:#A5D06B; --cream:#F6E9D8; --pink:#F4A8B4;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  line-height:1.7;font-size:15px}
.wrap{max-width:1040px;margin:0 auto;padding:32px 20px 96px}
header.top{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.badge{width:64px;height:64px;border-radius:22px;flex:none;
  background:radial-gradient(circle at 34% 30%,#C6E59B,#A5D06B 46%,#3D6B3A 100%);
  box-shadow:inset 0 -6px 14px rgba(0,0,0,.16),0 6px 16px rgba(61,107,58,.22);position:relative}
.badge::after{content:"";position:absolute;inset:auto 8px 12px 8px;height:6px;border-radius:6px;background:#FAF7F0;opacity:.92}
h1{font-size:25px;margin:0;letter-spacing:.5px}
.sub{color:var(--ink2);font-size:13.5px;margin-top:2px}
h2{font-size:19px;margin:38px 0 12px;padding-bottom:8px;border-bottom:2px solid #EFE9DA}
h3{font-size:15.5px;margin:22px 0 8px}
p{margin:8px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0;
  box-shadow:0 1px 2px rgba(0,0,0,.03)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.kv{display:grid;grid-template-columns:96px 1fr;gap:6px 12px;font-size:14px}
.kv dt{color:var(--ink3)}
.kv dd{margin:0}
.swatches{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.sw{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--ink2);
  border:1px solid var(--line);border-radius:999px;padding:4px 12px 4px 6px;background:#fff}
.dot{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}

/* 部件 */
.part{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin:18px 0;
  box-shadow:0 1px 3px rgba(0,0,0,.04);page-break-inside:avoid;break-inside:avoid}
.part-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.part-head h2{margin:0;border:0;padding:0;font-size:18px}
.chip{font-size:12px;border-radius:999px;padding:2px 10px;background:#F3F0E6;color:var(--ink2)}
.part-note{font-size:13.5px;color:var(--ink2);background:#FBF9F2;border-left:3px solid var(--lime);
  padding:8px 12px;border-radius:0 8px 8px 0;margin:12px 0}
.part-body{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start}
@media(max-width:860px){.part-body{grid-template-columns:1fr}}
svg.chart{width:100%;height:auto;display:block}
svg.legend-svg{width:100%;height:auto;display:block;max-width:680px}

/* 表格 */
table.rounds{width:100%;border-collapse:collapse;font-size:13.5px}
table.rounds th{text-align:left;font-weight:600;color:var(--ink3);font-size:12px;letter-spacing:.4px;
  padding:6px 8px;border-bottom:1.5px solid var(--line);white-space:nowrap}
table.rounds td{padding:6px 8px;border-bottom:1px solid #F2EEE4;vertical-align:middle}
table.rounds td.num{font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap}
table.rounds td.pat{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
tr.round{cursor:pointer;transition:background .12s}
tr.round:hover{background:#FAF8F0}
tr.round.done td{color:var(--ink3)}
tr.round.done .pat{text-decoration:line-through;text-decoration-color:#CFC8B6}
tr.round.hl{background:#EFF8E1;box-shadow:inset 3px 0 0 var(--green2)}
tr.round.hl td{border-bottom-color:#DDEBC9}
.ok{color:#5B8C3E;font-weight:600}
.bad{color:#C2410C;font-weight:600}
input[type=checkbox]{width:16px;height:16px;accent-color:#6FA84A;cursor:pointer}

/* 进度条 */
.toolbar{position:sticky;top:0;z-index:20;background:rgba(251,248,241,.94);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);padding:10px 0;margin:18px 0 6px}
.tb-inner{max-width:1040px;margin:0 auto;padding:0 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.bar{flex:1;min-width:180px;height:9px;border-radius:99px;background:#EAE4D6;overflow:hidden}
.bar>i{display:block;height:100%;width:0;border-radius:99px;
  background:linear-gradient(90deg,#A5D06B,#6FA84A);transition:width .3s}
.tb-txt{font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums;min-width:118px}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:#fff;color:var(--ink2);
  border-radius:9px;padding:5px 13px;cursor:pointer}
button:hover{border-color:#CFC8B6;color:var(--ink)}

/* 校验表 */
table.verify{width:100%;border-collapse:collapse;font-size:13px}
table.verify th{background:#F6F2E8;color:var(--ink2);font-weight:600;padding:7px 8px;text-align:left;
  border-bottom:1.5px solid var(--line);font-size:12px;white-space:nowrap}
table.verify td{padding:5px 8px;border-bottom:1px solid #F2EEE4;font-variant-numeric:tabular-nums}
table.verify tr:last-child td{font-weight:600;background:#FBF9F2}
.verdict{display:flex;gap:10px;align-items:flex-start;background:#F2F8E9;border:1px solid #D6E7BE;
  border-radius:12px;padding:12px 16px;margin:12px 0;font-size:14px}
.verdict .ic{font-weight:700;color:#4E7A33}
ul.tight{margin:6px 0 6px 0;padding-left:20px}
ul.tight li{margin:3px 0}
.tip{font-size:13px;color:var(--ink2)}
code{background:#F4F1E7;border-radius:5px;padding:1px 5px;font-size:.92em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink3);font-size:12.5px}

/* 打印 */
@media print{
  @page{margin:12mm 12mm}
  body{background:#fff;font-size:10.5pt;line-height:1.45}
  .wrap{max-width:none;padding:0}
  .toolbar,.no-print{display:none !important}
  .part{break-inside:avoid;box-shadow:none;border-color:#DDD;margin:10px 0;padding:10px 12px}
  .part-body{grid-template-columns:250px 1fr;gap:12px}
  svg.chart{max-width:250px}
  h1{font-size:17pt}
  h2{font-size:12.5pt;margin:14px 0 6px}
  .card{box-shadow:none;padding:10px 12px}
  table.rounds{font-size:9.5pt}
  table.rounds td,table.rounds th{padding:3px 6px}
  tr.round.done .pat{text-decoration:none}
  a{color:inherit;text-decoration:none}
  .pagebreak{break-before:page}
}
"""

JS = """
(function(){
  var KEY='gummy-green-girl-v1';
  var store={};
  try{ store=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ store={}; }
  var checks=Array.prototype.slice.call(document.querySelectorAll('input.pchk'));
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(store)); }catch(e){} }
  function refresh(){
    var done=0, per={
      head:[0,0],body:[0,0],hem:[0,0],collar:[0,0],arm:[0,0],
      hat:[0,0],brim:[0,0],hair:[0,0],curl:[0,0],flower:[0,0],leaf:[0,0]
    };
    checks.forEach(function(c){
      var id=c.getAttribute('data-key');
      var tr=c.closest('tr');
      if(c.checked){ done++; tr.classList.add('done'); } else { tr.classList.remove('done'); }
      var pid=c.getAttribute('data-part');
      if(per[pid]){ per[pid][1]++; if(c.checked) per[pid][0]++; }
    });
    var tot=checks.length;
    var pct= tot? Math.round(done/tot*100):0;
    document.getElementById('bar').style.width=pct+'%';
    document.getElementById('ptxt').textContent=done+' / '+tot+' 圈 · '+pct+'%';
    Object.keys(per).forEach(function(pid){
      var el=document.getElementById('prog-'+pid);
      if(el){ el.textContent=per[pid][0]+'/'+per[pid][1]; }
    });
  }
  checks.forEach(function(c){
    var k=c.getAttribute('data-key');
    c.checked=!!store[k];
    c.addEventListener('change',function(){ store[k]=c.checked?1:0; save(); refresh(); });
  });
  // 逐圈高亮
  function clearHl(){
    document.querySelectorAll('tr.round.hl').forEach(function(t){t.classList.remove('hl');});
    document.querySelectorAll('g.ring.hl-ring').forEach(function(g){g.classList.remove('hl-ring');});
  }
  document.querySelectorAll('tr.round').forEach(function(tr){
    tr.addEventListener('click',function(e){
      if(e.target.tagName==='INPUT') return;
      var already=tr.classList.contains('hl');
      clearHl();
      if(already) return;
      tr.classList.add('hl');
      var pid=tr.getAttribute('data-part'), r=tr.getAttribute('data-r');
      var g=document.getElementById(pid+'-r'+r);
      if(g){ g.classList.add('hl-ring'); var b=g.getBBox();
        var svg=g.ownerSVGElement;
        if(svg && svg.setAttribute){ 
          var pad=26;
          svg.setAttribute('viewBox',(b.x-pad)+' '+(b.y-pad)+' '+(b.width+pad*2)+' '+(b.height+pad*2));
          svg.dataset.base=svg.dataset.base||svg.getAttribute('viewBox');
        }
      }
    });
  });
  document.addEventListener('click',function(e){
    if(!e.target.closest('tr.round')) {
      clearHl();
      document.querySelectorAll('svg.chart').forEach(function(s){ if(s.dataset.base){ s.setAttribute('viewBox',s.dataset.base);} });
    }
  });
  // 打印时自动全部取消高亮
  window.addEventListener('beforeprint',function(){
    document.querySelectorAll('svg.chart').forEach(function(s){ if(s.dataset.base){ s.setAttribute('viewBox',s.dataset.base);} });
  });
  var rb=document.getElementById('reset');
  if(rb){ rb.addEventListener('click',function(){
    store={}; save();
    checks.forEach(function(c){ c.checked=false; });
    refresh();
  });}
  refresh();
})();
"""

def part_html(part):
    rep = REPORT[part["id"]]
    rows = rep["rows"]
    fill, stroke, cname = C[part["color"]]
    total = len(rows)
    trs = []
    for row in rows:
        key = f'{part["id"]}-{row["r"]}'
        mark = '<span class="ok">✓</span>' if (row["ok1"] and row["ok2"]) else '<span class="bad">✗</span>'
        trs.append(
            f'<tr class="round" data-part="{part["id"]}" data-r="{row["r"]}">'
            f'<td class="num">{row["r"]}</td>'
            f'<td class="pat">{esc(row["label"])}</td>'
            f'<td class="num">{row["cons"]}</td>'
            f'<td class="num">{row["prod"]}</td>'
            f'<td class="num">{"+" if row["delta"]>=0 else ""}{row["delta"]}</td>'
            f'<td class="num">{mark}</td>'
            f'<td class="num"><input class="pchk" type="checkbox" data-key="{key}" data-part="{part["id"]}" '
            f'aria-label="标记 R{row["r"]} 完成"></td>'
            f'</tr>'
        )
    note = part["note"].replace("**", "")
    return f'''
    <section class="part" id="part-{part["id"]}">
      <div class="part-head">
        <h2>{esc(part["name"])}</h2>
        <span class="chip" style="background:{fill};color:{stroke}">{esc(cname)}</span>
        <span class="chip">{total} 圈</span>
        <span class="chip">进度 <b id="prog-{part["id"]}">0/{total}</b></span>
      </div>
      <div class="part-note">{esc(part["spec"])} · {esc(note)}</div>
      <div class="part-body">
        <div>{chart(part)}</div>
        <div>
          <table class="rounds">
            <thead><tr>
              <th>圈</th><th>图解</th><th>消耗</th><th>产出</th><th>增量</th><th>校验</th><th>✓</th>
            </tr></thead>
            <tbody>{"".join(trs)}</tbody>
          </table>
          <p class="tip" style="margin-top:10px">{esc(part["finish"])}</p>
        </div>
      </div>
    </section>'''

def verify_section():
    total_rounds = sum(len(p["rounds"]) for p in PARTS)
    bad = [r for pid, d in REPORT.items() for r in d["rows"] if not (r["ok1"] and r["ok2"])]
    final_sum = sum(d["final"] for d in REPORT.values())
    body_rows = []
    cats = [
        ("头部", ["head"]), ("身体", ["body"]), ("下摆荷叶边", ["hem"]), ("领口荷叶边", ["collar"]),
        ("手臂 ×2", ["arm"]), ("帽冠", ["hat"]), ("帽檐白卷边", ["brim"]),
        ("发帽（含卷发圈）", ["hair"]), ("侧长卷发 ×2", ["curl"]), ("花饰", ["flower"]), ("叶片", ["leaf"]),
    ]
    for name, ids in cats:
        for pid in ids:
            d = REPORT[pid]
            body_rows.append(
                f'<tr><td>{name}</td><td>{len(d["rows"])}</td><td>{d["final"]}</td>'
                f'<td>{"✓ 全部吻合" if d["ok"] else "✗ 有问题"}</td></tr>'
            )
    return f'''
  <h2 id="verify">自检结果</h2>
  <div class="verdict">
    <span class="ic">{"✓ 通过" if not bad else "✗ 未通过"}</span>
    <div>
      共 <b>{total_rounds}</b> 圈，逐圈核对两条规则：<br>
      ① 本圈消耗针数 = 上一圈产出针数 &nbsp;→&nbsp; {"全部相等" if not bad else f"{len(bad)} 处不符"}<br>
      ② 本圈产出 − 本圈消耗 = 加针数 − 减针数 &nbsp;→&nbsp; {"全部相等" if not bad else f"{len(bad)} 处不符"}<br>
      ③ 各部件最终针数合计 = <b>{final_sum}</b> 针（见下表），与正文每一部件末圈产出逐项吻合。
    </div>
  </div>
  <div class="card" style="overflow-x:auto">
    <table class="verify">
      <thead><tr><th>部件</th><th>圈数</th><th>末圈针数</th><th>逐圈结论</th></tr></thead>
      <tbody>{"".join(body_rows)}
        <tr><td>合计</td><td>{total_rounds}</td><td>{final_sum}</td><td>—</td></tr>
      </tbody>
    </table>
  </div>'''

def build():
    parts_html = "".join(part_html(p) for p in PARTS)
    nav = "".join(f'<a href="#part-{p["id"]}">{esc(p["name"])}</a>' for p in PARTS)
    doc = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>绿发女孩 · 钩织图解</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <div class="badge" aria-hidden="true"></div>
  <div>
    <h1>绿发女孩 · 钩织图解</h1>
    <div class="sub">Q 版坐姿小人偶 ｜ 2.0–2.5 mm 钩针 + 4 ply 棉线 ｜ 成品约 8 cm</div>
  </div>
</header>

<p class="sub" style="margin-top:10px">
  深森林绿贝雷帽冠 + 本白厚卷边 + 浅草绿卷发 + 米白脸/手 + 本白荷叶边领与下摆 + 帽侧白花。
  点击任意一圈可高亮，勾选框会保存在本机（localStorage）。
</p>

<h2 id="materials">材料与规格</h2>
<div class="grid2">
  <div class="card">
    <h3 style="margin-top:0">用线与用针</h3>
    <dl class="kv">
      <dt>线材</dt><dd>4 ply 棉线（牛奶棉 / 纯棉均可）</dd>
      <dt>钩针</dt><dd>2.0–2.5 mm（脸和手用 2.0 mm 更紧，帽冠用 2.5 mm 更挺）</dd>
      <dt>密度</dt><dd>密实短针：1 cm ≈ 2.4 针 × 2.8 圈</dd>
      <dt>成品</dt><dd>高约 8 cm × 宽约 5 cm（含领口荷叶边）</dd>
      <dt>难度</dt><dd>入门（卷曲针需先练 3–5 条）</dd>
    </dl>
    <div class="swatches">
      <span class="sw"><i class="dot" style="background:#F6E9D8"></i>奶油米白</span>
      <span class="sw"><i class="dot" style="background:#A5D06B"></i>浅草绿</span>
      <span class="sw"><i class="dot" style="background:#3D6B3A"></i>深森林绿</span>
      <span class="sw"><i class="dot" style="background:#FAF7F0;box-shadow:inset 0 0 0 1px #D8D2C2"></i>本白</span>
      <span class="sw"><i class="dot" style="background:#F4A8B4"></i>腮红粉</span>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">用量与工具</h3>
    <dl class="kv">
      <dt>奶油米白</dt><dd>约 20 g（头、手）</dd>
      <dt>浅草绿</dt><dd>约 25 g（身体、头发）</dd>
      <dt>深森林绿</dt><dd>约 15 g（帽冠、叶）</dd>
      <dt>本白</dt><dd>约 10 g（帽边、领、下摆、花）</dd>
      <dt>工具</dt><dd>填充棉、缝合针、记号扣、绣线（深绿／白）、小珍珠 1 颗、腮红或色粉</dd>
    </dl>
    <p class="tip" style="margin-bottom:0">记号统一：<code>R</code> 圈号 · <code>X</code> 短针 · <code>V</code> 加针 · <code>A</code> 减针 · <code>CH</code> 锁针 · <code>T</code> 中长针 · <code>F</code> 长针 · <code>SL</code> 引拔。重复体写清倍数，如 <code>6(X,V)</code> 表示「(1 短针, 1 加针) 重复 6 次」。</p>
  </div>
</div>

<h2 id="legend">符号图例</h2>
<div class="card">{legend_svg()}
<p class="tip" style="margin-bottom:0">每张图 = 俯视一个部件；圆心是起针点，由内向外一圈一圈读。图上每个符号 = 一个针目，位置按该圈针数等分，所以加针会出现在和实际钩出来一致的方向上。</p>
</div>

<h2 id="order">制作顺序</h2>
<div class="card">
  <ol class="tight" style="margin:0">
    <li><b>头</b> → 塞棉收口。</li>
    <li><b>身体</b>（R6 内半针，留 30 个外半针）→ 在下摆外半针上钩<b>下摆荷叶边</b>。</li>
    <li><b>领口荷叶边</b>单独钩好，套过脖子，等头缝上身体时一起压住。</li>
    <li><b>手臂 ×2</b> → 缝在身体上。</li>
    <li><b>帽冠</b> + <b>帽檐白卷边</b> → 组合成帽子。</li>
    <li><b>发帽</b> → 在最后 36 针上钩 18 个卷曲针；另钩 <b>2 条侧长卷发</b>。</li>
    <li>头发戴在头上，帽子压在头发上，<b>花</b>+<b>叶</b>缝在帽右侧。</li>
    <li>绣眼睛、嘴，扫腮红。</li>
  </ol>
</div>

<div class="toolbar no-print">
  <div class="tb-inner">
    <div class="bar"><i id="bar"></i></div>
    <div class="tb-txt" id="ptxt">0 / 0 圈 · 0%</div>
    <button id="reset" type="button">清空进度</button>
    <button type="button" onclick="window.print()">打印</button>
  </div>
</div>

<h2 id="parts">逐圈图解</h2>
{parts_html}

<h2 id="faces">脸与细节（不计数）</h2>
<div class="grid2">
  <div class="card">
    <h3 style="margin-top:0">五官刺绣</h3>
    <ul class="tight">
      <li><b>眼睛</b>：深绿绣线，在脸中线左右各 1.0 cm 处，竖着拉 3 针缎面绣（约 3 × 4 mm），上端略收成杏仁形。</li>
      <li><b>高光</b>：白色绣线在每只眼睛右上方点 1 针（约 1 mm）。</li>
      <li><b>嘴</b>：粉色绣线，在眼睛下方 0.8 cm 处绣 1 针短横（约 3 mm）。</li>
      <li><b>腮红</b>：粉底液或色粉用小刷子扫在两颊，边缘晕开；也可用粉色绣线横向松绣 2 针。</li>
    </ul>
  </div>
  <div class="card">
    <h3 style="margin-top:0">组合顺序要点</h3>
    <ul class="tight">
      <li>头部底端（收口的 6 针）塞进身体领口 18 针里，沿颈部缝一圈；缝到一半时把<b>领口荷叶边</b>内圈夹进去一起缝。</li>
      <li>发帽前缘压在<b>眉毛上沿</b>，不要压住眼睛；发帽下沿用藏针法固定在头两侧。</li>
      <li>帽冠内塞薄薄一层棉撑形，帽檐白卷边套在帽冠下缘后缝合；整顶帽子只在前额两侧各缝 2–3 针固定，方便以后取下。</li>
      <li>两侧长卷发从耳侧垂下，末端可以再缝 1 针固定在领口，避免翘起。</li>
    </ul>
  </div>
</div>

<h2 id="size">尺寸换算提醒</h2>
<div class="card">
  <p style="margin-top:0">换针号或换线会同时改变成品尺寸，<b>不能直接套用上面的针数</b>。参考关系：</p>
  <ul class="tight">
    <li><b>1.5 mm + 8 号蕾丝线</b>：密度约 3.3 针/cm，同样 30 针的头只有约 2.9 cm。想做到 5–6 cm 总高，头要改到 30 针左右但针数分布变化大，建议按 0.75 倍整体重算并先钩一个头部试样。</li>
    <li><b>3.0 mm + 5 股牛奶棉</b>：密度约 2.0 针/cm，同样针数头会变成约 4.8 cm，总高约 11–12 cm，棉花要多塞 1.5 倍。</li>
    <li><b>只换钩针不换线</b>：2.0 → 2.5 mm 大约放大 10–12%，总高约 8.8 cm，不需要改针数。</li>
  </ul>
  <p class="tip" style="margin-bottom:0">卷发和荷叶边这两处对密度最敏感：线细了会塌，线粗了会硬。换线后先用一条卷曲针试手感再决定针数。</p>
</div>

<h2 id="faq">常见问题</h2>
<div class="card">
  <ul class="tight" style="margin:0">
    <li><b>卷曲针卷不起来？</b>每个锁针里必须钩满 3 针；只钩 2 针不会卷。钩的时候不要拉直，让它自己盘。</li>
    <li><b>荷叶边卷边或翻不平？</b>加针不够。领口是 18→36，下摆是 30→45，少于这个数就不够蓬。</li>
    <li><b>帽子总往下掉？</b>帽冠 R7 之后钩一圈引拔收紧（不加不减，36 SL），帽口会缩 2–3 mm，正好卡住头。</li>
    <li><b>脸太平／太凸？</b>头部 R8 收针前把棉花往两侧压，中间留薄一点，脸就平了。</li>
    <li><b>卷发太密看不见脸？</b>正面中央那 3 个卷曲针改用 4CH 短卷，两侧改 6CH 长卷即可。</li>
  </ul>
</div>

{verify_section()}

<footer>
  gummy-绿发女孩 · 「软糖图解」生成 ｜ 单个自包含 HTML，离线可开 ｜ 进度保存在本机浏览器
</footer>
</div>
<script>{JS}</script>
</body>
</html>'''
    with open("gummy-绿发女孩.html", "w", encoding="utf-8") as f:
        f.write(doc)
    return doc

if __name__ == "__main__":
    build()
    # 控制台校验输出
    print("=" * 78)
    print("逐圈校验")
    print("=" * 78)
    allok = True
    for p in PARTS:
        d = REPORT[p["id"]]
        print(f'\n【{p["name"]}】')
        print(f'{"圈":>3} {"图解":<20} {"消耗":>4} {"产出":>4} {"增量":>4}  结论')
        for r in d["rows"]:
            ok = r["ok1"] and r["ok2"]
            allok = allok and ok
            print(f'{r["r"]:>3} {r["label"][:20]:<20} {r["cons"]:>4} {r["prod"]:>4} {r["delta"]:>+4}  {"✓" if ok else "✗ 消耗≠上圈产出 或 增量不符"}')
        print(f'   末圈 {d["final"]} 针')
    print("\n" + "=" * 78)
    tot = sum(len(p["rounds"]) for p in PARTS)
    finals = sum(d["final"] for d in REPORT.values())
    print(f'总圈数 {tot} ｜ 各部件末圈针数合计 {finals} ｜ 结论：{"全部通过" if allok else "存在错误"}')
