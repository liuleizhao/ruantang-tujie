// 通用 chart 构造器（测试内用，避免依赖 fixtures 文件被谁改动）
// 与 tests/lib/reference-validator.mjs 共享「与契约一致的算术」
export const OPS = {
  X: { consume: 1, produce: 1 },
  V: { consume: 1, produce: 2 },
  A: { consume: 2, produce: 1 },
  T: { consume: 1, produce: 1 },
  F: { consume: 1, produce: 1 },
  W: { consume: 1, produce: 3 },
  M: { consume: 3, produce: 1 },
  CH: { consume: 0, produce: 1 },
  SL: { consume: 1, produce: 0 },
  K: { consume: 1, produce: 0 },
};

const PALETTE = [
  { id: 'C1', name: '雪白', hex: '#F7F3EE', role: 'skin', yarnMetersPerGram: 4.2 },
  { id: 'C2', name: '苔绿', hex: '#5B8C5A', role: 'hair', yarnMetersPerGram: 4.2 },
  { id: 'C3', name: '奶油黄', hex: '#F2D59B', role: 'main', yarnMetersPerGram: 4.2 },
  { id: 'C4', name: '腮红粉', hex: '#F2A7A0', role: 'accent', yarnMetersPerGram: 4.2 },
];

export const GAUGE = { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5, yarn: '4ply 牛奶棉' };

/** 构造一圈：stitchesIn 显式给出，ops 决定 consume/produce */
export function round(r, { kind = 'round', color = 'C3', stitchesIn, stitchesOut, ops, ...rest }) {
  const rd = { r, kind, color, stitchesIn, stitchesOut, ops, ...rest };
  if (rd.note === undefined) {
    rd.note = ops.map((o) => `${o.n}${o.sym}`).join(' ');
  }
  return rd;
}

/** 用 ops 自动推出 stitchesOut = stitchesIn + balance */
export function autoRound(r, stitchesIn, ops, extra = {}) {
  const consume = ops.reduce((s, o) => s + OPS[o.sym].consume * o.n, 0);
  const produce = ops.reduce((s, o) => s + OPS[o.sym].produce * o.n, 0);
  const stitchesOut = stitchesIn + produce - consume;
  return round(r, { stitchesIn, stitchesOut, ops, ...extra });
}

/** canonical 合格部件：magic-ring 6 → 12 → 18（满足 R1–R7 全部） */
export function canonicalRounds({ color = 'C3', extra = {} } = {}) {
  return [
    round(1, { kind: 'magic-ring', color, stitchesIn: 0, stitchesOut: 6, ops: [{ sym: 'X', n: 6 }], ...extra }),
    autoRound(2, 6, [{ sym: 'V', n: 6 }], { color }),
    autoRound(3, 12, [{ sym: 'X', n: 6 }, { sym: 'V', n: 6 }], { color }),
    autoRound(4, 18, [{ sym: 'X', n: 18 }], { color }),
  ];
}

export function part(id, rounds, shape = { kind: 'sphere', diameterCm: 3 }, name = id) {
  return {
    id,
    name,
    shape,
    rounds,
    subtotal: { stitches: rounds.reduce((s, r) => s + (r.stitchesOut || 0), 0), rounds: rounds.length },
  };
}

export function chart(parts, overrides = {}) {
  return {
    version: 1,
    name: overrides.name || '测试图',
    createdAt: '2026-10-29T00:00:00.000Z',
    spec: { name: '测试', heightCm: 6, style: 'chibi' },
    gauge: GAUGE,
    palette: PALETTE,
    parts,
    ...overrides,
  };
}

/** 一个最小的合格 chart（4 圈 1 部件） */
export function minimalValidChart() {
  return chart([part('body', canonicalRounds(), { kind: 'cylinder', diameterCm: 3, heightCm: 2 }, '身体')]);
}

/** 深拷贝并就地修改（用于构造反例而不污染共享对象） */
export function mutate(chartObj, fn) {
  const copy = JSON.parse(JSON.stringify(chartObj));
  fn(copy);
  return copy;
}

export function allTexts(validation) {
  const out = [];
  const push = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(push); };
  if (!validation || typeof validation !== 'object') return out;
  push(validation.errors);
  push(validation.warnings);
  for (const p of validation.parts || []) {
    push(p.errors);
    for (const r of p.rounds || []) push(r.errors);
  }
  return out;
}

/** 取某部件某圈的逐圈报告 */
export function roundReport(validation, partId) {
  const p = (validation.parts || []).find((x) => x.id === partId);
  return { part: p, rounds: (p && p.rounds) || [] };
}

export const PALETTE_IDS = PALETTE.map((p) => p.id);
export { PALETTE };
