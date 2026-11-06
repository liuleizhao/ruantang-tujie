#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""analyze_photo.py —— 人物照片调色板分析（契约 §4.4）

用法：
    python tools/analyze_photo.py <photo> --k 8 --json

流程：EXIF 矫正 → 缩放到长边 ≤ 512 → 中位切分（median cut）播种去噪
      → 在 CIELAB 空间做确定性 Lloyd 精修 → 统计。

为什么要有第二步：median cut 的每个箱天生像素数相等，直接拿它统计
`dominant[].ratio` 会得到「k 个色各占 1/k」的假数据（本实现早期版本踩过）。
Lloyd 精修按真实最近邻归属重新计数，占比才有意义；同时 CIELAB 聚类
与 `GummyEngine.summarizePhotoRegions` 同处一个色彩空间，两侧结论更接近。
全程无随机：种子来自 median cut 的确定性切分。

输出 JSON：
    {
      "width": 266, "height": 264,
      "dominant": [{"hex": "#AABBCC", "ratio": 0.2311}, ...],   # 按占比降序
      "bands": {"top": [...], "middle": [...], "bottom": [...]},
      "suggested": {"hair": "#...", "skin": "#...", "cloth": "#..."}
    }

**与 GummyEngine.summarizePhotoRegions 的语义一致性（契约 §4.4 要求）**

bands 的三段定义（两侧实现必须逐字相同）：

    行号 y 属于第   min(2, floor(y * 3 / h))   段
    即 top = 行 [0, ceil(h/3))、middle 紧随、bottom 收尾；h 能被 3 整除时正好三等分。

`bands.*[].ratio` 是**段内**占比（同一段内各项之和 = 1.0），
`dominant[].ratio` 是**整图**占比（各项之和 = 1.0）。这一点混淆最容易出错，故此处显式记录。

