// 参考校验器：按契约 §3.2 + §5b 独立实现一遍 R1–R9。
// 用途 **仅限自证 fixtures**（确认坏图真的违规、合格图真的合格），不参与对引擎的评分。
// 若引擎与它的判断不一致，先查这里与契约，再报给 lead。

export const OPS = {
  X: { cn: '短针', consume: 1, produce: 1 },
  V: { cn: '加针', consume: 1, produce: 2 },
  A: { cn: '减针', consume: 2, produce: 1 },
  T: { cn: '中长针', consume: 1, produce: 1 },
  F: { cn: '长针', consume: 1, produce: 1 },
  W: { cn: '一针三短针', consume: 1, produce: 3 },
  M: { cn: '三针并一针', consume: 3, produce: 1 },
  CH: { cn: '锁针', consume: 0, produce: 1 },
  SL: { cn: '引拔', consume: 1, produce: 0 },
  K: { cn: '空针', consume: 1, produce: 0 },
};

const incdec = (ops) => {
  let bal = 0;
  for (const o of ops || []) {
    const n = o.n || 0;
    const d = OPS_SAFE(o.sym);
    bal += (d.produce - d.consume) * n; // 与 R5 的 (#V+2#W+#CH)-(#A+2#M+#SL+#K) 等价
  }
  return bal;
};
const OPS_SAFE = (sym) => OPS[sym] || { consume: 0, produce: 0 };
const sumConsume = (ops) => (ops || []).reduce((s, o) => s + OPS_SAFE(o.sym).consume * (o.n || 0), 0);
const sumProduce = (ops) => (ops || []).reduce((s, o) => s + OPS_SAFE(o.sym).produce * (o.n || 0), 0);

/**
 * 返回 { ok, errors, warnings, notes }
 * 契约歧义处理（已在报告里列给 lead）：
 *  - A1：§2.3 的 magic-ring 样例 stitchesIn:0 + [{X,6}] 字面违反 R1/R5。
 *        本实现按工艺常识让 magic-ring 豁免 R1 消耗侧与 R5（其产出由 R2 约束）。
 *  - A2：§3.4 允许收口圈 stitchesOut===0，与 R7 的 >=6 冲突。
 *        本实现把 R7 下限只施加于非收口圈（最后一个部分收口圈豁免）。
 */
