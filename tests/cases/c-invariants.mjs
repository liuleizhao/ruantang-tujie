// C. validateChart 七条不变量 R1–R7：每条一个正例 + 一个人造反例
import { assert, mentionsRound, mentionsRule } from '../lib/harness.mjs';
import * as B from '../lib/builders.mjs';

export function register(h, ctx) {
  h.section('C. validateChart 不变量 R1–R7（正例 + 反例）');

  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };
  const validate = (c) => {
    const E = requireEngine();
    return assert.noThrow(() => E.validateChart(c), 'validateChart 抛出异常（应返回 Validation 对象）');
  };

  /* ── 公共正例 ── */
  h.it('前置：最小合格图 ok===true（后续正例都基于它）', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `应通过，实际错误: ${JSON.stringify(v.errors)}`);
    assert.deepEq(v.errors, [], '通过时 errors 必须为空数组');
  });

  /* ── R1 环内守恒 ── */
  h.it('R1 正例：ops 消耗 === stitchesIn', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R1 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R1 反例：第 3 圈 ops 消耗 13 ≠ stitchesIn 12 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[2].ops = [{ sym: 'X', n: 13 }];
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R1 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
    // 允许引擎用 R1 标注，也允许只描述「消耗不符」；两者取其一即可，但必须是「消耗」语义
    assert.ok(
      texts.some((t) => /消耗|consume|R1/i.test(t)) || mentionsRule(texts, 'R1'),
      `错误信息应指出消耗/守恒问题，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── R2 产出正确 ── */
  h.it('R2 正例：ops 产出 === stitchesOut', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R2 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R2 反例：第 3 圈 11X+1SL 消耗 12（R1 过）但产出 11 ≠ stitchesOut 12', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[2].ops = [{ sym: 'X', n: 11 }, { sym: 'SL', n: 1 }];
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R2 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /产出|produce|R2/i.test(t)) || mentionsRule(texts, 'R2'),
      `错误信息应指出产出问题，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── R3 衔接守恒 ── */
  h.it('R3 正例：第 i 圈 stitchesIn === 第 i-1 圈 stitchesOut', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R3 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R3 反例：第 3 圈 stitchesIn 写 11，上一圈产出 12 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[2].stitchesIn = 11;
      // 让 R1/R2 仍自洽：为避免只测到 R1，把 ops 也改成 11X 并保持 stitchesOut=11
      c.parts[0].rounds[2].ops = [{ sym: 'X', n: 11 }];
      c.parts[0].rounds[2].stitchesOut = 11;
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R3 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /衔接|上一圈|连续|chain|R3/i.test(t)) || mentionsRule(texts, 'R3'),
      `错误信息应指出衔接问题，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── R4 起针 ── */
  h.it('R4 正例：第 1 圈 magic-ring 且 stitchesIn===0', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R4 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R4 反例：第 1 圈 kind=magic-ring 却声明 stitchesIn=6 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[0].stitchesIn = 6;
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R4 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 1), `错误信息应含圈号 1，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /起针|magic|环形|R4/i.test(t)) || mentionsRule(texts, 'R4'),
      `错误信息应指出起针问题，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── R5 增减一致 ── */
  h.it('R5 正例：36 → 48 由 12 个 V 解释（delta +12 === #V）', () => {
    // (2X,V)×12 = 24X + 12V → 消耗 24+12=36 ✓，产出 24+24=48 ✓，delta +12 = #V ✓
    const rounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 36, ops: [{ sym: 'X', n: 36 }] }),
      B.round(2, {
        stitchesIn: 36, stitchesOut: 48,
        ops: [{ sym: 'X', n: 24 }, { sym: 'V', n: 12 }],
      }),
    ];
    const c = B.chart([B.part('p', rounds, { kind: 'cylinder', diameterCm: 5, heightCm: 2 })]);
    const v = validate(c);
    assert.eq(v.ok, true, `R5 正例应通过，实际: ${JSON.stringify(B.allTexts(v))}`);
  });

  h.it('R5 正例：CH/SL 参与时不误报（起立与引拔）', () => {
    // 18 → 18：17X + 1CH（产出 18），消耗 17 ≠ 18 会触发 R1...
    // 正确写法：整圈 18X 用 CH 起立 + 18X + SL？会产生 17 产出。
    // 这里测「delta 由 CH/SL 解释」的合法构造：18X + 1SL → 消耗 19 不等于 18。
    // 因此用最贴近契约注释的构造：CH 起立不计消耗、SL 收口不计产出，各自落在 R5 的加减项里。
    const rounds = [
      B.round(1, { kind: 'magic-ring', stitchesIn: 0, stitchesOut: 18, ops: [{ sym: 'X', n: 18 }] }),
      // 18 针上钩 17X + 1CH + 1SL：消耗 17+1=18 ✓，产出 17+1+0=18 ✓，delta 0，
      // 平衡 = #CH(1) - #SL(1) = 0 ✓
      B.round(2, {
        stitchesIn: 18, stitchesOut: 18,
        ops: [{ sym: 'X', n: 17 }, { sym: 'CH', n: 1 }, { sym: 'SL', n: 1 }],
      }),
    ];
    const c = B.chart([B.part('p', rounds, { kind: 'cylinder', diameterCm: 5, heightCm: 2 })]);
    const v = validate(c);
    assert.eq(v.ok, true, `CH/SL 参与的圈不应误报，实际: ${JSON.stringify(B.allTexts(v))}`);
  });

  h.it('R5 反例：第 3 圈 12→18 但 ops 只有 12X（无增针）→ 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      // stitchesIn 12, stitchesOut 18 => delta +6；ops 12X => 平衡 0
      c.parts[0].rounds[2].stitchesIn = 12;
      c.parts[0].rounds[2].stitchesOut = 18;
      c.parts[0].rounds[2].ops = [{ sym: 'X', n: 12 }];
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R5 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /增减|差值|R5/i.test(t)) || mentionsRule(texts, 'R5'),
      `错误信息应指出增减不一致，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── R6 配色合法 ── */
  h.it('R6 正例：所有 color 都在 palette 中', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R6 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R6 反例：第 2 圈 color="C9" 不在 palette → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[1].color = 'C9';
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R6 反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 2), `错误信息应含圈号 2，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /配色|color|C9|R6/i.test(t)),
      `错误信息应指出配色非法，实际: ${JSON.stringify(texts)}`,
    );
  });

  h.it('R6 colorChanges 统计正确（相邻圈配色变化次数）', () => {
    // 4 圈：C3 C3 C1 C1 → 变化 1 次
    const c = B.mutate(B.minimalValidChart(), (x) => {
      x.parts[0].rounds[2].color = 'C1';
      x.parts[0].rounds[3].color = 'C1';
    });
    const v = validate(c);
    assert.eq(v.ok, true, `本用例应通过，实际: ${JSON.stringify(v.errors)}`);
    assert.isObj(v.summary, 'validation.summary 必须存在');
    assert.eq(v.summary.colorChanges, 1, 'C3→C3→C1→C1 的相邻变化应为 1 次');
  });

  /* ── R7 可钩性 ── */
  h.it('R7 正例：所有 stitchesOut 为 6..200 之间的整数', () => {
    const v = validate(B.minimalValidChart());
    assert.eq(v.ok, true, `R7 正例应通过，实际: ${JSON.stringify(v.errors)}`);
  });

  h.it('R7 反例（上限）：第 2 圈 stitchesOut=240 > 200 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[1].stitchesOut = 240;
      c.parts[0].rounds[1].ops = [{ sym: 'X', n: 6 }, { sym: 'V', n: 117 }];
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R7 上限反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 2), `错误信息应含圈号 2，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /200|上限|可钩|R7/i.test(t)) || mentionsRule(texts, 'R7'),
      `错误信息应指出超上限，实际: ${JSON.stringify(texts)}`,
    );
  });

  h.it('R7 反例（非整数）：第 3 圈 stitchesOut=12.5 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      c.parts[0].rounds[2].stitchesOut = 12.5;
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R7 非整数反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
  });

  h.it('R7 反例（下限）：非收口圈 stitchesOut=4 < 5 → 必须被抓到', () => {
    const bad = B.mutate(B.minimalValidChart(), (c) => {
      const last = c.parts[0].rounds[c.parts[0].rounds.length - 1];
      // 让中间圈（非最后一圈）降到 4：12 → 4，4 个 A 消耗 8，需要 stitchesIn 8
      c.parts[0].rounds[2] = B.round(3, {
        stitchesIn: 8, stitchesOut: 4, ops: [{ sym: 'A', n: 4 }],
      });
      // 修掉由此产生的 R3（第 2 圈产出 12 → 第 3 圈 stitchesIn 8）不成立：
      // 改为把第 2 圈产出也调到 8，使 R3 通过，只剩 R7 违规。
      c.parts[0].rounds[1].stitchesOut = 8;
      c.parts[0].rounds[1].ops = [{ sym: 'V', n: 2 }, { sym: 'X', n: 4 }]; // 消耗 6, 产出 8
      void last;
    });
    const v = validate(bad);
    assert.eq(v.ok, false, 'R7 下限反例必须 ok===false');
    const texts = B.allTexts(v);
    assert.ok(mentionsRound(texts, 3), `错误信息应含圈号 3，实际: ${JSON.stringify(texts)}`);
    assert.ok(
      texts.some((t) => /下限|< ?[56]|至少 ?[56]|可钩|R7/i.test(t)) || mentionsRule(texts, 'R7'),
      `错误信息应指出低于下限，实际: ${JSON.stringify(texts)}`,
    );
  });

  /* ── 返回值结构 ── */
  h.it('Validation 结构：含 ok/errors/parts[].rounds[]/summary', () => {
    const v = validate(B.minimalValidChart());
    assert.hasKeys(v, ['ok', 'errors', 'parts', 'summary'], 'Validation 缺字段（契约 §3.2）');
    assert.isArr(v.errors, 'errors 必须是数组');
    assert.isArr(v.parts, 'parts 必须是数组');
    const p = v.parts[0];
    assert.hasKeys(p, ['id', 'ok', 'errors', 'rounds'], 'parts[0] 缺字段');
    const r1 = p.rounds[0];
    assert.hasKeys(r1, ['r', 'consumed', 'declaredIn', 'produced', 'delta', 'ok', 'errors'], 'rounds[0] 缺字段（契约 §3.2）');
    assert.hasKeys(v.summary, ['parts', 'rounds', 'totalStitches', 'colorChanges'], 'summary 缺字段');
  });

  h.it('Validation 逐圈数值正确（起针圈 declaredIn=0 / produced=6 / delta=6）', () => {
    const v = validate(B.minimalValidChart());
    const r1 = v.parts[0].rounds[0];
    // 契约 §3.2 的示例写 consumed:0，但 §2.3 的 magic-ring 样例 ops 为 [{X,6}]（字面消耗 6）。
    // 契约在此自相矛盾（已报告 lead），故 consumed 接受 0（按 §3.2 示例）或 6（按 ops 实算）。
    assert.ok(r1.consumed === 0 || r1.consumed === 6,
      `起针圈 consumed 应为 0（契约 §3.2 示例）或 6（按 ops 实算），实际 ${r1.consumed}`);
    assert.eq(r1.declaredIn, 0, '起针圈 declaredIn 应为 0');
    assert.eq(r1.produced, 6, '起针圈 produced 应为 6');
    assert.eq(r1.delta, 6, '起针圈 delta 应为 6');
  });
}
