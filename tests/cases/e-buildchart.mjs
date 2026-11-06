// E. buildChart 端到端（契约 §3.5）；F. yarnEstimate（§3.6）
import { assert } from '../lib/harness.mjs';

export function register(h, ctx) {
  h.section('E. buildChart 端到端（5 部件 toySpec）');

  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };

  let built = null;
  let spec = null;

  h.it('前置：读取 5 部件 toySpec fixture', () => {
    spec = ctx.readJson(ctx.fixtures('toyspec-5part.json'));
    assert.isObj(spec, 'toyspec-5part.json 必须可解析');
    assert.eq(spec.parts.length, 5, 'fixture 必须是 5 部件');
  });

  h.it('buildChart 不抛异常并返回 chart 对象', () => {
    const E = requireEngine();
    assert.isObj(spec, '前置 toySpec 未加载');
    built = assert.noThrow(() => E.buildChart(spec), 'buildChart(toySpec) 抛异常（契约要求：ok===false 时不抛，带出错误）');
    assert.isObj(built, 'buildChart 必须返回 chart 对象');
  });

  h.it('chart 基本结构：version/name/spec/gauge/palette/parts', () => {
    assert.isObj(built, 'buildChart 未产出');
    assert.hasKeys(built, ['version', 'name', 'createdAt', 'spec', 'gauge', 'palette', 'parts', 'yarn', 'validation'], 'chart 缺字段（契约 §2.1）');
    assert.eq(built.version, 1, 'chart.version 应为 1');
    assert.isStr(built.name, 'chart.name 必须是字符串');
    assert.isArr(built.parts, 'chart.parts 必须是数组');
  });

  h.it('chart.spec 原样内嵌 toySpec（便于复现）', () => {
    assert.isObj(built, 'buildChart 未产出');
    assert.isObj(built.spec, 'chart.spec 必须存在（契约 §2.1：toySpec 原样内嵌）');
    assert.eq(built.spec.name, spec.name, 'chart.spec.name 应与输入一致');
    assert.eq(built.spec.heightCm, spec.heightCm, 'chart.spec.heightCm 应与输入一致');
  });

  h.it('chart.validation.ok === true（5 部件图必须自洽）', () => {
    assert.isObj(built, 'buildChart 未产出');
    assert.isObj(built.validation, 'chart.validation 必须存在');
    const errs = (built.validation.errors || []).concat(...(built.validation.parts || []).map((p) => p.errors || []));
    assert.eq(built.validation.ok, true,
      `5 部件 toySpec 生成的图必须自洽。错误:\n  ${errs.join('\n  ') || JSON.stringify(built.validation.errors)}`);
  });

  h.it('总圈数 > 30', () => {
    assert.isObj(built, 'buildChart 未产出');
    const total = built.parts.reduce((s, p) => s + p.rounds.length, 0);
    assert.gte(total, 31, `总圈数应 > 30，实际 ${total}`);
  });

  h.it('yarn.total.meters 落在 15–70 区间', () => {
    assert.isObj(built, 'buildChart 未产出');
    assert.isObj(built.yarn, 'chart.yarn 必须存在（契约 §3.5）');
    assert.isObj(built.yarn.total, 'yarn.total 必须存在');
    assert.between(built.yarn.total.meters, 15, 70,
      `14cm chibi 五件套的用线量应在 15–70 米，实际 ${built.yarn.total.meters}`);
  });

  h.it('5 个部件 id 全部出现且顺序保持', () => {
    assert.isObj(built, 'buildChart 未产出');
    const ids = built.parts.map((p) => p.id);
    for (const want of ['head', 'body', 'armL', 'armR', 'leg']) {
      assert.includes(ids, want, `chart.parts 缺少部件 "${want}"，实际: ${ids.join(', ')}`);
    }
    assert.deepEq(ids.slice(0, 5), ['head', 'body', 'armL', 'armR', 'leg'], '部件顺序必须与 toySpec 一致');
  });

  h.it('每部件含 shape/rounds/subtotal', () => {
    assert.isObj(built, 'buildChart 未产出');
    for (const p of built.parts) {
      assert.hasKeys(p, ['id', 'name', 'shape', 'rounds', 'subtotal'], `部件 ${p && p.id} 缺字段（契约 §2.2）`);
      assert.ok(p.rounds.length > 0, `部件 ${p.id} 的 rounds 不能为空`);
      assert.isNum(p.subtotal.stitches, `部件 ${p.id}.subtotal.stitches 必须是数字`);
      assert.eq(p.subtotal.rounds, p.rounds.length, `部件 ${p.id}.subtotal.rounds 应等于实际圈数`);
    }
  });

  h.it('colorRounds 生效：head 第 1–6 圈为 C1', () => {
    assert.isObj(built, 'buildChart 未产出');
    const head = built.parts.find((p) => p.id === 'head');
    assert.isObj(head, '未找到 head 部件');
    for (const r of head.rounds.slice(0, 6)) {
      assert.eq(r.color, 'C1', `head R${r.r} 应为 C1（colorRounds 1–6），实际 ${r.color}`);
    }
  });

  h.it('buildChart 内部调用 validateChart（validation.parts 与 parts 一一对应）', () => {
    assert.isObj(built, 'buildChart 未产出');
    assert.eq(built.validation.parts.length, built.parts.length,
      'validation.parts 数量应等于 chart.parts 数量');
    const vIds = built.validation.parts.map((p) => p.id);
    const cIds = built.parts.map((p) => p.id);
    assert.deepEq(vIds, cIds, 'validation.parts 的 id 与顺序应与 chart.parts 一致');
  });

  h.it('异常输入不抛异常：空 parts 也要返回 chart（带出错误）', () => {
    const E = requireEngine();
    const broken = { name: '空图', heightCm: 10, style: 'chibi', parts: [] };
    const r = assert.noThrow(() => E.buildChart(broken), 'buildChart 对空 parts 抛异常（契约要求不抛）');
    assert.isObj(r, 'buildChart 对异常输入也应返回 chart 对象');
  });

  /* ─────────────── F. yarnEstimate ─────────────── */
  h.section('F. yarnEstimate 用线量（契约 §3.6）');

  h.it('perPart 合计 === total', () => {
    const E = requireEngine();
    assert.isObj(built, '前置 chart 未产出');
    const y = assert.noThrow(() => E.yarnEstimate(built), 'yarnEstimate 抛异常');
    assert.isObj(y, 'yarnEstimate 必须返回对象');
    // 针数必须精确一致
    const sumStitches = y.perPart.reduce((s, p) => s + p.stitches, 0);
    assert.eq(sumStitches, y.total.stitches, `perPart 针数合计 ${sumStitches} 应等于 total.stitches ${y.total.stitches}`);
    // 米数：各项已四舍五入到 1 位小数，逐项舍入误差最多 0.05/项
    const sumMeters = y.perPart.reduce((s, p) => s + p.meters, 0);
    const tol = 0.05 * y.perPart.length + 0.001;
    assert.approx(sumMeters, y.total.meters, tol,
      `perPart 米数合计 ${sumMeters.toFixed(2)} 应等于 total.meters ${y.total.meters}`
      + `（容差 ${tol.toFixed(2)} = ${y.perPart.length} 项 × 0.05 舍入误差）`);
  });

  h.it('withBuffer.meters === total.meters × 1.25（1 位小数）', () => {
    const E = requireEngine();
    assert.isObj(built, '前置 chart 未产出');
    const y = E.yarnEstimate(built);
    const expect = Math.round(y.total.meters * 1.25 * 10) / 10;
    assert.eq(y.withBuffer.meters, expect,
      `默认 bufferRatio 0.25：withBuffer.meters 应为 round(total.meters×1.25, 1) = ${expect}`);
    assert.eq(y.bufferRatio, 0.25, 'bufferRatio 默认应为 0.25（契约 §6）');
  });

  h.it('total.meters ≈ total.stitches × 0.025（1 位小数舍入容差）', () => {
    const E = requireEngine();
    const y = E.yarnEstimate(built);
    const exact = y.total.stitches * 0.025;
    // 引擎可按「逐部件舍入后求和」或「先求和再舍入」两种口径，差异累积于部件数
    const tol = 0.05 * y.perPart.length + 0.001;
    assert.approx(y.total.meters, exact, tol,
      `total.meters 应 ≈ ${y.total.stitches} 针 × 0.025 = ${exact.toFixed(3)}（容差 ${tol.toFixed(2)}）`);
    assert.eq(y.constants.metersPerStitch, 0.025, 'constants.metersPerStitch 默认应为 0.025');
  });

  h.it('grams ≈ meters / yarnMetersPerGram（默认 4.2）', () => {
    const E = requireEngine();
    const y = E.yarnEstimate(built);
    const expect = y.total.meters / 4.2;
    const tol = 0.05 * y.perPart.length + 0.05;
    assert.approx(y.total.grams, expect, tol,
      `grams 应 ≈ total.meters/4.2 = ${expect.toFixed(3)}（容差 ${tol.toFixed(2)}）`);
  });

  h.it('opts.metersPerStitch 可覆盖', () => {
    const E = requireEngine();
    const y = E.yarnEstimate(built, { metersPerStitch: 0.05 });
    const expect = Math.round(y.total.stitches * 0.05 * 10) / 10;
    assert.eq(y.total.meters, expect, `opts.metersPerStitch=0.05 时应为 ${expect} 米，实际 ${y.total.meters}`);
    assert.eq(y.constants.metersPerStitch, 0.05, 'constants.metersPerStitch 应反映 opts 覆盖值');
  });

  h.it('perColor 覆盖所有用到的配色', () => {
    const E = requireEngine();
    const y = E.yarnEstimate(built);
    assert.isArr(y.perColor, 'perColor 必须是数组');
    const used = new Set();
    for (const p of built.parts) for (const r of p.rounds) used.add(r.color);
    const got = new Set(y.perColor.map((c) => c.color));
    const missing = [...used].filter((c) => !got.has(c));
    assert.eq(missing.length, 0, `perColor 缺少配色: ${missing.join(', ')}`);
  });

  h.it('所有数值四舍五入到 1 位小数', () => {
    const E = requireEngine();
    const y = E.yarnEstimate(built);
    const is1dp = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
    for (const p of y.perPart) assert.ok(is1dp(p.meters), `perPart ${p.id}.meters=${p.meters} 不是 1 位小数`);
    assert.ok(is1dp(y.total.meters), `total.meters=${y.total.meters} 不是 1 位小数`);
    assert.ok(is1dp(y.total.grams), `total.grams=${y.total.grams} 不是 1 位小数`);
    assert.ok(is1dp(y.withBuffer.meters), `withBuffer.meters=${y.withBuffer.meters} 不是 1 位小数`);
  });
}
