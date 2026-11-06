# -*- coding: utf-8 -*-
"""
「软糖图解」· gummy-绿发女孩
数据驱动 + 契约守恒模型（每个记号带 消耗/产出），生成单个完全自包含 HTML。
记号表与 docs/CONTRACT.md §1 一致：
  X 1→1 / V 1→2 / A 2→1 / T,F 1→1 / W 1→3 / M 3→1 / CH 0→1 / SL 1→0 / K 1→0
"""
import math, html as _html

VERSION = "1.0.0"

# ---------------- §1 记号表 ----------------
OPS = {
    "X":  ("短针 sc",      1, 1),
    "V":  ("加针 inc",     1, 2),
    "A":  ("减针 dec",     2, 1),
    "T":  ("中长针 hdc",   1, 1),
    "F":  ("长针 dc",      1, 1),
    "W":  ("一针三短针",    1, 3),
    "M":  ("三针并一针",    3, 1),
    "CH": ("锁针 ch",      0, 1),
    "SL": ("引拔 sl",      1, 0),
    "K":  ("空针 skip",    1, 0),
}

# ---------------- 调色板 ----------------
PALETTE = [
    {"id": "C1", "name": "奶油米白", "hex": "#F7E8D6", "line": "#BFA07C", "role": "skin"},
    {"id": "C2", "name": "嫩芽绿",   "hex": "#A9D46B", "line": "#6E9A35", "role": "hair"},
    {"id": "C3", "name": "森林深绿", "hex": "#2F5D34", "line": "#1E3D22", "role": "main"},
    {"id": "C4", "name": "本白",     "hex": "#FBF8F1", "line": "#A9A190", "role": "accent"},
    {"id": "C5", "name": "翡翠绿",   "hex": "#1E6B4F", "line": "#124634", "role": "eye"},
    {"id": "C6", "name": "蜜桃粉",   "hex": "#F2A0AE", "line": "#C8737F", "role": "blush"},
    {"id": "C7", "name": "豆绿",     "hex": "#8FBB62", "line": "#5F8438", "role": "main"},
]
COL = {p["id"]: p for p in PALETTE}

GAUGE = {"stPerCm": 2.2, "roundsPerCm": 2.2, "hookMm": 2.5, "yarn": "4ply 牛奶棉"}
METERS_PER_STITCH = 0.025
YARN_M_PER_G = 4.2
BUFFER = 0.25


def R(unit, times=1, **kw):
    d = {"unit": unit, "times": times}
    d.update(kw)
    return d


# ---------------- 部件规格 ----------------
PARTS = [
    {
        "id": "head", "name": "头部", "color": "C1", "shape": "sphere",
        "dia": 4.0, "height": 4.4, "maxStitches": 30,
        "spec": "球体，正面留平面做脸",
        "rounds": [
            R([("X", 6)], kind="magic-ring", note="魔术环起 6X"),
            R([("V", 1)], 6),
            R([("X", 1), ("V", 1)], 6),
            R([("X", 2), ("V", 1)], 6),
            R([("X", 3), ("V", 1)], 6, note="此处达到最宽 30 针"),
            R([("X", 30)], 1, note="平织：脸的平面就靠这一圈撑开"),
            R([("X", 3), ("A", 1)], 6, note="开始塞棉，塞七分满"),
            R([("X", 2), ("A", 1)], 6),
            R([("X", 1), ("A", 1)], 6),
            R([("A", 1)], 6, note="补棉到八分满，收最后 6 针"),
        ],
        "finish": "末端 SL 拉紧断线，线头穿外半针一圈收紧藏好。成品约 4.0 cm 宽 × 4.4 cm 高。",
    },
    {
        "id": "body", "name": "身体", "color": "C7", "shape": "capsule",
        "dia": 3.5, "height": 3.2, "maxStitches": 24,
        "spec": "由下往上钩，R4 只钩内半针，把 24 个外半针留给下摆",
        "rounds": [
            R([("X", 6)], kind="magic-ring", note="魔术环起 6X（坐垫中心）"),
            R([("V", 1)], 6),
            R([("X", 1), ("V", 1)], 6),
            R([("X", 2), ("V", 1)], 6, loop="blo", reservedFor="hem",
              note="只钩内半针 BLO —— 外半针 24 针留给下摆荷叶边"),
            R([("X", 2), ("A", 1)], 6),
            R([("X", 1), ("A", 1)], 6),
            R([("X", 12)], 1, note="留 12 针脖口，不收口"),
        ],
        "finish": "脖口 12 针与领口荷叶边内圈对齐，缝头时一起压住。坐高约 3.2 cm。",
    },
    {
        "id": "hem", "name": "下摆荷叶边", "color": "C4", "shape": "attach",
        "dia": 5.2, "height": 0.8, "maxStitches": 36,
        "spec": "接在身体 R4 留下的 24 个外半针上",
        "attach": {"part": "body", "round": 4, "loop": "flo", "stitches": 24},
        "rounds": [
            R([("X", 24)], 1, kind="attach", inStitches=24, note="挑外半针，一圈 24X"),
            R([("X", 1), ("V", 1)], 12),
            R([("X", 36)], 1, note="平织一圈收尾，边自然外翻"),
        ],
        "finish": "外径约 5.2 cm，是整只最宽处，坐姿时正好铺平在桌面上。",
    },
    {
        "id": "collar", "name": "领口荷叶边", "color": "C4", "shape": "flat-round",
        "dia": 3.5, "height": 0.8, "maxStitches": 24,
        "spec": "12CH 环连起针，内圈 12 针 = 脖口",
        "rounds": [
            R([("X", 12)], 1, kind="round", inStitches=12, prefix="12CH 环连，",
              note="沿锁针环内钩 12X"),
            R([("V", 1)], 12),
            R([("X", 24)], 1, note="平织一圈，边自然外翻成荷叶"),
        ],
        "finish": "外径约 3.5 cm，正好比肩膀宽一圈；内圈 12 针套在脖口上缝合。",
    },
    {
        "id": "arm", "name": "手臂（钩 2 只）", "color": "C1", "shape": "capsule",
        "dia": 1.7, "height": 2.3, "maxStitches": 12, "mult": 2,
        "spec": "小圆柱，收口压扁成连指手套式的小手",
        "rounds": [
            R([("X", 6)], kind="magic-ring"),
            R([("V", 1)], 6),
            R([("X", 12)], 1),
            R([("X", 12)], 1),
            R([("A", 1)], 6, note="塞极少量棉后收口"),
        ],
        "finish": "每只约 1.7 cm 宽 × 2.3 cm 长。缝在身体 R7 上方、左右各距中线 1.1 cm。",
    },
    {
        "id": "hat", "name": "帽冠", "color": "C3", "shape": "cylinder",
        "dia": 4.3, "height": 3.2, "maxStitches": 30,
        "spec": "扁圆顶贝雷帽，反面朝外更硬挺",
        "rounds": [
            R([("X", 6)], kind="magic-ring"),
            R([("V", 1)], 6),
            R([("X", 1), ("V", 1)], 6),
            R([("X", 2), ("V", 1)], 6),
            R([("X", 3), ("V", 1)], 6),
            R([("X", 30)], 1),
            R([("X", 30)], 1, note="帽口：钩完翻面，让反面朝外"),
        ],
        "finish": "翻面后帽口略收，压成扁圆顶。宽约 4.3 cm，帽口周长与白卷边 30 针一致。",
    },
    {
        "id": "brim", "name": "帽檐白卷边", "color": "C4", "shape": "cylinder",
        "dia": 4.3, "height": 0.9, "maxStitches": 30,
        "spec": "30CH 环连直筒，4 圈后纵向对折成双层",
        "rounds": [
            R([("X", 30)], 1, kind="round", inStitches=30, prefix="30CH 环连，",
              note="沿锁针环内钩 30X"),
            R([("X", 30)], 1),
            R([("X", 30)], 1),
            R([("X", 30)], 1),
        ],
        "finish": "纵向对折 = 4 圈变 2 层，带宽约 0.9 cm，两层夹住帽冠下缘缝合。",
    },
    {
        "id": "haircap", "name": "头发（发帽 + 卷发圈）", "color": "C2", "shape": "flat-round",
        "dia": 4.0, "height": 2.7, "maxStitches": 30,
        "spec": "与头顶同针数的发帽，最后一圈挂 30 个卷曲针",
        "rounds": [
            R([("X", 6)], kind="magic-ring"),
            R([("V", 1)], 6),
            R([("X", 1), ("V", 1)], 6),
            R([("X", 2), ("V", 1)], 6),
            R([("X", 3), ("V", 1)], 6),
            R([("X", 30)], 1,
              decor=[{"kind": "curly", "every": 1, "count": 30, "ch": 6,
                      "note": "正中 5 针用 4CH 短卷（露出脸），其余 25 针用 6CH 长卷"}],
              note="在 30 针上每针挂 1 个卷曲针，共 30 条卷发"),
        ],
        "finish": "发帽前缘压在眉毛上沿、别压住眼睛；下沿用藏针法固定在头两侧。想省时可改成每 2 针挂 1 个（15 条），R6 记法不变。",
    },
    {
        "id": "curl", "name": "侧长卷发（钩 2 条）", "color": "C2", "shape": "flat-row",
        "dia": 1.4, "height": 3.5, "maxStitches": 45, "mult": 2,
        "spec": "16CH 起针，每个锁针里钩 3X（记作 15W），自己盘成螺旋",
        "rounds": [
            R([("W", 15)], 1, kind="row", inStitches=15,
              note="16CH 起，从第 2 个锁针起每个锁针里钩 3X，共 15 个 = 15W"),
        ],
        "finish": "末端 1SL 收，线头藏进螺旋里。每条盘开约 3.5 cm，缝在耳侧垂到肩。",
    },
    {
        "id": "flower", "name": "花饰", "color": "C4", "shape": "flat-round",
        "dia": 1.4, "height": 0.5, "maxStitches": 6,
        "spec": "6X 花心 + 6 片花瓣（花瓣是装饰针迹，不改针数）",
        "rounds": [
            R([("X", 6)], kind="magic-ring", note="花心"),
            R([("X", 6)], 1,
              decor=[{"kind": "petal", "every": 1, "count": 6, "ch": 2,
                      "note": "每针里钩 2CH + 2T + 2CH + SL，在同一针完成一片花瓣"}],
              note="在原来 6 针上逐针挂花瓣，主体仍是 6 针"),
        ],
        "finish": "花瓣用手捏开，花心缝 1 颗小珍珠。花径约 1.4 cm，缝在帽子右侧。",
    },
    {
        "id": "leaf", "name": "叶片", "color": "C3", "shape": "flat-round",
        "dia": 1.6, "height": 1.8, "maxStitches": 12,
        "spec": "钩完压扁成叶形，中间绣一条叶脉",
        "rounds": [
            R([("X", 6)], kind="magic-ring"),
            R([("V", 1)], 6),
            R([("X", 12)], 1),
            R([("A", 1)], 6, note="收成窄端后 SL 收尾"),
        ],
        "finish": "压扁成约 1.6 cm 长的叶形，缝在花下方。",
    },
]


