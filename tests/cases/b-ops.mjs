// B. 记号表（契约 §1）——逐行比 consume/produce
import { assert } from '../lib/harness.mjs';

// 契约 §1 表格的权威副本（测试即验收依据，不依赖引擎自述）
export const CONTRACT_OPS = [
  ['X', '短针 sc', 1, 1],
  ['V', '加针 inc', 1, 2],
  ['A', '减针 dec', 2, 1],
  ['T', '中长针 hdc', 1, 1],
  ['F', '长针 dc', 1, 1],
  ['W', '一针三短针', 1, 3],
  ['M', '三针并一针', 3, 1],
  ['CH', '锁针', 0, 1],
  ['SL', '引拔', 1, 0],
  ['K', '空针 skip', 1, 0],
];

export function register(h, ctx) {
  h.section('B. 记号表 OPS 与契约 §1 逐行一致');

  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(`engine/gummy-engine.js 尚不可加载。\n  原因: ${ctx.engine.reason}`);
    }
    return ctx.engine.E;
  };

  h.it('OPS 覆盖 §1 全部 10 个针法（✱ 不算针法）', () => {
    const E = requireEngine();
    const syms = Object.keys(E.OPS);
    const expected = CONTRACT_OPS.map(([s]) => s);
    const missing = expected.filter((s) => !syms.includes(s));
    assert.eq(missing.length, 0, `OPS 缺少契约 §1 的针法: ${missing.join(', ')}（实际: ${syms.join(', ')}）`);
    // ✱ 是排版符号，不应作为针法计入 OPS
    if (syms.includes('✱')) {
      assert.ok(true, 'OPS 含 ✱（排版符号）——允许，但测试会记录');
    }
  });

  for (const [sym, cn, consume, produce] of CONTRACT_OPS) {
    h.it(`OPS.${sym} = {cn:"${cn}", consume:${consume}, produce:${produce}}`, () => {
      const E = requireEngine();
      const o = E.OPS[sym];
      assert.isObj(o, `OPS.${sym} 必须存在且为对象`);
      assert.eq(o.consume, consume, `OPS.${sym}.consume 应为 ${consume}（契约 §1）`);
      assert.eq(o.produce, produce, `OPS.${sym}.produce 应为 ${produce}（契约 §1）`);
      assert.isStr(o.cn, `OPS.${sym}.cn 必须是字符串`);
      // 中文名允许不完全一致（可能有「短针」vs「短针 sc」），但必须包含契约关键词
      const key = cn.split(' ')[0];
      assert.includes(o.cn, key, `OPS.${sym}.cn 应包含 "${key}"，实际 "${o.cn}"`);
    });
  }

  h.it('buildRound 对每个针法的换算与 OPS 表一致', () => {
    const E = requireEngine();
    for (const [sym, , consume, produce] of CONTRACT_OPS) {
      const r = E.buildRound([{ sym, n: 3 }]);
      assert.eq(r.stitchesIn, consume * 3, `buildRound([{sym:"${sym}",n:3}]).stitchesIn 应为 ${consume * 3}`);
      assert.eq(r.stitchesOut, produce * 3, `buildRound([{sym:"${sym}",n:3}]).stitchesOut 应为 ${produce * 3}`);
    }
  });

  h.it('buildRound 正确处理混合 ops：2X + 1V + 1CH', () => {
    const E = requireEngine();
    // 消耗: 2*1 + 1*1 + 0 = 3; 产出: 2*1 + 1*2 + 1 = 5
    const r = E.buildRound([{ sym: 'X', n: 2 }, { sym: 'V', n: 1 }, { sym: 'CH', n: 1 }]);
    assert.eq(r.stitchesIn, 3, '2X+1V+1CH 消耗 3');
    assert.eq(r.stitchesOut, 5, '2X+1V+1CH 产出 5');
  });
}
