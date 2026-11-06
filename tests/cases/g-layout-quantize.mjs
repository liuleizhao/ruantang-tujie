// G. circleLayout（§3.7）；H. quantize 确定性（§3.9）；I-前置 summarizePhotoRegions（§3.10）
import { assert } from '../lib/harness.mjs';

const GAUGE = { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5 };

export function register(h, ctx) {
  h.section('G. circleLayout 符号图坐标（契约 §3.7）');

  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };

  // 一个针数递增的部件，radius 应随 stitchesOut 单调不减
  const makePart = () => {
    const E = requireEngine();
    const shape = E.buildShape({ kind: 'sphere', diameterCm: 8 }, GAUGE);
    return {
      id: 'head', name: '头部', shape: { kind: 'sphere', diameterCm: 8 },
      rounds: shape.rounds,
      subtotal: { stitches: shape.rounds.reduce((s, r) => s + r.stitchesOut, 0), rounds: shape.rounds.length },
    };
  };

  h.it('返回数组，每项含 r 与 stitches[]', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = assert.noThrow(() => E.circleLayout(p), 'circleLayout(part) 抛异常');
    assert.isArr(layout, 'circleLayout 必须返回数组');
    assert.eq(layout.length, p.rounds.length, `布局圈数应等于部件圈数 ${p.rounds.length}，实际 ${layout.length}`);
    for (const l of layout) {
      assert.hasKeys(l, ['r', 'stitches'], '布局项缺 r/stitches 字段');
      assert.isArr(l.stitches, `第 ${l.r} 圈的 stitches 必须是数组`);
    }
  });

  h.it('第 1 圈针目数 === 该圈 stitchesOut', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = E.circleLayout(p);
    assert.ok(layout.length > 0, '布局不能为空');
    const first = layout[0];
    assert.eq(first.stitches.length, p.rounds[0].stitchesOut,
      `第 1 圈针目数 ${first.stitches.length} 应等于 stitchesOut ${p.rounds[0].stitchesOut}`);
  });

  h.it('每一圈针目数都 === 该圈 stitchesOut', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = E.circleLayout(p);
    const bad = [];
    for (const l of layout) {
      const rd = p.rounds.find((r) => r.r === l.r);
      if (!rd) { bad.push(`layout 含未知圈 R${l.r}`); continue; }
      if (l.stitches.length !== rd.stitchesOut) {
        bad.push(`R${l.r}: 针目 ${l.stitches.length} ≠ stitchesOut ${rd.stitchesOut}`);
      }
    }
    assert.eq(bad.length, 0, `针目数与 stitchesOut 不符:\n  ${bad.join('\n  ')}`);
  });

  h.it('所有坐标落在 -1..1 范围内', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = E.circleLayout(p);
    const bad = [];
    for (const l of layout) {
      for (const s of l.stitches) {
        if (!(s.x >= -1.001 && s.x <= 1.001 && s.y >= -1.001 && s.y <= 1.001)) {
          bad.push(`R${l.r} i=${s.i} x=${s.x} y=${s.y}`);
        }
      }
    }
    assert.eq(bad.length, 0, `坐标必须归一化到 -1..1:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });

  h.it('半径随针数单调不减（radius = sqrt(stitchesOut/maxStitches)）', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = E.circleLayout(p);
    const max = Math.max(...p.rounds.map((r) => r.stitchesOut));
    const rows = layout.map((l) => {
      const rd = p.rounds.find((r) => r.r === l.r);
      const radius = Math.max(...l.stitches.map((s) => Math.hypot(s.x, s.y)));
      return { r: l.r, out: rd.stitchesOut, radius, expect: Math.sqrt(rd.stitchesOut / max) };
    });
    // 指针数不减的相邻对，半径也必须不减
    const bad = [];
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].out >= rows[i - 1].out && rows[i].radius + 1e-6 < rows[i - 1].radius) {
        bad.push(`R${rows[i - 1].r}(out=${rows[i - 1].out},r=${rows[i - 1].radius.toFixed(4)}) → R${rows[i].r}(out=${rows[i].out},r=${rows[i].radius.toFixed(4)})`);
      }
    }
    assert.eq(bad.length, 0, `半径应随针数单调不减:\n  ${bad.join('\n  ')}`);
  });

  h.it('半径符合 r = sqrt(stitchesOut/maxStitches)', () => {
    const E = requireEngine();
    const p = makePart();
    const layout = E.circleLayout(p);
    const max = Math.max(...p.rounds.map((r) => r.stitchesOut));
    const bad = [];
    for (const l of layout) {
      const rd = p.rounds.find((r) => r.r === l.r);
      if (!rd || !rd.stitchesOut) continue;
      const expect = Math.sqrt(rd.stitchesOut / max);
      const actual = Math.max(...l.stitches.map((s) => Math.hypot(s.x, s.y)));
      if (Math.abs(actual - expect) > 0.02) bad.push(`R${l.r}: 实测半径 ${actual.toFixed(4)} ≠ 期望 ${expect.toFixed(4)}`);
    }
    assert.eq(bad.length, 0, `半径公式不符（面积均分）:\n  ${bad.join('\n  ')}`);
  });

  h.it('起始角在 12 点方向、顺时针排列', () => {
    const E = requireEngine();
    // 造一个 12 针的圈，便于检查角度分布
    const part = {
      id: 'p', name: 'p', shape: { kind: 'flat-round', diameterCm: 4 },
      rounds: [
        { r: 1, kind: 'magic-ring', color: 'C3', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] },
        { r: 2, kind: 'round', color: 'C3', stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] },
      ],
      subtotal: { stitches: 18, rounds: 2 },
    };
    const layout = E.circleLayout(part);
    const r2 = layout.find((l) => l.r === 2);
    assert.ok(r2 && r2.stitches.length === 12, '第 2 圈应有 12 个针目');
    const s0 = r2.stitches[0];
    // 12 点方向 = (0, -1)（y 向下为正）
    assert.approx(s0.x, 0, 0.03, `第 1 个针目应在 12 点方向 x≈0，实际 x=${s0.x}`);
    assert.approx(s0.y, -1 * Math.max(...r2.stitches.map((s) => Math.hypot(s.x, s.y))), 0.03,
      `第 1 个针目应在 12 点方向 y≈-r，实际 y=${s0.y}`);
    // 第 2 个针目应在第一象限（顺时针 → x>0）
    const s1 = r2.stitches[1];
    assert.ok(s1.x > 0, `顺时针排列时第 2 个针目 x 应 > 0，实际 x=${s1.x}`);
  });

  /* ─────────────── H. quantize ─────────────── */
  h.section('H. quantize 确定性（契约 §3.9）');

  const makePixels = () => {
    // 4 个色簇 + 少量噪声，共 200 像素
    const px = [];
    const clusters = [[250, 240, 235], [90, 140, 90], [240, 210, 150], [240, 165, 160]];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i += 1) {
      const base = clusters[i % clusters.length];
      px.push(base.map((c) => Math.max(0, Math.min(255, Math.round(c + (rnd() - 0.5) * 30)))));
    }
    return px;
  };

  h.it('返回 {palette:[{hex,count,ratio}]}，按 count 降序', () => {
    const E = requireEngine();
    const px = makePixels();
    const r = assert.noThrow(() => E.quantize(px, 4), 'quantize(pixels, 4) 抛异常');
    assert.isObj(r, 'quantize 必须返回对象');
    assert.isArr(r.palette, 'quantize().palette 必须是数组');
    assert.gte(r.palette.length, 1, 'palette 不能为空');
    for (const c of r.palette) {
      assert.hasKeys(c, ['hex', 'count', 'ratio'], 'palette 项缺 hex/count/ratio');
      assert.match(c.hex, /^#[0-9A-F]{6}$/, `hex 必须是大写 #RRGGBB，实际 "${c.hex}"`);
      assert.isNum(c.count, 'count 必须是数字');
      assert.isNum(c.ratio, 'ratio 必须是数字');
    }
    const counts = r.palette.map((c) => c.count);
    const sorted = [...counts].sort((a, b) => b - a);
    assert.deepEq(counts, sorted, `palette 必须按 count 降序，实际 ${counts.join(',')}`);
  });

  h.it('确定性：同输入两次调用结果完全一致（深比较）', () => {
    const E = requireEngine();
    const px = makePixels();
    const a = E.quantize(px, 4);
    const b = E.quantize(px, 4);
    assert.deepEq(a, b, 'quantize 必须确定性（固定种子 42）：同输入两次结果不一致');
  });

  h.it('确定性：显式 seed 相同则一致，不同 seed 允许不同', () => {
    const E = requireEngine();
    const px = makePixels();
    const a = E.quantize(px, 4, { seed: 7 });
    const b = E.quantize(px, 4, { seed: 7 });
    assert.deepEq(a, b, '相同 seed 必须产出相同结果');
  });

  h.it('色数 ≤ k', () => {
    const E = requireEngine();
    const px = makePixels();
    for (const k of [2, 3, 4, 8]) {
      const r = E.quantize(px, k);
      assert.lte(r.palette.length, k, `k=${k} 时色数应 ≤ ${k}，实际 ${r.palette.length}`);
    }
  });

  h.it('支持扁平数组输入 [r,g,b,r,g,b,...]', () => {
    const E = requireEngine();
    const flat = [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 255, 255, 255, 0, 0, 0];
    const r = assert.noThrow(() => E.quantize(flat, 3), 'quantize 不接受扁平数组（契约 §3.9 要求两种都支持）');
    assert.isArr(r.palette, '扁平数组输入也要返回 palette');
    assert.gte(r.palette.length, 1, '扁平数组输入时 palette 不能为空');
  });

  h.it('ratio 之和 ≈ 1', () => {
    const E = requireEngine();
    const r = E.quantize(makePixels(), 4);
    const sum = r.palette.reduce((s, c) => s + c.ratio, 0);
    assert.approx(sum, 1, 0.02, `ratio 之和应 ≈ 1，实际 ${sum}`);
  });

  /* ─────────────── summarizePhotoRegions ─────────────── */
  h.section('I-前置. summarizePhotoRegions 区域占比（契约 §3.10）');

  h.it('返回 dominant/bands/suggested，bands 含 top/middle/bottom', () => {
    const E = requireEngine();
    const w = 20; const hgt = 30;
    const px = [];
    for (let y = 0; y < hgt; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 10) px.push([40, 40, 40]);        // 上：头发（深）
        else if (y < 20) px.push([250, 220, 190]); // 中：肤色
        else px.push([90, 140, 200]);              // 下：衣服（蓝）
      }
    }
    const r = assert.noThrow(() => E.summarizePhotoRegions(px, w, hgt, 4), 'summarizePhotoRegions 抛异常');
    assert.hasKeys(r, ['dominant', 'bands', 'suggested'], '返回值缺 dominant/bands/suggested');
    assert.isArr(r.dominant, 'dominant 必须是数组');
    assert.ok(r.dominant.length > 0, 'dominant 不能为空');
    assert.hasKeys(r.bands, ['top', 'middle', 'bottom'], 'bands 必须含 top/middle/bottom');
    assert.hasKeys(r.suggested, ['hair', 'skin', 'cloth'], 'suggested 必须含 hair/skin/cloth');
    for (const k of ['top', 'middle', 'bottom']) {
      assert.isArr(r.bands[k], `bands.${k} 必须是数组`);
    }
  });

  h.it('bands 三段能区分出各自的代表色（上深 / 中浅 / 下蓝）', () => {
    const E = requireEngine();
    const w = 20; const hgt = 30;
    const px = [];
    for (let y = 0; y < hgt; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (y < 10) px.push([30, 30, 30]);
        else if (y < 20) px.push([250, 225, 200]);
        else px.push([80, 130, 210]);
      }
    }
    const r = E.summarizePhotoRegions(px, w, hgt, 4);
    const hexToRgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
    const lum = (hx) => { const [a, b, c] = hexToRgb(hx); return 0.299 * a + 0.587 * b + 0.114 * c; };
    const topMain = r.bands.top[0];
    const midMain = r.bands.middle[0];
    const botMain = r.bands.bottom[0];
    assert.ok(topMain && midMain && botMain, '三段都应有主色');
    assert.lt(lum(topMain.hex), lum(midMain.hex),
      `上段应比中段深（头发 vs 肤色）：top=${topMain.hex} lum=${lum(topMain.hex).toFixed(0)}，mid=${midMain.hex} lum=${lum(midMain.hex).toFixed(0)}`);
    const [br, bg, bb] = hexToRgb(botMain.hex);
    assert.ok(bb > br, `下段应是蓝系（蓝分量 ${bb} > 红分量 ${br}），实际 ${botMain.hex}`);
    void bg;
  });
}