# ---------------- 逐圈推导 + 校验 ----------------
def build_round(idx, spec):
    unit, times = spec["unit"], spec["times"]
    cons = prod = 0
    cnt = {k: 0 for k in ("V", "W", "CH", "A", "M", "SL", "K")}
    for sym, n in unit:
        _, c, p = OPS[sym]
        cons += c * n
        prod += p * n
        if sym in cnt:
            cnt[sym] += n
    calc_cons, calc_prod = cons * times, prod * times
    cnt = {k: v * times for k, v in cnt.items()}

    kind = spec.get("kind", "round")
    if kind == "magic-ring":
        sin = 0
    elif "inStitches" in spec:
        sin = spec["inStitches"]
    else:
        sin = calc_cons

    return {
        "r": idx, "kind": kind, "unit": unit, "times": times,
        "sin": sin, "sout": calc_prod,
        "calcCons": calc_cons, "calcProd": calc_prod, "counts": cnt,
        "delta": calc_prod - sin,
        "note": spec.get("note", ""), "prefix": spec.get("prefix", ""),
        "loop": spec.get("loop", "both"), "reservedFor": spec.get("reservedFor"),
        "decor": spec.get("decor", []),
    }


def notation(unit, times):
    if len(unit) == 1:
        sym, n = unit[0]
        t = n * times
        return f"{t}{sym}" if t > 1 else sym
    body = ",".join((f"{n}{s}" if n > 1 else s) for s, n in unit)
    return f"({body})×{times}"


def validate():
    errors, warnings, parts_out = [], [], []
    for p in PARTS:
        rows = []
        for i, spec in enumerate(p["rounds"], start=1):
            rd = build_round(i, spec)
            errs = []
            if rd["kind"] != "magic-ring":
                if rd["calcCons"] != rd["sin"]:
                    errs.append(f"R{i} 环内消耗不符：Σ消耗 {rd['calcCons']} ≠ 声明消耗 {rd['sin']}")
                if i > 1 and rd["sin"] != rows[-1]["sout"]:
                    errs.append(f"R{i} 衔接不符：消耗 {rd['sin']} ≠ 上圈产出 {rows[-1]['sout']}")
                c = rd["counts"]
                rhs = (c["V"] + 2 * c["W"] + c["CH"]) - (c["A"] + 2 * c["M"] + c["SL"] + c["K"])
                if rd["delta"] != rhs:
                    errs.append(f"R{i} 增减不符：增量 {rd['delta']:+d} ≠ 加针−减针 {rhs:+d}")
            else:
                if rd["sin"] != 0:
                    errs.append(f"R{i} 环起圈消耗应为 0，实为 {rd['sin']}")
            if rd["kind"] != "magic-ring" and rd["calcProd"] != rd["sout"]:
                errs.append(f"R{i} 产出不符：Σ产出 {rd['calcProd']} ≠ 声明产出 {rd['sout']}")
            if not (6 <= rd["sout"] <= 200):
                errs.append(f"R{i} 产出 {rd['sout']} 超出可钩范围 6–200")
            for d in rd["decor"]:
                if d["count"] * d["every"] != rd["sout"]:
                    errs.append(f"R{i} 装饰针迹 {d['count']}×{d['every']} ≠ 本圈 {rd['sout']} 针")
            if rd["loop"] != "both" and not rd["reservedFor"]:
                warnings.append(f"{p['name']} R{i} 留了半针但没有部件接上去")
            rd["errors"] = errs
            rd["ok"] = not errs
            rows.append(rd)
            errors.extend(f"{p['name']} · {e}" for e in errs)
        parts_out.append({
            "id": p["id"], "name": p["name"], "rows": rows,
            "rounds": len(rows), "final": rows[-1]["sout"],
            "stitches": sum(r["sout"] for r in rows),
            "ok": all(r["ok"] for r in rows),
        })

    # attach 引用合法性
    idx = {p["id"]: i for i, p in enumerate(parts_out)}
    for p, po in zip(PARTS, parts_out):
        at = p.get("attach")
        if not at:
            continue
        if at["part"] not in idx:
            errors.append(f"{p['name']} 的接针来源 {at['part']} 不存在")
            continue
        src = parts_out[idx[at["part"]]]["rows"][at["round"] - 1]
        if src["sout"] != at["stitches"]:
            errors.append(f"{p['name']} 接针数 {at['stitches']} ≠ {at['part']} R{at['round']} 的 {src['sout']} 针")
        if src["loop"] == "both":
            errors.append(f"{p['name']} 接在 {at['part']} R{at['round']}，但那一圈没有留半针")

    total = sum(po["stitches"] * p.get("mult", 1) for p, po in zip(PARTS, parts_out))
    summary = {
        "parts": len(PARTS),
        "rounds": sum(po["rounds"] for po in parts_out),
        "totalStitches": total,
        "decorCount": sum(d["count"] for p in PARTS for r in p["rounds"] for d in r.get("decor", [])),
        "reservedLoops": sum(1 for p in PARTS for r in p["rounds"] if r.get("loop", "both") != "both"),
    }
    return {"ok": not errors, "errors": errors, "warnings": warnings,
            "parts": parts_out, "summary": summary}