export function referenceValidate(chart) {
  const errors = [];
  const warnings = [];
  const paletteIds = new Set(((chart && chart.palette) || []).map((p) => p.id));
  const parts = (chart && chart.parts) || [];

  // attachTo 索引：body 的某圈被哪个部件接上
  const attachRefs = new Map(); // `${partId}#${round}` -> [consumerId]
  for (const p of parts) {
    const a = p && p.shape && p.shape.attachTo;
    if (a && a.part) {
      const k = `${a.part}#${a.round}`;
      if (!attachRefs.has(k)) attachRefs.set(k, []);
      attachRefs.get(k).push(p.id);
    }
  }

  let totalStitches = 0;
  let colorChanges = 0;
  let decorCount = 0;
  let reservedLoops = 0;

  const partReports = [];

  for (const part of parts) {
    const pErr = [];
    const rounds = part.rounds || [];
    let prevOut = null;

    rounds.forEach((rd, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === rounds.length - 1;
      const consumed = sumConsume(rd.ops);
      const produced = sumProduce(rd.ops);
      const delta = (rd.stitchesOut || 0) - (rd.stitchesIn || 0);
      const tag = `R${rd.r}`;
      const isRing = rd.kind === 'magic-ring';
      const isAttach = rd.kind === 'attach';

      // R4 起针
      if (isFirst) {
        if (isRing) {
          if (rd.stitchesIn !== 0) pErr.push(`${part.id} R4 ${tag} 起针错误：magic-ring 的 stitchesIn 必须为 0，实际 ${rd.stitchesIn}`);
        } else if (isAttach) {
          const a = part.shape && part.shape.attachTo;
          if (!a) pErr.push(`${part.id} R4 ${tag} 起针错误：kind=attach 但 shape.attachTo 缺失`);
          else if (rd.stitchesIn !== a.stitches) pErr.push(`${part.id} R4 ${tag} 起针错误：attach 起针应为 ${a.stitches}，实际 ${rd.stitchesIn}`);
        } else if (rd.stitchesIn !== 0) {
          pErr.push(`${part.id} R4 ${tag} 起针错误：第 1 圈既非 magic-ring 也非 attach 时 stitchesIn 应为 0`);
        }
      }

      // R1 环内守恒（magic-ring 豁免：起针基座不从上一圈来）
      if (!isRing && consumed !== rd.stitchesIn) {
        pErr.push(`${part.id} R1 ${tag} 环内消耗不符：ops 消耗 ${consumed} ≠ stitchesIn ${rd.stitchesIn}`);
      }
      // R2 产出正确
      if (produced !== rd.stitchesOut && !(isRing && produced === rd.stitchesOut)) {
        pErr.push(`${part.id} R2 ${tag} 产出不符：ops 产出 ${produced} ≠ stitchesOut ${rd.stitchesOut}`);
      }
      // R3 衔接守恒
      if (!isFirst && !isAttach && rd.stitchesIn !== prevOut) {
        pErr.push(`${part.id} R3 ${tag} 衔接不符：stitchesIn ${rd.stitchesIn} ≠ 上一圈 stitchesOut ${prevOut}`);
      }
      // R5 增减一致（magic-ring 豁免：起针增量不由增减针解释）
      if (!isRing) {
        const bal = incdec(rd.ops);
        if (delta !== bal) {
          pErr.push(`${part.id} R5 ${tag} 增减不一致：差值 ${delta} 但增减针只解释 ${bal}（差 ${delta - bal}）`);
        }
      }
      // R6 配色合法
      if (!paletteIds.has(rd.color)) {
        pErr.push(`${part.id} R6 ${tag} 配色非法：color "${rd.color}" 不在 palette 中`);
      }
      // R7 可钩性（收口圈豁免下限，见 A2）
      if (!Number.isInteger(rd.stitchesOut)) {
        pErr.push(`${part.id} R7 ${tag} 针数必须为整数：${rd.stitchesOut}`);
      } else if (rd.stitchesOut > 200) {
        pErr.push(`${part.id} R7 ${tag} 针数超上限：${rd.stitchesOut} > 200`);
      } else if (rd.stitchesOut < 5 && !isLast) {
        pErr.push(`${part.id} R7 ${tag} 针数低于下限：${rd.stitchesOut} < 5`);
      }
      // R8 装饰针迹
      for (const d of rd.decor || []) {
        decorCount += 1;
        if (!d || typeof d.count !== 'number' || typeof d.every !== 'number') {
          pErr.push(`${part.id} R8 ${tag} 装饰针迹缺少 count/every`);
        } else if (d.count * d.every !== rd.stitchesOut) {
          pErr.push(`${part.id} R8 ${tag} 装饰针迹数量与本圈针数不匹配：${d.count}×${d.every}=${d.count * d.every} ≠ ${rd.stitchesOut}`);
        }
      }
      // R9 半针留针
      if (rd.loop && rd.loop !== 'both') {
        reservedLoops += 1;
        const key = `${part.id}#${rd.r}`;
        const hasRef = attachRefs.has(key);
        const explicitNull = 'reservedFor' in rd && rd.reservedFor === null;
        if (!hasRef && !explicitNull) {
          warnings.push(`${part.id} ${tag} 留下半针（${rd.loop}），但没有部件接上去`);
        }
      }
      // 配色变化统计
      if (idx > 0 && rounds[idx - 1].color !== rd.color) colorChanges += 1;

      totalStitches += rd.stitchesOut || 0;
      prevOut = rd.stitchesOut;
    });

    partReports.push({ id: part.id, ok: pErr.length === 0, errors: pErr, rounds });
    errors.push(...pErr);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    parts: partReports,
    summary: { parts: parts.length, rounds: parts.reduce((s, p) => s + (p.rounds || []).length, 0), totalStitches, colorChanges, decorCount, reservedLoops },
  };
}
