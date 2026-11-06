// v1.1 增补：L. R8 装饰针迹 / M. R9 半针留针 / N. attachTo 起针
// O. validateChart 返回值结构 / P. chart.buildOrder
import { assert, mentionsRound } from '../lib/harness.mjs';
import * as B from '../lib/builders.mjs';

export function register(h, ctx) {
  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };
  const validate = (c) => {
    const E = requireEngine();
    return assert.noThrow(() => E.validateChart(c), 'validateChart 抛出异常（契约要求返回 Validation 对象，不抛）');
  };
  const allTexts = B.allTexts;

  /** 造一个 36 针的 4 圈部件（6→12→24→36） */
  const part36 = (lastExtra = {}) => {
    const rounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 24, ops: [{ sym: 'V', n: 12 }] }),
      B.round(4, { stitchesIn: 24, stitchesOut: 36, ops: [{ sym: 'X', n: 12 }, { sym: 'V', n: 12 }], ...lastExtra }),
    ];
    return rounds;
  };

  /* ─────────────── L. R8 装饰针迹 ─────────────── */
  h.section('L. R8 装饰针迹校验（契约 §5b.1）');

  h.it('R8 正例：count 18 × every 2 === stitchesOut 36 → ok===true', () => {
    const rounds = part36({ decor: [{ kind: 'curly', every: 2, count: 18, ch: 6 }] });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    const errs = allTexts(v);
    assert.eq(v.ok, true, `R8 正例应通过，实际错误:\n  ${errs.join('\n  ')}`);
  });

  h.it('R8 反例：count 17 × every 2 = 34 ≠ 36 → 必须报错且含圈号', () => {
    const rounds = part36({ decor: [{ kind: 'curly', every: 2, count: 17, ch: 6 }] });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, false, 'R8 反例必须 ok===false');
    const errs = allTexts(v);
    assert.ok(mentionsRound(errs, 4), `错误信息应含圈号 4，实际: ${JSON.stringify(errs)}`);
    assert.ok(errs.some((t) => /装饰|decor|R8|不匹配|34|17/i.test(t)),
      `错误信息应指出装饰针迹数量问题，实际: ${JSON.stringify(errs)}`);
  });

  h.it('R8：decor 不参与 R1/R2/R5 针数守恒（加了 decor 仍通过）', () => {
    const withDecor = part36({ decor: [{ kind: 'bobble', every: 1, count: 36 }] });
    const c = B.chart([B.part('body', withDecor, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, true, `decor 不应影响针数守恒，实际错误: ${allTexts(v).join(' | ')}`);
  });

  h.it('R8：多段 decor 分别校验（一段合法一段非法 → 报错）', () => {
    const rounds = part36({
      decor: [
        { kind: 'curly', every: 2, count: 18, ch: 6 },  // 18×2=36 ✓
        { kind: 'bobble', every: 4, count: 8 },          // 8×4=32 ✗
      ],
    });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, false, '含非法 decor 段时必须 ok===false');
    assert.ok(mentionsRound(allTexts(v), 4), `错误信息应含圈号 4，实际: ${JSON.stringify(allTexts(v))}`);
  });

  h.it('R8：fixture decor-good-chart.json → ok===true', () => {
    const c = ctx.readJson(ctx.fixtures('decor-good-chart.json'));
    const v = validate(c);
    assert.eq(v.ok, true, `decor-good-chart.json 应通过，实际: ${allTexts(v).join(' | ')}`);
  });

  h.it('R8：fixture bad-r8-decor.json → ok===false 且含圈号 5', () => {
    const c = ctx.readJson(ctx.fixtures('bad-charts', 'bad-r8-decor.json'));
    const v = validate(c);
    assert.eq(v.ok, false, 'bad-r8-decor.json 必须 ok===false');
    assert.ok(mentionsRound(allTexts(v), 5), `错误信息应含圈号 5，实际: ${JSON.stringify(allTexts(v))}`);
  });

  h.it('R8：toNotation 在带 decor 的圈行尾附加标注', () => {
    const E = requireEngine();
    const rounds = part36({ decor: [{ kind: 'curly', every: 2, count: 18, ch: 6 }] });
    const p = B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体');
    const lines = assert.noThrow(() => E.toNotation(p), 'toNotation 抛异常');
    assert.isArr(lines, 'toNotation 必须返回字符串数组');
    const last = lines[lines.length - 1];
    assert.ok(/⟡|装饰|卷曲|decor|18\s*[×x*]\s*卷曲/.test(last),
      `带 decor 的圈行尾应有标注（如 "⟡ 18×卷曲针(6CH)"），实际: "${last}"`);
  });

  /* ─────────────── M. R9 半针留针警告 ─────────────── */
  h.section('M. R9 半针留针警告（契约 §5b.2，警告不影响 ok）');

  h.it('R9：blo 圈无人接且无 reservedFor → warnings 非空但 ok===true', () => {
    const rounds = part36({ loop: 'blo' });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, true, 'R9 只是警告，不能影响 ok。实际错误: ' + allTexts(v).join(' | '));
    assert.isArr(v.warnings, 'validateChart 必须返回 warnings 数组（契约 §5b.3）');
    assert.ok(v.warnings.length > 0, '无人接的半针留针必须产生警告，实际 warnings 为空');
    assert.ok(mentionsRound(v.warnings, 4) || v.warnings.some((w) => /留针|半针|blo/i.test(w)),
      `警告应点名该圈或留针问题，实际: ${JSON.stringify(v.warnings)}`);
  });

  h.it('R9：reservedFor="hem" 且 hem 通过 attachTo 接上 → warnings 为空', () => {
    const bodyRounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 24, ops: [{ sym: 'V', n: 12 }] }),
      B.round(4, {
        stitchesIn: 24, stitchesOut: 36, ops: [{ sym: 'X', n: 12 }, { sym: 'V', n: 12 }],
        loop: 'blo', reservedFor: 'hem',
      }),
    ];
    const body = B.part('body', bodyRounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体');
    const hem = B.part('hem', [
      B.round(1, { kind: 'attach', stitchesIn: 36, stitchesOut: 48, ops: [{ sym: 'X', n: 24 }, { sym: 'V', n: 12 }] }),
    ], { kind: 'flat-round', diameterCm: 5, attachTo: { part: 'body', round: 4, loop: 'flo', stitches: 36 } }, '荷叶边');
    const v = validate(B.chart([body, hem]));
    assert.eq(v.ok, true, `attach 合成图应通过，实际错误: ${allTexts(v).join(' | ')}`);
    assert.deepEq(v.warnings, [], `attachTo 已接上留针时不应有警告，实际: ${JSON.stringify(v.warnings)}`);
  });

  h.it('R9：reservedFor=null 显式声明「留针但不用」→ 不告警', () => {
    const rounds = part36({ loop: 'flo', reservedFor: null });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, true, `reservedFor:null 应通过，实际: ${allTexts(v).join(' | ')}`);
    assert.deepEq(v.warnings, [], `reservedFor:null 表示显式不用，不应告警，实际: ${JSON.stringify(v.warnings)}`);
  });

  h.it('R9：fixture loop-warn-chart.json（ok=true 且 warnings 非空）', () => {
    const c = ctx.readJson(ctx.fixtures('loop-warn-chart.json'));
    const v = validate(c);
    assert.eq(v.ok, true, 'R9 警告不影响 ok');
    assert.ok((v.warnings || []).length > 0, '该 fixture 应产生警告');
  });

  h.it('R9：fixture loop-clean-chart.json / loop-null-chart.json（无警告）', () => {
    for (const f of ['loop-clean-chart.json', 'loop-null-chart.json']) {
      const c = ctx.readJson(ctx.fixtures(f));
      const v = validate(c);
      assert.eq(v.ok, true, `${f} 应通过，实际: ${allTexts(v).join(' | ')}`);
      assert.deepEq(v.warnings || [], [], `${f} 不应有警告，实际: ${JSON.stringify(v.warnings)}`);
    }
  });

  /* ─────────────── N. attachTo 起针 ─────────────── */
  h.section('N. attachTo 起针（契约 §5b.2）');

  h.it('attachTo 部件第 1 圈 kind==="attach" 且 stitchesIn===30（不是 0）', () => {
    const E = requireEngine();
    const bodyRounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }] }),
      B.round(2, { stitchesIn: 6, stitchesOut: 12, ops: [{ sym: 'V', n: 6 }] }),
      B.round(3, { stitchesIn: 12, stitchesOut: 18, ops: [{ sym: 'X', n: 6 }, { sym: 'V', n: 6 }] }),
      B.round(4, { stitchesIn: 18, stitchesOut: 24, ops: [{ sym: 'X', n: 12 }, { sym: 'V', n: 6 }] }),
      B.round(5, { stitchesIn: 24, stitchesOut: 30, ops: [{ sym: 'X', n: 18 }, { sym: 'V', n: 6 }] }),
      B.round(6, {
        stitchesIn: 30, stitchesOut: 30, ops: [{ sym: 'X', n: 30 }],
        loop: 'blo', reservedFor: 'hem',
      }),
    ];
    const shape = { kind: 'capsule', diameterCm: 5, heightCm: 7 };
    const body = B.part('body', bodyRounds, shape, '身体');
    // 用 buildShape 带 attachTo 生成 hem
    const hemShape = {
      kind: 'flat-round', diameterCm: 4.3,
      attachTo: { part: 'body', round: 6, loop: 'flo', stitches: 30 },
    };
    const res = assert.noThrow(() => E.buildShape(hemShape, { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5 }),
      'buildShape 对含 attachTo 的形状抛异常（契约 §5b.2 要求支持接留针起针）');
    assert.isArr(res.rounds, 'buildShape(...).rounds 必须是数组');
    assert.ok(res.rounds.length > 0, 'attachTo 形状不能生成空 rounds');
    const r1 = res.rounds[0];
    assert.eq(r1.kind, 'attach', `attachTo 部件第 1 圈 kind 应为 "attach"，实际 "${r1.kind}"`);
    assert.eq(r1.stitchesIn, 30, `attachTo 部件第 1 圈 stitchesIn 应为 30（不是 0），实际 ${r1.stitchesIn}`);
  });

  h.it('attach 圈不触发 R4 起针误报', () => {
    const bodyRounds = part36({ loop: 'blo', reservedFor: 'hem' });
    const body = B.part('body', bodyRounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体');
    const hem = B.part('hem', [
      B.round(1, { kind: 'attach', stitchesIn: 36, stitchesOut: 36, ops: [{ sym: 'X', n: 36 }] }),
    ], { kind: 'flat-round', diameterCm: 5, attachTo: { part: 'body', round: 4, loop: 'flo', stitches: 36 } }, '荷叶边');
    const v = validate(B.chart([body, hem]));
    const errs = allTexts(v);
    assert.eq(v.ok, true, `attach 起针不应被判为 R4 违规，实际错误:\n  ${errs.join('\n  ')}`);
    assert.ok(!errs.some((e) => /R4/.test(e)), `不应出现 R4 错误，实际: ${JSON.stringify(errs)}`);
  });

  h.it('attachTo.stitches 与实际不符 → 应报错', () => {
    const bodyRounds = part36({ loop: 'blo', reservedFor: 'hem' });
    const body = B.part('body', bodyRounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体');
    const hem = B.part('hem', [
      // 声明接 30 针，实际 stitchesIn 36
      B.round(1, { kind: 'attach', stitchesIn: 36, stitchesOut: 36, ops: [{ sym: 'X', n: 36 }] }),
    ], { kind: 'flat-round', diameterCm: 5, attachTo: { part: 'body', round: 4, loop: 'flo', stitches: 30 } }, '荷叶边');
    const v = validate(B.chart([body, hem]));
    assert.eq(v.ok, false,
      `attachTo.stitches=30 但实际起针 36，应报错。实际: ${JSON.stringify(allTexts(v))}`);
  });

  /* ─────────────── O. 返回值结构增补 ─────────────── */
  h.section('O. validateChart 返回值结构增补（契约 §5b.3）');

  h.it('必须含 warnings: []（数组）', () => {
    const v = validate(B.minimalValidChart());
    assert.hasKeys(v, ['warnings'], 'Validation 必须含 warnings 字段（契约 §5b.3）');
    assert.isArr(v.warnings, 'warnings 必须是数组');
  });

  h.it('summary 必须含 decorCount 与 reservedLoops', () => {
    const v = validate(B.minimalValidChart());
    assert.hasKeys(v.summary, ['decorCount', 'reservedLoops'],
      'summary 必须增补 decorCount 与 reservedLoops（契约 §5b.3）');
    assert.isNum(v.summary.decorCount, 'summary.decorCount 必须是数字');
    assert.isNum(v.summary.reservedLoops, 'summary.reservedLoops 必须是数字');
  });

  h.it('summary.decorCount 统计装饰针迹（段数或总个数，二者皆可）', () => {
    const rounds = part36({
      decor: [
        { kind: 'curly', every: 2, count: 18, ch: 6 },
        { kind: 'bobble', every: 1, count: 36 },
      ],
    });
    const c = B.chart([B.part('body', rounds, { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, '身体')]);
    const v = validate(c);
    assert.eq(v.ok, true, `本用例应通过，实际: ${allTexts(v).join(' | ')}`);
    // 契约 §5b.3 只规定 decorCount 字段存在，未定义「段数」还是「总个数」。
    // 两种口径都接受：2 段 / 18+36=54 个。
    assert.ok(v.summary.decorCount === 2 || v.summary.decorCount === 54,
      `decorCount 应为 decor 段数 2 或装饰针迹总个数 54，实际 ${v.summary.decorCount}`);
  });

  h.it('summary.decorCount 无 decor 时为 0', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.summary.decorCount, 0, `无 decor 时 decorCount 应为 0，实际 ${v.summary.decorCount}`);
  });

  h.it('summary.reservedLoops 统计正确（1 个 blo 圈 → 1）', () => {
    const c = ctx.readJson(ctx.fixtures('loop-clean-chart.json'));
    const v = validate(c);
    assert.eq(v.summary.reservedLoops, 1, `reservedLoops 应为 1，实际 ${v.summary.reservedLoops}`);
  });

  /* ─────────────── P. buildOrder ─────────────── */
  h.section('P. chart.buildOrder（契约 §5b.4）');

  h.it('buildChart 产出含非空字符串数组 buildOrder', () => {
    const E = requireEngine();
    const spec = ctx.readJson(ctx.fixtures('toyspec-5part.json'));
    const built = assert.noThrow(() => E.buildChart(spec), 'buildChart 抛异常');
    assert.hasKeys(built, ['buildOrder'], 'chart 必须含 buildOrder（契约 §5b.4）');
    assert.isArr(built.buildOrder, 'chart.buildOrder 必须是数组');
    assert.gte(built.buildOrder.length, 1, 'buildOrder 不能为空数组');
    for (const s of built.buildOrder) {
      assert.isStr(s, 'buildOrder 的每一项都必须是字符串');
      assert.gte(s.length, 2, `buildOrder 项过短: "${s}"`);
    }
  });

  h.it('toySpec 自带 buildOrder 时被采用', () => {
    const E = requireEngine();
    const spec = ctx.readJson(ctx.fixtures('toyspec-v11.json'));
    assert.isArr(spec.buildOrder, 'fixture toyspec-v11.json 应自带 buildOrder');
    const built = assert.noThrow(() => E.buildChart(spec), 'buildChart 抛异常');
    assert.deepEq(built.buildOrder, spec.buildOrder, 'toySpec 提供了 buildOrder 时应原样采用');
  });

  h.it('buildOrder 覆盖所有部件（每部件至少被提及一次）', () => {
    const E = requireEngine();
    const spec = ctx.readJson(ctx.fixtures('toyspec-5part.json'));
    const built = E.buildChart(spec);
    const text = (built.buildOrder || []).join(' ');
    const missing = built.parts.filter((p) => !text.includes(p.id) && !text.includes(p.name));
    assert.eq(missing.length, 0,
      `buildOrder 应覆盖所有部件，缺失: ${missing.map((p) => `${p.id}(${p.name})`).join(', ')}\n  实际: ${text}`);
  });

  h.it('带 attachTo 的图，buildOrder 提示接留针', () => {
    const E = requireEngine();
    const spec = ctx.readJson(ctx.fixtures('toyspec-v11.json'));
    const built = assert.noThrow(() => E.buildChart(spec), 'buildChart 抛异常');
    const text = (built.buildOrder || []).join(' ');
    assert.ok(/半针|留针|attach|接|荷叶/.test(text),
      `含 attachTo 的图，buildOrder 应提示接留针，实际: ${text}`);
  });
}