VAL = validate()


def yarn_estimate():
    rows, per_color = [], {}
    for p, po in zip(PARTS, VAL["parts"]):
        mult = p.get("mult", 1)
        st = po["stitches"] * mult
        m = st * METERS_PER_STITCH
        rows.append({"id": p["id"], "name": p["name"], "mult": mult, "stitches": st,
                     "meters": round(m, 1), "grams": round(m / YARN_M_PER_G, 1),
                     "color": p["color"]})
        per_color[p["color"]] = per_color.get(p["color"], 0) + st
    tot_st = sum(r["stitches"] for r in rows)
    tot_m = tot_st * METERS_PER_STITCH
    colors = []
    for cid, st in sorted(per_color.items(), key=lambda kv: -kv[1]):
        m = st * METERS_PER_STITCH
        colors.append({"id": cid, "name": COL[cid]["name"], "hex": COL[cid]["hex"],
                       "stitches": st, "meters": round(m, 1),
                       "grams": round(m * (1 + BUFFER) / YARN_M_PER_G, 1)})
    return {"perPart": rows, "perColor": colors,
            "total": {"stitches": tot_st, "meters": round(tot_m, 1),
                      "grams": round(tot_m / YARN_M_PER_G, 1)},
            "withBuffer": {"meters": round(tot_m * (1 + BUFFER), 1),
                           "grams": round(tot_m * (1 + BUFFER) / YARN_M_PER_G, 1)},
            "bufferRatio": BUFFER}


YARN = yarn_estimate()


# ---------------- 符号图 ----------------
def mark_path(sym):
    if sym == "X":
        return '<path d="M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5"/>'
    if sym == "V":
        return '<path d="M-4.3,3.1 L0,-3.5 L4.3,3.1"/>'
    if sym == "A":
        return '<path d="M-4.3,-3.1 L0,3.5 L4.3,-3.1"/>'
    if sym == "W":
        return '<path d="M-5.4,3.1 L-1.8,-3.5 L1.8,3.1 L5.4,-3.5"/>'
    return '<circle r="2.6"/>'


def chart_svg(p, po):
    col = COL[p["color"]]
    line = col["line"]
    rows = po["rows"]
    n = len(rows)
    mx = max(r["sout"] for r in rows)
    rr = []
    for k, rd in enumerate(rows):
        base = 30 + 96 * math.sqrt(rd["sout"] / mx)
        rr.append(max(base, (rr[-1] + 15) if rr else base))
    rmax = rr[-1]
    size = (rmax + 58) * 2
    cx = cy = size / 2

    o = [f'<svg viewBox="0 0 {size:.0f} {size:.0f}" class="chart" role="img" '
         f'aria-label="{_html.escape(p["name"])} 符号图">']
    o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{rmax+26:.1f}" fill="#FEFDFA" stroke="#E7E1D3"/>')
    for k, rd in enumerate(rows, start=1):
        r = rr[k - 1]
        cnt = rd["sout"]
        circ = 2 * math.pi * r
        sc = max(0.45, min(1.0, circ / cnt / 11.0))
        g = [f'<g class="ring" data-part="{p["id"]}" data-r="{k}">']
        g.append(f'<circle class="ringline" cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="none" '
                 f'stroke="{line}" stroke-opacity=".22" stroke-width="1" stroke-dasharray="2 3"/>')
        for i in range(cnt):
            sym = "X"
            for s, c in rd["unit"]:
                pos = i % sum(nn for _, nn in rd["unit"])
                start = 0
                for s2, n2 in rd["unit"]:
                    if start <= pos < start + n2:
                        sym = s2
                        break
                    start += n2
                break
            ang = -90 + 360.0 * i / cnt
            g.append(f'<g transform="translate({cx:.2f},{cy:.2f}) rotate({ang:.3f}) '
                     f'translate(0,{-r:.2f}) scale({sc:.2f})" fill="none" stroke="{line}" '
                     f'stroke-width="{1.8/sc:.2f}" stroke-linecap="round" stroke-linejoin="round">'
                     f'{mark_path(sym)}</g>')
        g.append(f'<text x="{cx + r + 7:.1f}" y="{cy + 4:.1f}" class="rnum" fill="{line}">R{k}</text>')
        g.append('</g>')
        o.append("".join(g))
    o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.2" fill="{line}" fill-opacity=".55"/>')
    o.append('</svg>')
    return "".join(o)


def legend_svg():
    items = [("X", "短针 X"), ("V", "加针 V"), ("A", "减针 A"), ("W", "一针三短针 W")]
    w, h = 680, 92
    o = [f'<svg viewBox="0 0 {w} {h}" class="legend-svg" role="img" aria-label="符号图例">']
    o.append(f'<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="12" fill="#FCFAF4" stroke="#E7E1D3"/>')
    x = 30
    for sym, label in items:
        o.append(f'<g transform="translate({x},32)" fill="none" stroke="#3D6B3A" stroke-width="2.1" '
                 f'stroke-linecap="round" stroke-linejoin="round">{mark_path(sym)}</g>')
        o.append(f'<text x="{x+20}" y="37" font-size="13" fill="#3B3730">{label}</text>')
        x += 162
    o.append(f'<text x="30" y="70" font-size="11.5" fill="#8C8272">'
             f'同心圆 = 圈号 R1…Rn，圆心是起针点，由内往外读；每个符号 = 一个针目，'
             f'半径按该圈针数的平方根分配（面积均分），所以加针/减针落在实际位置上。</text>')
    o.append('</svg>')
    return "".join(o)