退出码：0 成功；2 用法/IO 错误。
"""

import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageOps

# --------------------------------------------------------------------------
# 常量（与契约 §6 一致）
# --------------------------------------------------------------------------
MAX_EDGE = 512          # 长边上限，契约 §4.4
BAND_COUNT = 3          # 上/中/下三段
RATIO_DIGITS = 4        # 占比保留 4 位小数
DEFAULT_K = 8           # --k 缺省值
LLOYD_ITERS = 30        # Lloyd 精修上限（与 JS 侧 k-means「最多 30 轮」对齐）


# --------------------------------------------------------------------------
# 图像载入
# --------------------------------------------------------------------------
def load_rgb(path, max_edge=MAX_EDGE):
    """读图 → EXIF 矫正 → 透明底铺白 → 缩放到长边 ≤ max_edge。

    返回 (np.ndarray[H,W,3] uint8, width, height)。
    """
    with Image.open(path) as raw:
        im = ImageOps.exif_transpose(raw)          # 手机竖拍照的旋转信息必须吃掉
        if im.mode in ("RGBA", "LA", "P", "PA"):
            im = im.convert("RGBA")
            # 透明区域在钩织配色里没有意义，统一铺白，避免量化出「透明黑」
            canvas = Image.new("RGBA", im.size, (255, 255, 255, 255))
            im = Image.alpha_composite(canvas, im).convert("RGB")
        else:
            im = im.convert("RGB")

        w, h = im.size
        scale = min(1.0, float(max_edge) / float(max(w, h)))
        if scale < 1.0:
            im = im.resize(
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                Image.LANCZOS,
            )

    arr = np.asarray(im, dtype=np.uint8)
    if arr.ndim != 3 or arr.shape[2] != 3:
        raise ValueError("图像解码后不是 RGB 三通道，无法分析")
    return arr.copy(), arr.shape[1], arr.shape[0]


# --------------------------------------------------------------------------
# 中位切分量化（median cut）
# --------------------------------------------------------------------------
def _box_stats(pix, box):
    """返回该 box 内三通道的极差向量。"""
    sub = pix[box]
    return sub.max(axis=0).astype(np.int32) - sub.min(axis=0).astype(np.int32)


def median_cut(pix, k):
    """中位切分量化。

    pix: (N,3) uint8 展平后的像素。
    返回 (labels, colors)：
      labels[i] 是第 i 个像素所属调色板索引（用于分 band 统计）
      colors 是 (k,3) 调色板 RGB 均值

    确定性保证：选箱用 (像素数, 通道极差) 字典序取最大、同分取最小索引；
    箱内排序用 lexsort（主键=极差最大通道，次键 r,g,b），完全无随机。
    """
    n = pix.shape[0]
    if n == 0:
        return np.zeros(0, dtype=np.int64), np.zeros((0, 3), dtype=np.int32)

    boxes = [np.arange(n, dtype=np.int64)]

    while len(boxes) < k:
        best_idx = -1
        best_key = None
        for idx, box in enumerate(boxes):
            if box.size < 2:
                continue
            rng = _box_stats(pix, box)
            if int(rng.max()) == 0:
                continue                      # 箱内颜色全同，切不动
            key = (int(box.size), int(rng.max()))
            if best_key is None or key > best_key:
                best_key = key
                best_idx = idx
        if best_idx < 0:
            break                             # 已经没有可切的箱

        box = boxes[best_idx]
        sub = pix[box]
        rng = _box_stats(pix, box)
        ch = int(np.argmax(rng))              # 取极差最大的通道切

        # 主键 ch，再按 r,g,b 兜底，保证同值像素的次序也稳定
        order = np.lexsort((sub[:, 0], sub[:, 1], sub[:, 2], sub[:, ch]))
        sorted_box = box[order]

        mid = max(1, sorted_box.size // 2)
        boxes[best_idx] = sorted_box[:mid]
        boxes.append(sorted_box[mid:])

    colors = np.zeros((len(boxes), 3), dtype=np.int32)
    labels = np.zeros(n, dtype=np.int64)
    for idx, box in enumerate(boxes):
        if box.size == 0:
            colors[idx] = (0, 0, 0)
            continue
        colors[idx] = np.rint(pix[box].mean(axis=0)).astype(np.int32)
        colors[idx] = np.clip(colors[idx], 0, 255)
        labels[box] = idx
    return labels, colors


# --------------------------------------------------------------------------
# CIELAB 色彩空间（与 GummyEngine.quantize 使用同一套 sRGB D65 标准公式）
# --------------------------------------------------------------------------
# D65 白点
_WP = (0.95047, 1.00000, 1.08883)


def _srgb_to_linear(c):
    """sRGB 分量 0..1 → 线性光。"""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c):
    """线性光 → sRGB 分量 0..1。"""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)


def rgb_to_lab(rgb):
    """(N,3) 或 (3,) uint8/float RGB → CIELAB。返回 float64，同形状。"""
    arr = np.asarray(rgb, dtype=np.float64) / 255.0
    single = arr.ndim == 1
    if single:
        arr = arr[None, :]
    lin = _srgb_to_linear(arr)

    # 线性 RGB → XYZ (sRGB D65 矩阵)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ], dtype=np.float64)
    xyz = lin @ m.T
    xyz = xyz / np.array(_WP, dtype=np.float64)

    eps = 216.0 / 24389.0
    kappa = 24389.0 / 27.0
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16.0) / 116.0)

    L = 116.0 * f[:, 1] - 16.0
    a = 500.0 * (f[:, 0] - f[:, 1])
    b = 200.0 * (f[:, 1] - f[:, 2])
    out = np.stack([L, a, b], axis=1)
    return out[0] if single else out


def lab_to_rgb(lab):
    """CIELAB → (N,3) uint8 RGB（夹到 0..255）。"""
    arr = np.asarray(lab, dtype=np.float64)
    single = arr.ndim == 1
    if single:
        arr = arr[None, :]

    wp = np.array(_WP, dtype=np.float64)
    eps = 216.0 / 24389.0
    kappa = 24389.0 / 27.0

    fy = (arr[:, 0] + 16.0) / 116.0
    fx = fy + arr[:, 1] / 500.0
    fz = fy - arr[:, 2] / 200.0

    fx3, fy3, fz3 = fx ** 3, fy ** 3, fz ** 3
    xr = np.where(fx3 > eps, fx3, (116.0 * fx - 16.0) / kappa)
    yr = np.where(arr[:, 0] > kappa * eps, fy3, arr[:, 0] / kappa)
    zr = np.where(fz3 > eps, fz3, (116.0 * fz - 16.0) / kappa)

    xyz = np.stack([xr, yr, zr], axis=1) * wp
    m_inv = np.array([
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ], dtype=np.float64)
    lin = xyz @ m_inv.T
    srgb = _linear_to_srgb(np.clip(lin, 0.0, None))
    out = np.rint(np.clip(srgb, 0.0, 1.0) * 255.0).astype(np.int32)
    return out[0] if single else out


def lloyd_refine(lab, labels, centers_lab, iters=LLOYD_ITERS):
    """在 CIELAB 空间做确定性 Lloyd 精修（k-means 迭代）。

    - 归属：每个像素取最近的中心（等距时取索引最小者，保证确定性）。
    - 更新：中心取成员均值；**空簇保留原中心**，不再吸走别的簇的像素。
    - 收敛即停（标签不再变化）。

    返回 (labels, centers_lab, colors_rgb)。空簇会被剔除，所以 k 可能变少。
    """
    n = lab.shape[0]
    k = centers_lab.shape[0]
    if n == 0 or k == 0:
        return labels, centers_lab, np.zeros((0, 3), dtype=np.int32)

    for _ in range(max(1, int(iters))):
        # 分块算距离，避免 (N,k) 一次性撑爆内存；512x512 只有 26 万像素，够用
        d = ((lab[:, None, :] - centers_lab[None, :, :]) ** 2).sum(axis=2)
        new_labels = np.argmin(d, axis=1).astype(np.int64)   # argmin 天然「同距取最小索引」

        changed = not np.array_equal(new_labels, labels)
        labels = new_labels

        new_centers = centers_lab.copy()
        for c in range(k):
            sel = labels == c
            cnt = int(sel.sum())
            if cnt > 0:
                new_centers[c] = lab[sel].mean(axis=0)
        centers_lab = new_centers
        if not changed:
            break

    # 剔除空簇，并重新编号（保持确定性：按旧索引升序）
    used = [c for c in range(k) if int((labels == c).sum()) > 0]
    remap = {old: new for new, old in enumerate(used)}
    new_labels = np.array([remap[int(l)] for l in labels], dtype=np.int64) if used else labels
    centers_lab = centers_lab[used] if used else np.zeros((0, 3), dtype=np.float64)
    colors = lab_to_rgb(centers_lab) if len(used) else np.zeros((0, 3), dtype=np.int32)
    return new_labels, centers_lab, colors


# --------------------------------------------------------------------------
# band（上/中/下三段）定义 —— 必须与 JS 侧逐字一致
# --------------------------------------------------------------------------
def band_index_map(h, w):
    """生成每个像素的三段归属：min(2, floor(y * 3 / h))，y 为行号。"""
    rows = np.arange(h, dtype=np.int64)
    band_of_row = np.minimum(BAND_COUNT - 1, (rows * BAND_COUNT) // h)
    return np.repeat(band_of_row, w)


# --------------------------------------------------------------------------
# 颜色工具
# --------------------------------------------------------------------------
def rgb_to_hex(rgb):
    return "#%02X%02X%02X" % (int(rgb[0]), int(rgb[1]), int(rgb[2]))


def hex_to_rgb(hex_str):
    s = hex_str.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def luma(rgb):
    """感知亮度（Rec.601），0..1。"""
    r, g, b = rgb
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def saturation(rgb):
    r, g, b = [v / 255.0 for v in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx <= 1e-9 else (mx - mn) / mx


def is_skin_like(rgb):
    """经典 RGB 肤色判据（Kovac 等）：暖色、红分量占优、亮度不低。"""
    r, g, b = [int(v) for v in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    return (
        r > 80 and g > 30 and b > 15
        and (mx - mn) > 12
        and r > g + 6 and r > b + 12
        and r - g < 90 and g - b > -30
        and luma(rgb) > 0.18
    )


def is_hair_like(rgb):
    """头发：偏深，或饱和度明显的非肤色（绿发/紫发/蓝发都算）。"""
    sat = saturation(rgb)
    return luma(rgb) < 0.42 or (sat > 0.28 and not is_skin_like(rgb))


# --------------------------------------------------------------------------
# 主分析
# --------------------------------------------------------------------------
def analyze(path, k=DEFAULT_K):
    arr, w, h = load_rgb(path)
    pix = arr.reshape(-1, 3)
    n = pix.shape[0]

    labels, colors = median_cut(pix, max(1, int(k)))

    # ---- 第二步：median cut 的结果只当「确定性播种」，真正归属靠 CIELAB Lloyd 精修 ----
    # 没有这一步，median cut 的等尺寸箱会让 dominant 占比退化成 1/k（见文件头说明）。
    lab = rgb_to_lab(pix)
    seed_lab = rgb_to_lab(colors)
    labels, _centers_lab, colors = lloyd_refine(lab, labels, seed_lab)

    bands_of_pixel = band_index_map(h, w)

    # ---- 按「最终 hex」合并重复（median cut 可能产出两个相同均色） ----
    merged = {}   # hex -> [count_total, count_top, count_mid, count_bot]
    for idx in range(colors.shape[0]):
        sel = labels == idx
        cnt = int(sel.sum())
        if cnt == 0:
            continue
        hex_str = rgb_to_hex(colors[idx])
        per_band = np.bincount(bands_of_pixel[sel], minlength=BAND_COUNT).tolist()
        slot = merged.setdefault(hex_str, [0, 0, 0, 0])
        slot[0] += cnt
        for b in range(BAND_COUNT):
            slot[b + 1] += int(per_band[b])

    # ---- 排序：占比降序，同占比按 hex 升序（确定性） ----
    items = sorted(merged.items(), key=lambda kv: (-kv[1][0], kv[0]))
    dominant = [
        {"hex": hx, "ratio": round(v[0] / float(n), RATIO_DIGITS)}
        for hx, v in items
    ]

    # ---- 三段：段内占比（同段之和 = 1.0） ----
    bands_out = {}
    band_totals = [sum(v[b + 1] for v in merged.values()) for b in range(BAND_COUNT)]
    for b, name in enumerate(("top", "middle", "bottom")):
        total = band_totals[b]
        entries = []
        for hx, v in items:
            if v[b + 1] <= 0:
                continue
            entries.append({
                "hex": hx,
                "ratio": round(v[b + 1] / float(total), RATIO_DIGITS) if total else 0.0,
            })
        entries.sort(key=lambda e: (-e["ratio"], e["hex"]))
        bands_out[name] = entries

    suggested = suggest(stable_items(items), bands_out)
    return {
        "width": int(w),
        "height": int(h),
        "dominant": dominant,
        "bands": bands_out,
        "suggested": suggested,
    }


def stable_items(items):
    """把 (hex, [total, top, mid, bot]) 还原成带 rgb 的候选列表。"""
    out = []
    for hx, v in items:
        out.append({
            "hex": hx, "rgb": hex_to_rgb(hx), "count": v[0],
            "top": v[1], "middle": v[2], "bottom": v[3],
        })
    return out


def suggest(items, bands_out):
    """按「占比 + 位置」启发式给出 头发 / 肤 / 衣服 三个建议色。

    位置先验：头在上段、肤色集中在中段（脸），衣服在下段（裙摆/腿）。
    """
    fallback = {"hair": "#5B4636", "skin": "#F2D6C2", "cloth": "#8E7CC3"}
    if not items:
        return fallback

    top_names = [e["hex"] for e in bands_out.get("top", [])]
    mid_names = [e["hex"] for e in bands_out.get("middle", [])]
    bot_names = [e["hex"] for e in bands_out.get("bottom", [])]

    def by_hex(hx):
        for it in items:
            if it["hex"] == hx:
                return it
        return None

    # ---- 头发：上段里最像头发的；退化到上段第一名 ----
    hair = None
    for hx in top_names:
        it = by_hex(hx)
        if it and is_hair_like(it["rgb"]):
            hair = hx
            break
    if hair is None and top_names:
        hair = top_names[0]

    # ---- 肤色：全图里最像肤色的（优先中段/下段，因为脸在中间） ----
    skin = None
    best_score = None
    for it in items:
        if not is_skin_like(it["rgb"]):
            continue
        band_bonus = 0.0
        if it["hex"] in mid_names:
            band_bonus = it["middle"] * 1.4
        elif it["hex"] in bot_names:
            band_bonus = it["bottom"] * 0.6
        score = band_bonus + it["count"] * 0.5
        if best_score is None or score > best_score:
            best_score = score
            skin = it["hex"]
    if skin is None:
        # 退化：取亮度最高、饱和度最低的颜色当作皮肤
        cand = sorted(items, key=lambda it: (-luma(it["rgb"]), saturation(it["rgb"])))
        if cand:
            skin = cand[0]["hex"]

    # ---- 衣服：下段占比最高且不是头发/肤色的；退化到全图次高 ----
    cloth = None
    for hx in bot_names:
        if hx != hair and hx != skin:
            cloth = hx
            break
    if cloth is None:
        for hx in mid_names:
            if hx != hair and hx != skin:
                cloth = hx
                break
    if cloth is None:
        for it in items:
            if it["hex"] not in (hair, skin):
                cloth = it["hex"]
                break
    if cloth is None:
        cloth = items[0]["hex"]

    return {
        "hair": hair or fallback["hair"],
        "skin": skin or fallback["skin"],
        "cloth": cloth or fallback["cloth"],
    }


# --------------------------------------------------------------------------
# 人类可读输出
# --------------------------------------------------------------------------
def print_human(result):
    print("图像尺寸：%d x %d" % (result["width"], result["height"]))
    print("")
    print("主导色 (整图占比)：")
    for i, e in enumerate(result["dominant"], 1):
        print("  %2d. %s  %6.2f%%" % (i, e["hex"], e["ratio"] * 100))
    print("")
    for name, cn in (("top", "上段"), ("middle", "中段"), ("bottom", "下段")):
        entries = result["bands"].get(name, [])
        txt = "  ".join("%s %.1f%%" % (e["hex"], e["ratio"] * 100) for e in entries[:5])
        print("%s（段内占比）：%s" % (cn, txt if txt else "（无像素）"))
    print("")
    s = result["suggested"]
    print("建议配色：头发 %s   肤色 %s   衣服 %s" % (s["hair"], s["skin"], s["cloth"]))


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv):
    ap = argparse.ArgumentParser(
        prog="analyze_photo.py",
        description="人物照片调色板分析（契约 §4.4）：EXIF 矫正 → 长边≤512 → 中位切分 → JSON",
    )
    ap.add_argument("photo", help="照片路径（PNG/JPG/WebP）")
    ap.add_argument("--k", type=int, default=DEFAULT_K, help="量化色数，默认 %d" % DEFAULT_K)
    ap.add_argument("--json", action="store_true", help="输出 JSON 到 stdout")
    args = ap.parse_args(argv)

    if args.k < 1:
        sys.stderr.write("错误：--k 必须 >= 1\n")
        return 2

    try:
        result = analyze(args.photo, args.k)
    except FileNotFoundError:
        sys.stderr.write("错误：找不到照片文件：%s\n" % args.photo)
        return 2
    except (OSError, ValueError) as exc:
        sys.stderr.write("错误：无法读取或解析照片：%s（%s）\n" % (args.photo, exc))
        return 2

    if args.json:
        # ensure_ascii=False 让中文 / 说明保持可读；sort_keys 保证确定性
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_human(result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
