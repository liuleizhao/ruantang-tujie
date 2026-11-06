// R. R11 主体可钩性 + assessIdentity 还原度自检
import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../lib/harness.mjs';

export function register(h, ctx) {
  const B = ctx.builders;

  function validate(c) {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    const E = ctx.engine.E;
    return assert.noThrow(() => E.validateChart(c), 'validateChart 抛异常');
  }

  function allTexts(v) {
    return (v.errors || []).concat(v.warnings || []);
  }

  h.section('R. R11 主体可钩性门槛');

  h.it('R11：主体最宽圈 ≥ 24 → 无 R11 警告/错误', () => {
    const rounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 24, ops: [{ sym: 'V', n: 12 }] }),
      B.round(4, { stitchesIn: 24, stitchesOut: 24, ops: [{ sym: 'X', n: 24 }] }),
    ];
    const c = B.chart([B.part('head', rounds, { kind: 'sphere', diameterCm: 5 }, '头部')]);
    const v = validate(c);
    assert.eq(v.ok, true, `应通过：${allTexts(v).join(' | ')}`);
    assert.ok(!(v.warnings || []).some((w) => /R11/.test(w)),
      `不应有 R11 警告，实际: ${JSON.stringify(v.warnings)}`);
    assert.isObj(v.summary.craftability, 'summary.craftability 必须存在');
  });

  h.it('R11：主体最宽圈 18..23 → 警告但不失败', () => {
    const rounds = B.canonicalRounds(); // max 18
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 3, heightCm: 2 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, true, `偏紧仍应 ok：${allTexts(v).join(' | ')}`);
    assert.ok((v.warnings || []).some((w) => /R11|可钩性偏紧/.test(w)),
      `应有 R11 软警告，实际: ${JSON.stringify(v.warnings)}`);
    assert.eq(v.summary.craftability.softWarns, 1);
  });

  h.it('R11：主体最宽圈 < 18 → 错误', () => {
    const rounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 12, ops: [{ sym: 'X', n: 12 }] }),
    ];
    const c = B.chart([B.part('head', rounds, { kind: 'sphere', diameterCm: 2 }, '头部')]);
    const v = validate(c);
    assert.eq(v.ok, false, '过窄主体必须失败');
    assert.ok((v.errors || []).some((e) => /R11|可钩性不足/.test(e)),
      `应报 R11，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R11：小件（eye/arm）不参与门槛', () => {
    const tiny = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
    ];
    const head = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 24, ops: [{ sym: 'V', n: 12 }] }),
      B.round(4, { stitchesIn: 24, stitchesOut: 30, ops: [{ sym: 'X', n: 18 }, { sym: 'V', n: 6 }] }),
    ];
    const c = B.chart([
      B.part('head', head, { kind: 'sphere', diameterCm: 5 }, '头部'),
      B.part('eye', tiny, { kind: 'flat-round', diameterCm: 0.5 }, '眼睛'),
      B.part('arm', tiny, { kind: 'capsule', diameterCm: 1.2, heightCm: 2 }, '手臂'),
    ]);
    const v = validate(c);
    assert.eq(v.ok, true, `小件不应触发 R11：${allTexts(v).join(' | ')}`);
    assert.ok(!(v.errors || []).some((e) => /R11/.test(e)));
  });

  h.section('R. assessIdentity 还原度自检');

  h.it('引擎导出 assessIdentity 与可钩性常数', () => {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    assert.eq(typeof ctx.engine.E.assessIdentity, 'function', '必须导出 assessIdentity');
    assert.eq(ctx.engine.E.CRAFT_FLOOR_HARD, 18);
    assert.eq(ctx.engine.E.CRAFT_FLOOR_SOFT, 24);
  });

  h.it('assessIdentity：软糖底模预设齐备', () => {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    const E = ctx.engine.E;
    const p = path.join(ctx.ROOT, 'characters', '_presets', 'softcandy-chibi.toyspec.json');
    const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
    const r = E.assessIdentity(spec);
    assert.eq(r.ok, true, `底模应齐备：${JSON.stringify(r.missing)} / ${JSON.stringify(r.notes)}`);
    assert.ok(r.score >= 90, `得分应 ≥ 90，实际 ${r.score}`);
  });

  h.it('assessIdentity：缺 hair/eye role → ok===false', () => {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    const E = ctx.engine.E;
    const r = E.assessIdentity({
      name: '残缺',
      heightCm: 14,
      style: 'chibi',
      palette: [
        { id: 'C1', hex: '#F5E6D8', role: 'skin' },
        { id: 'C3', hex: '#3D6B9A', role: 'main' },
      ],
      parts: [
        { id: 'head', shape: { kind: 'sphere', diameterCm: 6.5 } },
        { id: 'body', shape: { kind: 'capsule', diameterCm: 3.5, heightCm: 4 } },
      ],
    });
    assert.eq(r.ok, false);
    assert.ok(r.missing.includes('role-hair'));
    assert.ok(r.missing.includes('role-eye'));
    assert.ok(r.missing.includes('part-hair'));
    assert.ok(r.missing.includes('part-eye'));
  });

  h.section('R. layoutPartMap 部件对照热区');

  h.it('layoutPartMap 为软糖底模生成覆盖全部部件的 regions', () => {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    const E = ctx.engine.E;
    const p = path.join(ctx.ROOT, 'characters', '_presets', 'softcandy-chibi.toyspec.json');
    const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
    const chart = E.buildChart(spec);
    assert.ok(chart.reference && Array.isArray(chart.reference.regions), 'buildChart 应写入 reference.regions');
    const ids = chart.reference.regions.map((r) => r.partId).sort();
    const expected = chart.parts.map((x) => x.id).sort();
    assert.deepEq(ids, expected, '每个部件都应有热区');
    assert.ok(chart.reference.regions.every((r) => r.shape === 'ellipse' && r.cx != null),
      '热区应为带 cx/cy 的椭圆');
  });

  h.it('resolveReference：用户自定义 regions 优先', () => {
    if (!ctx.engine.ok) throw new Error(`引擎不可加载: ${ctx.engine.reason}`);
    const E = ctx.engine.E;
    const custom = [{ partId: 'head', name: '头', shape: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4 }];
    const ref = E.resolveReference(
      { parts: [{ id: 'head', name: '头' }, { id: 'body', name: '身' }], palette: [] },
      { caption: '自定义', regions: custom },
    );
    assert.eq(ref.regions.length, 1);
    assert.eq(ref.regions[0].cx, 1);
    assert.eq(ref.caption, '自定义');
  });
}