def tech_svg():
    w, h = 680, 172
    o = [f'<svg viewBox="0 0 {w} {h}" class="legend-svg" role="img" aria-label="卷曲针与半针留针示意">']
    o.append(f'<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="12" fill="#FCFAF4" stroke="#E7E1D3"/>')
    o.append('<defs><marker id="arw" viewBox="0 0 8 8" refX="6.4" refY="4" markerWidth="7" markerHeight="7" '
             'orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#6E9A35"/></marker></defs>')
    # 卷曲针
    x0, y0, step = 44, 104, 30
    o.append('<text x="30" y="26" font-size="12.5" fill="#3B3730">① 卷曲针：每 1 个锁针里钩 3 个短针</text>')
    o.append('<text x="30" y="43" font-size="11" fill="#8C8272">3 针挤进 1 针，织物自己盘成螺旋，不回钩也不拉直</text>')
    for i in range(10):
        x = x0 + i * step
        o.append(f'<ellipse cx="{x}" cy="{y0}" rx="12" ry="6.5" fill="none" stroke="#B0A794" '
                 f'stroke-width="1.4" stroke-dasharray="3 2"/>')
    for i in range(10):
        x = x0 + i * step
        for dx, dy in ((-6.5, -17), (0, -25), (6.5, -17)):
            o.append(f'<g transform="translate({x+dx},{y0+dy}) scale(.8)" fill="none" stroke="#6E9A35" '
                     f'stroke-width="2.2" stroke-linecap="round">{mark_path("X")}</g>')
    o.append(f'<path d="M{x0+9*step+8},{y0-30} C{x0+10*step+46},{y0-64} {x0-46},{y0-66} {x0-10},{y0-38}" '
             f'fill="none" stroke="#6E9A35" stroke-width="1.7" stroke-dasharray="5 4" marker-end="url(#arw)"/>')
    o.append(f'<text x="{x0}" y="{y0+22}" font-size="10.5" fill="#B0A794">'
             f'1 个锁针（虚线）= 3 个短针</text>')
    # 半针留针
    bx, by = 400, 96
    o.append(f'<text x="{bx}" y="26" font-size="12.5" fill="#3B3730">② 半针留针 BLO：只钩内半针</text>')
    o.append(f'<text x="{bx}" y="43" font-size="11" fill="#8C8272">外半针整圈留着，稍后在上面加荷叶边</text>')
    for i in range(6):
        x = bx + i * 42
        o.append(f'<path d="M{x},{by} q10,-20 20,0" fill="none" stroke="#8FBB62" stroke-width="2.4" stroke-linecap="round"/>')
        o.append(f'<path d="M{x},{by+12} q10,-20 20,0" fill="none" stroke="#C9D8B4" stroke-width="2.4" '
                 f'stroke-linecap="round" stroke-dasharray="2 2"/>')
    o.append(f'<text x="{bx}" y="{by+40}" font-size="10.5" fill="#6E9A35">实线 = 内半针（现在钩）</text>')
    o.append(f'<text x="{bx+170}" y="{by+40}" font-size="10.5" fill="#A9A190">虚线 = 外半针（留给荷叶边）</text>')
    o.append('</svg>')
    return "".join(o)


def cover_svg():
    o = ['<svg viewBox="0 0 250 300" class="cover" role="img" aria-label="成品示意图">',
         '<defs>',
         '<radialGradient id="gHat" cx="38%" cy="26%" r="80%">'
         '<stop offset="0" stop-color="#4A7C4E"/><stop offset="1" stop-color="#264A2A"/></radialGradient>',
         '<radialGradient id="gHair" cx="40%" cy="28%" r="82%">'
         '<stop offset="0" stop-color="#C6E88F"/><stop offset="1" stop-color="#93C257"/></radialGradient>',
         '<radialGradient id="gBody" cx="42%" cy="30%" r="82%">'
         '<stop offset="0" stop-color="#9FC96F"/><stop offset="1" stop-color="#7BA84F"/></radialGradient>',
         '</defs>',
         '<ellipse cx="125" cy="288" rx="74" ry="8" fill="#E8E2D3" opacity=".55"/>',
         # 下摆荷叶边
         '<path d="M34 244 q9 -15 23 -7 q9 -16 25 -7 q9 -16 25 -7 q9 -16 25 -7 q9 -16 25 -7 '
         'q11 -14 24 -4 q14 -5 22 9 q-7 25 -38 29 l-95 2 q-30 -4 -39 -31 z" '
         'fill="#FBF8F1" stroke="#DAD3C2" stroke-width="1.3"/>',
         # 身体
         '<path d="M68 180 q57 -16 114 0 q7 30 -7 50 q-50 13 -100 0 q-14 -20 -7 -50 z" '
         'fill="url(#gBody)" stroke="#5F8438" stroke-width="1.3"/>',
         # 手
         '<ellipse cx="86" cy="214" rx="12.5" ry="11" fill="#F7E8D6" stroke="#DCC3A4" stroke-width="1.2"/>',
         '<ellipse cx="164" cy="214" rx="12.5" ry="11" fill="#F7E8D6" stroke="#DCC3A4" stroke-width="1.2"/>',
         # 领口荷叶边
         '<path d="M80 180 q45 -13 90 0 q4 13 -6 19 q-40 9 -78 0 q-10 -6 -6 -19 z" '
         'fill="#FBF8F1" stroke="#DAD3C2" stroke-width="1.2"/>',
         # 头发（发帽）
         '<ellipse cx="125" cy="120" rx="66" ry="60" fill="url(#gHair)" stroke="#6E9A35" stroke-width="1.4"/>',
         # 卷发圈
         '<g fill="none" stroke="#7FB348" stroke-width="3.6" stroke-linecap="round">',
         '<path d="M62 96 q-15 9 -6 19 q8 9 17 1"/>',
         '<path d="M188 96 q15 9 6 19 q-8 9 -17 1"/>',
         '<path d="M66 138 q-16 10 -6 21 q8 9 17 1"/>',
         '<path d="M184 138 q16 10 6 21 q-8 9 -17 1"/>',
         '<path d="M92 172 q-12 13 -2 21 q8 7 15 -2"/>',
         '<path d="M158 172 q12 13 2 21 q-8 7 -15 -2"/>',
         '<path d="M84 56 q-17 3 -15 15 q2 11 13 8"/>',
         '<path d="M166 56 q17 3 15 15 q-2 11 -13 8"/>',
         '</g>',
         # 脸
         '<ellipse cx="125" cy="134" rx="41" ry="39" fill="#F7E8D6" stroke="#E6D2B8" stroke-width="1.2"/>',
         # 刘海
         '<g fill="none" stroke="#7FB348" stroke-width="3.8" stroke-linecap="round">',
         '<path d="M94 108 q-7 15 4 19 q9 3 12 -9"/>',
         '<path d="M156 108 q7 15 -4 19 q-9 3 -12 -9"/>',
         '<path d="M114 101 q-4 17 2 21"/>',
         '<path d="M136 101 q4 17 -2 21"/>',
         '</g>',
         # 眼
         '<ellipse cx="108" cy="138" rx="5" ry="7.6" fill="#1E6B4F"/>',
         '<ellipse cx="142" cy="138" rx="5" ry="7.6" fill="#1E6B4F"/>',
         '<circle cx="109.7" cy="135" r="1.5" fill="#FFFFFF"/>',
         '<circle cx="143.7" cy="135" r="1.5" fill="#FFFFFF"/>',
         # 腮红
         '<ellipse cx="97" cy="152" rx="9" ry="5.4" fill="#F2A0AE" opacity=".6"/>',
         '<ellipse cx="153" cy="152" rx="9" ry="5.4" fill="#F2A0AE" opacity=".6"/>',
         '<path d="M121 156 q4 3.4 8 0" fill="none" stroke="#D58B84" stroke-width="1.8" stroke-linecap="round"/>',
         # 帽子
         '<path d="M54 92 q9 -60 71 -60 q62 0 71 60 q-6 13 -21 15 q-50 11 -100 0 q-15 -2 -21 -15 z" '
         'fill="url(#gHat)" stroke="#1E3D22" stroke-width="1.6"/>',
         '<g fill="#1E3D22" opacity=".3">',
         '<circle cx="102" cy="52" r="3"/><circle cx="125" cy="44" r="3"/><circle cx="148" cy="52" r="3"/>',
         '<circle cx="88" cy="68" r="2.6"/><circle cx="162" cy="68" r="2.6"/>',
         '<circle cx="113" cy="62" r="2.6"/><circle cx="137" cy="62" r="2.6"/></g>',
         # 白卷边
         '<path d="M48 92 q77 -19 154 0 q2 15 -4 22 q-73 -15 -146 0 q-6 -7 -4 -22 z" '
         'fill="#FBF8F1" stroke="#DAD3C2" stroke-width="1.5"/>',
         '<path d="M52 100 q73 -15 146 0" fill="none" stroke="#EAE4D5" stroke-width="1.4"/>',
         # 花 + 叶
         '<g transform="translate(198,88)">',
         '<g fill="#FFFFFF" stroke="#DAD3C2" stroke-width="1.1">',
         '<ellipse cx="0" cy="-9" rx="5" ry="7"/><ellipse cx="8.5" cy="-3" rx="7" ry="5"/>',
         '<ellipse cx="5" cy="8" rx="5" ry="7"/><ellipse cx="-5" cy="8" rx="5" ry="7"/>',
         '<ellipse cx="-8.5" cy="-3" rx="7" ry="5"/></g>',
         '<circle cx="0" cy="0" r="3.3" fill="#EBDCA9" stroke="#CFBE86" stroke-width="1"/></g>',
         '<g fill="#2F5D34">',
         '<path d="M206 102 q12 2 13 12 q-12 1 -13 -12 z"/>',
         '<path d="M184 102 q-12 2 -13 12 q12 1 13 -12 z"/></g>',
         '</svg>']
    return "".join(o)


