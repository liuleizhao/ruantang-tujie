// D. buildShape 形状正确性 + 自洽性（契约 §3.4）
// 最重要的一条：引擎自产出的图必须能通过自己的 validateChart
import { assert } from '../lib/harness.mjs';

const GAUGE = { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5 };

export function register(h, ctx) {
  h.section('D. buildShape 形状推导（sphere 对称 / 各形状自洽）');

  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };

  const shapeOf = (shape, gauge = GAUGE) => {
    const E = requireEngine();
    const r = assert.noThrow(() => E.buildShape(shape, gauge), `buildShape(${JSON.stringify(shape)}) 抛异常`);
    assert.isObj(r, 'buildShape 必须返回对象');
    assert.isArr(r.rounds, 'buildShape().rounds 必须是数组');
    assert.ok(r.rounds.length > 0, `buildShape(${JSON.stringify(shape)}).rounds 不能为空`);
    assert.isObj(r.plan, 'buildShape().plan 必须存在（契约 §3.4）');
    return r;
  };

  /** 把 buildShape 结果包成 chart 喂给 validateChart */
  const validateAsChart = (rounds, id = 'p') => {
    const E = requireEngine();
    // buildShape 不负责配色（配色是 buildChart 的职责），这里补上合法 palette 色
    const colored = rounds.map((r) => ({ ...r, color: r.color || 'C3' }));
    const c = {
      version: 1,
      name: 'buildShape 自洽性',
      createdAt: '2026-10-29T00:00:00.000Z',
      spec: {},
      gauge: GAUGE,
      palette: [
        { id: 'C1', name: '雪白', hex: '#F7F3EE', role: 'skin' },
        { id: 'C3', name: '奶油黄', hex: '#F2D59B', role: 'main' },
      ],
      parts: [{
        id, name: id, shape: { kind: 'sphere', diameterCm: 5 },
        rounds: colored, subtotal: { stitches: colored.reduce((s, r) => s + (r.stitchesOut || 0), 0), rounds: colored.length },
      }],
    };
    return E.validateChart(c);
  };

  /* ── sphere ── */
  h.it('sphere：rounds 非空且首圈为 magic-ring 6', () => {
    const r = shapeOf({ kind: 'sphere', diameterCm: 8 });
    assert.eq(r.rounds[0].kind, 'magic-ring', 'sphere 第 1 圈必须是 magic-ring');
    assert.eq(r.rounds[0].stitchesIn, 0, 'sphere 起针圈 stitchesIn 必须为 0（R4）');
    assert.eq(r.rounds[0].stitchesOut, 6, 'sphere 起针圈应为 6 针');
  });

  h.it('sphere：maxStitches 是 6 的整数倍', () => {
    const r = shapeOf({ kind: 'sphere', diameterCm: 8 });
    const max = r.plan.maxStitches;
    assert.isNum(max, 'plan.maxStitches 必须是数字（契约 §3.4）');
    assert.eq(max % 6, 0, `maxStitches 必须是 6 的整数倍，实际 ${max}`);
  });

  h.it('sphere：maxStitches ≈ π×diameterCm×stPerCm（容差 6）', () => {
    for (const d of [4, 6, 8, 10]) {
      const r = shapeOf({ kind: 'sphere', diameterCm: d });
      const expect = Math.PI * d * GAUGE.stPerCm;
      assert.approx(r.plan.maxStitches, expect, 6,
        `sphere(d=${d}) 的 maxStitches 应 ≈ π×${d}×2.2 = ${expect.toFixed(1)}`);
    }
  });
  h.it('sphere：递增与递减镜像对称（第 n 圈 === 倒数第 n 圈）', () => {
    const r = shapeOf({ kind: 'sphere', diameterCm: 8 });
    const out = r.rounds.map((x) => x.stitchesOut);
    const n = out.length;
    const pairs = [];
    for (let i = 0; i < Math.floor(n / 2); i += 1) {
      pairs.push([i + 1, n - i, out[i], out[n - 1 - i]]);
    }
    const bad = pairs.filter(([, , a, b]) => a !== b);
    assert.eq(bad.length, 0,
      `sphere 增减必须镜像对称，违反的对: ${bad.map(([a, b, x, y]) => `R${a}(${x}) vs R${b}(${y})`).join(', ')}\n  全部圈: ${out.join(',')}`);
  });

  h.it('sphere：递增段每圈 +6，直到 maxStitches', () => {
    const r = shapeOf({ kind: 'sphere', diameterCm: 8 });
    const out = r.rounds.map((x) => x.stitchesOut);
    const max = r.plan.maxStitches;
    const peak = Math.max(...out);
    assert.eq(peak, max, `峰值应等于 maxStitches=${max}，实际 ${peak}`);
    const incRounds = r.plan.incRounds;
    if (typeof incRounds === 'number') {
      for (let i = 1; i <= incRounds; i += 1) {
        assert.eq(out[i], out[i - 1] + 6, `第 ${i + 1} 圈应在第 ${i} 圈基础上 +6`);
      }
    }
  });

  h.it('sphere：结果喂给 validateChart 必须 ok===true（引擎自洽）', () => {
    for (const d of [4, 6, 8, 10]) {
      const r = shapeOf({ kind: 'sphere', diameterCm: d });
      const v = validateAsChart(r.rounds, `sphere${d}`);
      const errs = (v.errors || []).concat(...(v.parts || []).map((p) => p.errors || []));
      assert.eq(v.ok, true, `createShape(sphere, d=${d}) 自产图未通过校验：\n  ${errs.join('\n  ')}`);
    }
  });

  /* ── 其他形状：非空 rounds + 自洽 ── */
  const shapes = [
    ['capsule', { kind: 'capsule', diameterCm: 6.5, heightCm: 8 }],
    ['cylinder', { kind: 'cylinder', diameterCm: 5.2, heightCm: 6 }],
    ['cone', { kind: 'cone', diameterCm: 6, heightCm: 8 }],
    ['flat-round', { kind: 'flat-round', diameterCm: 6 }],
    ['flat-row', { kind: 'flat-row', widthCm: 6, heightCm: 12 }],
  ];

  for (const [name, shape] of shapes) {
    h.it(`${name}：生成非空 rounds`, () => {
      const r = shapeOf(shape);
      assert.ok(r.rounds.length > 0, `${name} 必须生成至少 1 圈`);
      assert.isObj(r.plan, `${name} 必须给出 plan`);
      // flat-row 是片织，没有周长/口径概念，plan 用 stitchesPerRow 而非 maxStitches
      if (name === 'flat-row') {
        assert.isNum(r.plan.stitchesPerRow, `flat-row 的 plan.stitchesPerRow 必须是数字`);
      } else {
        assert.isNum(r.plan.maxStitches, `${name} 的 plan.maxStitches 必须是数字`);
      }
    });

    h.it(`${name}：结果喂给 validateChart 必须 ok===true`, () => {
      const r = shapeOf(shape);
      const v = validateAsChart(r.rounds, name);
      const errs = (v.errors || []).concat(...(v.parts || []).map((p) => p.errors || []));
      assert.eq(v.ok, true, `${name} 自产图未通过校验：\n  ${errs.join('\n  ')}`);
    });
  }

  h.it('flat-row：首圈为 row 类型且 stitchesOut === round(widthCm × stPerCm)', () => {
    const r = shapeOf({ kind: 'flat-row', widthCm: 6, heightCm: 10 });
    assert.eq(r.rounds[0].kind, 'row', 'flat-row 第 1 圈 kind 应为 "row"');
    const expect = Math.round(6 * GAUGE.stPerCm);
    assert.eq(r.rounds[0].stitchesOut, expect, `flat-row 起针行应为 round(6×2.2)=${expect} 针`);
  });

  h.it('cylinder：递增到 maxStitches 后平织，不做递减', () => {
    const r = shapeOf({ kind: 'cylinder', diameterCm: 5.2, heightCm: 6 });
    const out = r.rounds.map((x) => x.stitchesOut);
    const max = Math.max(...out);
    const lastIdx = out.lastIndexOf(max);
    // 峰值之后（除收口）不应下降
    const after = out.slice(lastIdx + 1);
    const drops = after.filter((v) => v < max && v !== 0);
    assert.eq(drops.length, 0, `cylinder 平织段不应下降，实际圈序: ${out.join(',')}`);
  });

  h.it('buildShape 确定性：同参数两次结果完全一致', () => {
    const E = requireEngine();
    const a = E.buildShape({ kind: 'sphere', diameterCm: 8 }, GAUGE);
    const b = E.buildShape({ kind: 'sphere', diameterCm: 8 }, GAUGE);
    assert.deepEq(a.rounds, b.rounds, 'buildShape 必须是纯确定性函数');
  });

  h.it('buildShape 用默认 gauge（不传第二参）也能工作', () => {
    const E = requireEngine();
    const r = assert.noThrow(() => E.buildShape({ kind: 'sphere', diameterCm: 8 }), 'buildShape 不传 gauge 时抛异常');
    assert.ok(r.rounds.length > 0, '不传 gauge 时也应产出 rounds');
  });
}
