// A. 引擎 API 存在性（契约 §3.1 / §3.2–§3.10）
import { assert } from '../lib/harness.mjs';

export const id = 'A';

export function register(h, ctx) {
  h.section('A. 引擎 API 存在性与类型（契约 §3）');

  // 统一跳过机制：没有引擎时以清晰的 AssertionError 说明缺失原因（计为失败，
  // 因为 engine/gummy-engine.js 是必交付项，不能被静默跳过）。
  const requireEngine = () => {
    if (!ctx.engine.ok) {
      throw new (class extends Error {})(
        `engine/gummy-engine.js 尚不可加载，无法验证本项。\n  原因: ${ctx.engine.reason}`,
      );
    }
    return ctx.engine.E;
  };

  const t = (name, fn) => h.it(name, () => fn(requireEngine()));

  t('VERSION 存在且为 "1.1.0"', (E) => {
    assert.isStr(E.VERSION, 'GummyEngine.VERSION 必须是字符串');
    assert.eq(E.VERSION, '1.1.0', '契约 §3.1 规定 VERSION 为 "1.1.0"');
  });

  t('OPS 是对象且含 cn/consume/produce', (E) => {
    assert.isObj(E.OPS, 'GummyEngine.OPS 必须是对象');
    for (const sym of Object.keys(E.OPS)) {
      const o = E.OPS[sym];
      assert.isObj(o, `OPS['${sym}'] 必须是对象`);
      assert.hasKeys(o, ['cn', 'consume', 'produce'], `OPS['${sym}'] 字段不完整`);
      assert.isStr(o.cn, `OPS['${sym}'].cn 必须是字符串`);
      assert.isNum(o.consume, `OPS['${sym}'].consume 必须是数字`);
      assert.isNum(o.produce, `OPS['${sym}'].produce 必须是数字`);
    }
  });

  t('DEFAULT_GAUGE 为 {stPerCm:2.2, roundsPerCm:2.2, hookMm:2.5}', (E) => {
    assert.isObj(E.DEFAULT_GAUGE, 'GummyEngine.DEFAULT_GAUGE 必须是对象');
    assert.eq(E.DEFAULT_GAUGE.stPerCm, 2.2, 'DEFAULT_GAUGE.stPerCm 应为 2.2（契约 §6）');
    assert.eq(E.DEFAULT_GAUGE.roundsPerCm, 2.2, 'DEFAULT_GAUGE.roundsPerCm 应为 2.2（契约 §6）');
    assert.eq(E.DEFAULT_GAUGE.hookMm, 2.5, 'DEFAULT_GAUGE.hookMm 应为 2.5（契约 §6）');
  });

  t('SHAPE_KINDS 为约定的 6 种形状', (E) => {
    assert.isArr(E.SHAPE_KINDS, 'GummyEngine.SHAPE_KINDS 必须是数组');
    assert.deepEq(
      [...E.SHAPE_KINDS].sort(),
      ['capsule', 'cone', 'cylinder', 'flat-round', 'flat-row', 'sphere'],
      'SHAPE_KINDS 必须精确为契约 §3.1 的 6 种（不多不少）',
    );
  });

  const fns = [
    ['validateChart', 1], ['buildRound', 1], ['buildShape', 2], ['buildChart', 1],
    ['yarnEstimate', 2], ['circleLayout', 2], ['toNotation', 1], ['quantize', 3],
    ['summarizePhotoRegions', 4], ['assessIdentity', 1],
    ['layoutPartMap', 1], ['resolveReference', 2],
  ];
  for (const [name] of fns) {
    t(`${name} 是函数`, (E) => {
      assert.isFn(E[name], `GummyEngine.${name} 必须是函数（契约 §3）`);
    });
  }

  t('buildRound 纯函数：不抛异常且返回 {stitchesIn,stitchesOut,note}', (E) => {
    const r = assert.noThrow(() => E.buildRound([{ sym: 'X', n: 6 }]), 'buildRound([{sym:"X",n:6}]) 抛异常了');
    assert.isObj(r, 'buildRound 必须返回对象');
    assert.hasKeys(r, ['stitchesIn', 'stitchesOut', 'note'], 'buildRound 返回值缺字段（契约 §3.3）');
    assert.eq(r.stitchesIn, 6, '6X 的消耗应为 6');
    assert.eq(r.stitchesOut, 6, '6X 的产出应为 6');
    assert.isStr(r.note, 'buildRound().note 必须是字符串');
  });

  t('buildRound 处理加针：6V → 消耗 6 / 产出 12', (E) => {
    const r = E.buildRound([{ sym: 'V', n: 6 }]);
    assert.eq(r.stitchesIn, 6, '6V 消耗 6 针');
    assert.eq(r.stitchesOut, 12, '6V 产出 12 针');
  });

  t('validateChart 对最小合格图返回 ok===true', (E) => {
    const v = assert.noThrow(() => E.validateChart(ctx.builders.minimalValidChart()), 'validateChart 抛异常');
    assert.isObj(v, 'validateChart 必须返回对象');
    assert.eq(v.ok, true, `最小合格图应当通过，实际错误: ${JSON.stringify(v.errors)}`);
  });
}