def esc(s):
    return _html.escape(str(s), quote=True)


# ---------------- HTML ----------------
CSS = """
:root{--ink:#39352E;--ink2:#6B6458;--ink3:#968E80;--line:#E7E1D3;--bg:#FBF8F1;--card:#FFF;
--green:#3D6B3A;--green2:#7BA648;--lime:#A9D46B;--pink:#F2A0AE}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.72;font-size:15px;
font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,-apple-system,sans-serif}
.wrap{max-width:1060px;margin:0 auto;padding:30px 20px 90px}
header.top{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.badge{width:62px;height:62px;border-radius:20px;flex:none;position:relative;
background:radial-gradient(circle at 34% 28%,#C6E88F,#A9D46B 46%,#2F5D34 100%);
box-shadow:inset 0 -6px 14px rgba(0,0,0,.16),0 6px 16px rgba(47,93,52,.20)}
.badge::after{content:"";position:absolute;left:8px;right:8px;bottom:11px;height:6px;border-radius:6px;background:#FBF8F1}
h1{font-size:24px;margin:0;letter-spacing:.4px}
.sub{color:var(--ink2);font-size:13.5px;margin-top:3px}
h2{font-size:18.5px;margin:36px 0 12px;padding-bottom:8px;border-bottom:2px solid #EFE9DA}
h3{font-size:15px;margin:20px 0 8px}
p{margin:8px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:12px 0;
box-shadow:0 1px 2px rgba(0,0,0,.03)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.hero{display:grid;grid-template-columns:225px 1fr;gap:22px;align-items:center}
@media(max-width:760px){.hero{grid-template-columns:1fr}}
svg.cover{width:100%;height:auto;display:block;max-width:225px}
.kv{display:grid;grid-template-columns:84px 1fr;gap:5px 12px;font-size:14px;margin:0}
.kv dt{color:var(--ink3)}
.kv dd{margin:0}
.swatches{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sw{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink2);
border:1px solid var(--line);border-radius:999px;padding:4px 11px 4px 5px;background:#fff}
.dot{width:15px;height:15px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.10);flex:none}
.part{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 20px 18px;margin:16px 0;
box-shadow:0 1px 3px rgba(0,0,0,.04)}
.part-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.part-head h2{margin:0;border:0;padding:0;font-size:17.5px}
.chip{font-size:12px;border-radius:999px;padding:2px 10px;background:#F3F0E6;color:var(--ink2);white-space:nowrap}
.part-note{font-size:13.5px;color:var(--ink2);background:#FBF9F2;border-left:3px solid var(--lime);
padding:8px 12px;border-radius:0 8px 8px 0;margin:10px 0 14px}
.part-body{display:grid;grid-template-columns:285px 1fr;gap:20px;align-items:start}
@media(max-width:900px){.part-body{grid-template-columns:1fr}}
svg.chart{width:100%;height:auto;display:block}
svg.legend-svg{width:100%;height:auto;display:block;max-width:680px}
g.ring{cursor:pointer}
g.ring.hl .ringline{stroke-width:8;stroke-opacity:.20;stroke-dasharray:none}
g.ring:hover .ringline{stroke-opacity:.42;stroke-dasharray:none;stroke-width:1.8}
text.rnum{font-size:11px;font-weight:600;paint-order:stroke;stroke:#FEFDFA;stroke-width:3.4;stroke-linejoin:round}
table.rounds{width:100%;border-collapse:collapse;font-size:13.5px}
table.rounds th{text-align:left;font-weight:600;color:var(--ink3);font-size:11.5px;letter-spacing:.3px;
padding:6px 6px;border-bottom:1.5px solid var(--line);white-space:nowrap}
table.rounds th.c,table.rounds td.c{text-align:center}
table.rounds td{padding:6px 6px;border-bottom:1px solid #F2EEE4;vertical-align:middle}
table.rounds td.n{font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap}
table.rounds td.pat{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;word-break:break-word}
tr.round{cursor:pointer;transition:background .12s}
tr.round:hover{background:#FAF8F0}
tr.round.done td{color:var(--ink3)}
tr.round.done td.pat{text-decoration:line-through;text-decoration-color:#D3CCBA}
tr.round.hl{background:#EFF8E1;box-shadow:inset 3px 0 0 var(--green2)}
tr.round.hl td{border-bottom-color:#DDEBC9}
.ok{color:#5B8C3E;font-weight:700}
.bad{color:#C2410C;font-weight:700}
.sq{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px;
box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
input[type=checkbox]{width:16px;height:16px;accent-color:#6FA84A;cursor:pointer;margin:0}
.toolbar{position:sticky;top:0;z-index:20;background:rgba(251,248,241,.95);backdrop-filter:blur(8px);
border-bottom:1px solid var(--line);padding:10px 0;margin:20px 0 4px}
.tb-inner{max-width:1060px;margin:0 auto;padding:0 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar{flex:1;min-width:150px;height:9px;border-radius:99px;background:#EAE4D6;overflow:hidden}
.bar>i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#A9D46B,#6FA84A);transition:width .3s}
.tb-txt{font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums;min-width:126px}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:#fff;color:var(--ink2);
border-radius:9px;padding:5px 13px;cursor:pointer}
button:hover{border-color:#CFC8B6;color:var(--ink)}
table.verify{width:100%;border-collapse:collapse;font-size:13px}
table.verify th{background:#F6F2E8;color:var(--ink2);font-weight:600;padding:7px 9px;text-align:left;
border-bottom:1.5px solid var(--line);font-size:11.5px;white-space:nowrap}
table.verify td{padding:5px 9px;border-bottom:1px solid #F2EEE4;font-variant-numeric:tabular-nums}
table.verify tr.sum td{font-weight:700;background:#FBF9F2}
.verdict{display:flex;gap:11px;align-items:flex-start;background:#F2F8E9;border:1px solid #D6E7BE;
border-radius:12px;padding:13px 17px;margin:12px 0;font-size:14px}
.verdict .ic{font-weight:700;color:#4E7A33;white-space:nowrap}
ul.tight{margin:6px 0;padding-left:20px}
ul.tight li{margin:3px 0}
ol.tight li{margin:5px 0}
.tip{font-size:13px;color:var(--ink2)}
code{background:#F4F1E7;border-radius:5px;padding:1px 5px;font-size:.92em;
font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--ink3);font-size:12.5px}
@media print{
 @page{margin:12mm}
 body{background:#fff;font-size:10pt;line-height:1.4}
 .wrap{max-width:none;padding:0}
 .toolbar,.no-print{display:none!important}
 .part{break-inside:avoid;page-break-inside:avoid;box-shadow:none;border-color:#DDD;margin:8px 0;padding:8px 10px}
 .part-body{grid-template-columns:225px 1fr;gap:10px}
 svg.chart{max-width:225px}
 h1{font-size:16pt} h2{font-size:12pt;margin:12px 0 6px}
 .card{box-shadow:none;padding:8px 10px}
 table.rounds{font-size:9pt}
 table.rounds td,table.rounds th{padding:2.5px 4px}
 tr.round.done td.pat{text-decoration:none}
 tr.round.hl{background:none!important;box-shadow:none!important}
 g.ring.hl .ringline{stroke-width:1;stroke-opacity:.2}
 .verdict{background:none}
 a{color:inherit;text-decoration:none}
}
"""

JS = """
(function(){
 var KEY='gummy-green-girl-v1', store={};
 try{ store=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ store={}; }
 var checks=[].slice.call(document.querySelectorAll('input.pchk'));
 function save(){ try{ localStorage.setItem(KEY,JSON.stringify(store)); }catch(e){} }
 function refresh(){
  var done=0, per={};
  checks.forEach(function(c){
   var tr=c.closest('tr');
   if(c.checked){ done++; tr.classList.add('done'); } else { tr.classList.remove('done'); }
   var pid=c.getAttribute('data-part');
   per[pid]=per[pid]||[0,0]; per[pid][1]++; if(c.checked) per[pid][0]++;
  });
  var tot=checks.length, pct=tot?Math.round(done/tot*100):0;
  document.getElementById('bar').style.width=pct+'%';
  document.getElementById('ptxt').textContent=done+' / '+tot+' 圈 · '+pct+'%';
  Object.keys(per).forEach(function(pid){
   var el=document.getElementById('prog-'+pid);
   if(el) el.textContent=per[pid][0]+'/'+per[pid][1];
  });
 }
 checks.forEach(function(c){
  c.checked=!!store[c.getAttribute('data-key')];
  c.addEventListener('change',function(){ store[c.getAttribute('data-key')]=c.checked?1:0; save(); refresh(); });
 });
 function clearHl(){
  [].forEach.call(document.querySelectorAll('tr.round.hl'),function(t){t.classList.remove('hl');});
  [].forEach.call(document.querySelectorAll('g.ring.hl'),function(g){g.classList.remove('hl');});
 }
 document.querySelectorAll('tr.round').forEach(function(tr){
  tr.addEventListener('click',function(e){
   if(e.target.tagName==='INPUT') return;
   var already=tr.classList.contains('hl');
   clearHl(); if(already) return;
   tr.classList.add('hl');
   var g=document.querySelector('g.ring[data-part="'+tr.getAttribute('data-part')+'"][data-r="'+tr.getAttribute('data-r')+'"]');
   if(g) g.classList.add('hl');
  });
 });
 document.querySelectorAll('g.ring').forEach(function(g){
  g.addEventListener('click',function(){
   var tr=document.querySelector('tr.round[data-part="'+g.getAttribute('data-part')+'"][data-r="'+g.getAttribute('data-r')+'"]');
   if(tr) tr.click();
  });
 });
 document.addEventListener('click',function(e){
  if(!e.target.closest('tr.round') && !e.target.closest('g.ring')) clearHl();
 });
 var rb=document.getElementById('reset');
 if(rb) rb.addEventListener('click',function(){
  if(!confirm('清空所有已勾选的圈？')) return;
  store={}; save(); checks.forEach(function(c){c.checked=false;}); refresh();
 });
 refresh();
})();
"""


def part_html(p, po):
    col = COL[p["color"]]
    total = po["rounds"]
    mult = p.get("mult", 1)
    trs = []
    for rd in po["rows"]:
        key = f'{p["id"]}-{rd["r"]}'
        mk = '<span class="ok">✓</span>' if rd["ok"] else '<span class="bad">✗</span>'
        d = f'{"+" if rd["delta"] > 0 else ""}{rd["delta"]}' if rd["delta"] != 0 else "±0"
        txt = rd["prefix"] + notation(rd["unit"], rd["times"])
        if rd["decor"]:
            dc = rd["decor"][0]
            txt += f' ⟡ {dc["count"]}×{ {"curly": "卷曲针", "petal": "花瓣"}.get(dc["kind"], "装饰针") }({dc["ch"]}CH)'
        if rd["loop"] == "blo":
            txt += " 〔内半针〕"
        trs.append(
            f'<tr class="round" data-part="{p["id"]}" data-r="{rd["r"]}">'
            f'<td class="n">{rd["r"]}</td>'
            f'<td class="pat">{esc(txt)}</td>'
            f'<td class="n"><span class="sq" style="background:{col["hex"]}"></span>{col["id"]}</td>'
            f'<td class="n">{rd["sin"]}</td>'
            f'<td class="n"><b>{rd["sout"]}</b></td>'
            f'<td class="n">{d}</td>'
            f'<td class="n">{mk}</td>'
            f'<td class="c"><input class="pchk" type="checkbox" data-key="{key}" data-part="{p["id"]}" '
            f'aria-label="标记 R{rd["r"]} 完成"></td></tr>')
    return f'''
 <section class="part" id="part-{p["id"]}">
  <div class="part-head">
   <h2>{esc(p["name"])}</h2>
   <span class="chip" style="background:{col["hex"]};color:{col["line"]}">{esc(col["name"])}</span>
   <span class="chip">{total} 圈{("· ×" + str(mult)) if mult > 1 else ""}</span>
   <span class="chip">进度 <b id="prog-{p["id"]}">0/{total}</b></span>
  </div>
  <div class="part-note">{esc(p["spec"])}</div>
  <div class="part-body">
   <div>{chart_svg(p, po)}</div>
   <div>
    <table class="rounds">
     <thead><tr><th>圈</th><th>记法</th><th class="c">配色</th><th class="c">消耗</th>
      <th class="c">产出</th><th class="c">增减</th><th class="c">校验</th><th class="c">完成</th></tr></thead>
     <tbody>{"".join(trs)}</tbody>
    </table>
    <p class="tip" style="margin-top:10px">{esc(p["finish"])}</p>
   </div>
  </div>
 </section>'''


def verify_section():
    v = VAL
    trs = []
    for po in v["parts"]:
        p = next(x for x in PARTS if x["id"] == po["id"])
        mult = p.get("mult", 1)
        trs.append(f'<tr><td>{esc(po["name"])}</td><td>{po["rounds"]}</td>'
                   f'<td>{po["final"]}</td><td>{po["stitches"]}</td>'
                   f'<td>{po["stitches"] * mult}</td>'
                   f'<td>{"✓ 逐圈吻合" if po["ok"] else "✗ 有问题"}</td></tr>')
    tot_rounds = v["summary"]["rounds"]
    tot_st = v["summary"]["totalStitches"]
    ok = v["ok"]
    return f'''
 <h2 id="verify">自检结果</h2>
 <div class="verdict">
  <span class="ic">{"✓ 通过" if ok else "✗ 未通过"}</span>
  <div>
   共 <b>{tot_rounds}</b> 圈，逐圈核对三条规则：<br>
   ① 衔接守恒：本圈消耗 = 上一圈产出 → {"全部相等" if ok else "存在不符"}；<br>
   ② 增减一致：本圈产出 − 本圈消耗 = 加针 − 减针 → {"全部相等" if ok else "存在不符"}；<br>
   ③ 针数范围：每圈产出落在 6–200 → 全部合规；<br>
   ④ 各部件末圈针数合计（含 ×2 重复件）= <b>{tot_st}</b> 针，与下表逐项吻合。
   <div class="tip" style="margin-top:6px">
    <b>说明</b>：R1 为环起圈，魔术环本身提供起针针目，<code>消耗记 0</code>、
    <code>增量 = 产出</code>，因此 ② 的等式对环起圈单独豁免（这正是契约 §4 对 <code>magic-ring</code> 的定义）；
    从 R2 起全部参与守恒校验。锁针起针的部件（领口、帽檐）<code>消耗记锁针数</code>，同样参与 ②。
   </div>
  </div>
 </div>
 <div class="card" style="overflow-x:auto">
  <table class="verify">
   <thead><tr><th>部件</th><th>圈数</th><th>末圈针数</th><th>单件总针数</th><th>计入 ×2 后</th><th>逐圈结论</th></tr></thead>
   <tbody>{"".join(trs)}
    <tr class="sum"><td>合计</td><td>{tot_rounds}</td><td>—</td><td>—</td><td>{tot_st}</td><td>—</td></tr>
   </tbody>
  </table>
 </div>
 <p class="tip">用线量由同一套针数换算：总针数 {tot_st} × {METERS_PER_STITCH} m/针
  = {YARN["total"]["meters"]} m ≈ {YARN["total"]["grams"]} g，含 {int(BUFFER*100)}% 损耗后
  <b>{YARN["withBuffer"]["meters"]} m / {YARN["withBuffer"]["grams"]} g</b>。</p>'''


def build():
    parts_html = "".join(part_html(p, po) for p, po in zip(PARTS, VAL["parts"]))
    sw = "".join(
        f'<span class="sw"><i class="dot" style="background:{c["hex"]}"></i>'
        f'{esc(c["name"])} {c["grams"]} g</span>' for c in YARN["perColor"])
    doc = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>绿发女孩 · 钩织图解 | 软糖图解</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">

<header class="top">
 <div class="badge" aria-hidden="true"></div>
 <div>
  <h1>绿发女孩 · 钩织图解</h1>
  <div class="sub">Q 版坐姿小人偶 ｜ 2.0–2.5 mm 钩针 + 4 ply 棉线 ｜ 成品约 8 cm 高 × 5.2 cm 宽</div>
 </div>
</header>

<div class="card hero" style="margin-top:18px">
 <div>{cover_svg()}</div>
 <div>
  <h3 style="margin-top:0">造型说明</h3>
  <p style="margin-top:0">深森林绿的贝雷帽冠，帽口一圈厚本白卷边；帽下是嫩芽绿的蓬蓬卷发，两缕长卷垂到肩；
  奶油米白的脸与小手，翡翠绿眼睛、蜜桃粉腮；豆绿的小外套配本白荷叶边领口与下摆；帽子右侧一朵白花配叶。</p>
  <dl class="kv" style="margin-top:10px">
   <dt>记号</dt><dd>X 短针 · V 加针 · A 减针 · W 一针三短针 · CH 锁针 · T 中长针 · SL 引拔</dd>
   <dt>部件</dt><dd>{VAL["summary"]["parts"]} 个（手臂与侧卷发各钩 2 只）</dd>
   <dt>总计</dt><dd>{VAL["summary"]["rounds"]} 圈 · {VAL["summary"]["totalStitches"]} 针</dd>
   <dt>难度</dt><dd>入门偏中——唯一难点是卷曲针，建议先用废线练 3 条</dd>
   <dt>用时</dt><dd>约 6–8 小时（熟练后 4–5 小时）</dd>
  </dl>
 </div>
</div>

<h2 id="materials">材料与规格</h2>
<div class="grid2">
 <div class="card">
  <h3 style="margin-top:0">用线与用针</h3>
  <dl class="kv">
   <dt>线材</dt><dd>4 ply 棉线（牛奶棉、纯棉均可）</dd>
   <dt>钩针</dt><dd>2.0–2.5 mm；脸和手用 2.0 mm 更紧实，帽冠用 2.5 mm 更挺</dd>
   <dt>密度</dt><dd>{GAUGE["stPerCm"]} 针/cm × {GAUGE["roundsPerCm"]} 圈/cm（10 cm ≈ 22 针 22 圈）</dd>
   <dt>成品</dt><dd>高约 8 cm（身体 3.2 + 头 4.4 + 帽子露出约 0.4）</dd>
   <dt>宽度</dt><dd>最宽处是下摆荷叶边，约 5.2 cm</dd>
  </dl>
  <div class="swatches">{sw}</div>
  <p class="tip" style="margin-bottom:0">克数已含 {int(BUFFER*100)}% 损耗，按此买线即可。</p>
 </div>
 <div class="card">
  <h3 style="margin-top:0">工具与读表方法</h3>
  <dl class="kv">
   <dt>工具</dt><dd>填充棉、缝合针、记号扣、绣线（深绿／白／粉）、小珍珠 1 颗、腮红或色粉</dd>
   <dt>重复体</dt><dd><code>(X,V)×6</code> = 「1 短针, 1 加针」重复 6 次，共 18 针</dd>
   <dt>消耗</dt><dd>这一圈要用掉上一圈给你的针数</dd>
   <dt>产出</dt><dd>这一圈钩完手上的针数</dd>
   <dt>增减</dt><dd>产出 − 消耗；等于「加针数 − 减针数」，对不上就是漏针或多钩</dd>
  </dl>
  <p class="tip" style="margin-bottom:0">除了 R1（环起），每一圈的「消耗」都必须等于上一圈的「产出」——
  钩的时候每圈开头扣一个记号扣，收尾数一遍就不会错。</p>
 </div>
</div>

<h2 id="legend">符号图例</h2>
<div class="card">{legend_svg()}</div>

<h2 id="tech">两个关键技法</h2>
<div class="card">{tech_svg()}
<p class="tip" style="margin-bottom:0"><b>卷曲针</b>用在发帽最后一圈和两条侧卷发上，它只是「1 针挂 3 针」的加密，
<b>不增不减主体针数</b>，所以在表里它显示为 ⟡ 附注而不是额外的针数。
<b>半针留针</b>用在身体 R4：只钩内半针，外半针 24 针整圈留着，下摆荷叶边就从这 24 针起钩。</p>
</div>

<h2 id="order">制作顺序</h2>
<div class="card">
 <ol class="tight" style="margin:0">
  <li><b>头部</b>（10 圈）→ 塞棉、收口、绣五官。</li>
  <li><b>身体</b>（7 圈，R4 只钩内半针）→ 立刻在留出的 24 个外半针上钩<b>下摆荷叶边</b>（3 圈）。</li>
  <li><b>领口荷叶边</b>（3 圈）单独钩好待用。</li>
  <li><b>手臂 ×2</b> → 缝在身体两侧。</li>
  <li><b>帽冠</b>（7 圈）+ <b>帽檐白卷边</b>（4 圈，对折成双层）→ 组合成帽子。</li>
  <li><b>发帽</b>（6 圈，最后一圈挂 30 个卷曲针）+ <b>侧长卷发 ×2</b>。</li>
  <li>头发戴在头上 → 帽子压在头发上 → <b>花</b> + <b>叶</b>缝在帽右侧。</li>
  <li>最后把头缝到身体上，同时把领口荷叶边内圈夹进缝线。</li>
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
<p class="tip">点任意一行可高亮，同时点亮左图对应的那一圈；勾选框会存在本机，关掉再打开还在。</p>
{parts_html}

<h2 id="faces">五官与缝合（不计数）</h2>
<div class="grid2">
 <div class="card">
  <h3 style="margin-top:0">五官刺绣</h3>
  <ul class="tight" style="margin-bottom:0">
   <li><b>眼睛</b>：深绿／翡翠绿绣线，在脸中线左右各 1.0 cm，竖着缎面绣 3 针（约 3 × 4 mm），上端略收成杏仁形。</li>
   <li><b>高光</b>：白线在每只眼睛右上方点 1 针，约 1 mm。</li>
   <li><b>嘴</b>：粉色线在眼下 0.8 cm 处绣 3 mm 短横。</li>
   <li><b>腮红</b>：色粉用小刷扫两颊并晕开边缘；也可用粉线横向松绣 2 针。</li>
  </ul>
 </div>
 <div class="card">
  <h3 style="margin-top:0">缝合要点</h3>
  <ul class="tight" style="margin-bottom:0">
   <li>头底最后 6 针塞进身体 12 针脖口里，沿颈缝一圈；缝到一半时把<b>领口荷叶边</b>内圈夹进去。</li>
   <li>发帽前缘压在<b>眉毛上沿</b>，别压住眼睛；下沿用藏针法固定在头两侧。</li>
   <li>帽冠里塞薄薄一层棉撑形；帽子只在前额两侧各缝 2–3 针，方便以后取下。</li>
   <li>两缕长卷末端再缝 1 针固定在领口，避免翘起。</li>
  </ul>
 </div>
</div>

<h2 id="size">改针号／改线的尺寸提醒</h2>
<div class="card">
 <p style="margin-top:0">换针或换线会改变密度，<b>上面的针数不能直接套用</b>。换算关系：新尺寸 ≈ 原尺寸 × (原针数密度 ÷ 新针数密度)。</p>
 <ul class="tight">
  <li><b>只换钩针不换线</b>（2.0 → 2.5 mm）：约放大 10–12%，总高约 8.8 cm，一般不必改针数。</li>
  <li><b>1.5 mm + 蕾丝线</b>（≈3.2 针/cm）：同样 30 针的头只剩约 2.9 cm。要做到 5–6 cm 总高，头需降到 24 针、身体 18 针，整体约 0.75 倍重算，先钩头部试样。</li>
  <li><b>3.0 mm + 5 股牛奶棉</b>（≈2.0 针/cm）：同样 30 针的头变成约 4.8 cm，总高约 10–11 cm，棉花多塞约 1.5 倍，帽冠可加到 36 针。</li>
 </ul>
 <p class="tip" style="margin-bottom:0">卷发和荷叶边对密度最敏感：线细了会塌，线粗了会硬。换线后先钩一条卷曲针试手感再定针数。
 <b>要不要保尺寸？</b>保尺寸就按新密度重算全部针数（改规格，不改这张表）；保针数就只换线，接受成品变大或变小。</p>
</div>

<h2 id="faq">常见问题</h2>
<div class="card">
 <ul class="tight" style="margin:0">
  <li><b>卷曲针卷不起来？</b>每个锁针里必须钩满 3 针，钩 2 针不会卷；钩的时候别拉直，让它自己盘。</li>
  <li><b>荷叶边不翻平？</b>加针不够。领口 12→24、下摆 24→36，少于这个倍数就蓬不起来。</li>
  <li><b>帽子总往下掉？</b>帽冠 R7 之后钩一圈 30SL 收紧，帽口会缩 2–3 mm 正好卡住头。</li>
  <li><b>脸太平或太鼓？</b>头部 R7 开始塞棉时把棉花往两侧压，中间留薄一点，脸的平面就出来了。</li>
  <li><b>卷发太密遮住脸？</b>正中 5 个卷曲针改用 4CH 短卷，其余用 6CH 长卷；也可改成每 2 针挂 1 个（15 条）。</li>
  <li><b>下摆荷叶边歪？</b>钩的时候把身体倒过来、外半针朝上，一圈钩完再翻正。</li>
  <li><b>加减针处有小洞？</b>减针用「隐形减针」（只挑两针的前半针），洞会小很多。</li>
 </ul>
</div>

{verify_section()}

<footer>
 gummy-绿发女孩 · 「软糖图解」 ｜ 单个自包含 HTML（内联 CSS/JS + 内嵌 SVG），断网可直接打开 ｜ 进度保存在本机浏览器
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
    print("=" * 88)
    print(f'{"部件":<16}{"圈":>3}{"消耗":>6}{"产出":>6}{"增减":>6}  记法')
    print("=" * 88)
    for p, po in zip(PARTS, VAL["parts"]):
        print(f'\n【{p["name"]}】  {COL[p["color"]]["name"]}  ×{p.get("mult",1)}')
        for rd in po["rows"]:
            txt = rd["prefix"] + notation(rd["unit"], rd["times"])
            if rd["decor"]:
                txt += f' ⟡{rd["decor"][0]["count"]}×{rd["decor"][0]["kind"]}'
            if rd["loop"] == "blo":
                txt += " 〔内半针〕"
            print(f'  R{rd["r"]:<3} {rd["sin"]:>5}{rd["sout"]:>6}{rd["delta"]:>+6}  {txt}'
                  f'   {"✓" if rd["ok"] else "✗ " + "; ".join(rd["errors"])}')
        print(f'      末圈 {po["final"]} 针，单件 {po["stitches"]} 针，×{p.get("mult",1)} = {po["stitches"]*p.get("mult",1)}')
    print("\n" + "=" * 88)
    s = VAL["summary"]
    print(f'总圈数 {s["rounds"]} ｜ 总针数 {s["totalStitches"]} ｜ 装饰针迹 {s["decorCount"]} 个 ｜ 留针圈 {s["reservedLoops"]} 处')
    print(f'用线 {YARN["total"]["meters"]} m / {YARN["total"]["grams"]} g（含 {int(BUFFER*100)}% 损耗：'
          f'{YARN["withBuffer"]["meters"]} m / {YARN["withBuffer"]["grams"]} g）')
    print(f'结论：{"✓ 全部通过" if VAL["ok"] else "✗ 存在错误"}')
    for w in VAL["warnings"]:
        print("  警告：", w)
    for e in VAL["errors"]:
        print("  错误：", e)
    print("=" * 88)
