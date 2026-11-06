// 测试 fixture 生成器（开发期工具，运行一次把 JSON 落到 tests/fixtures/）
// 为什么用生成器：good-chart 的每一圈针数必须由 ops 推导出来，手写 18 圈极易算错；
// 生成器负责「算术自证」，生成后的 JSON 才是测试的事实来源。
//
// 用法：node tests/lib/fixture-gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR } from './paths.mjs';

const OPS = {
  X: { consume: 1, produce: 1, cn: '短针' },
  V: { consume: 1, produce: 2, cn: '加针' },
  A: { consume: 2, produce: 1, cn: '减针' },
  T: { consume: 1, produce: 1, cn: '中长针' },
  F: { consume: 1, produce: 1, cn: '长针' },
  W: { consume: 1, produce: 3, cn: '一针三短针' },
  M: { consume: 3, produce: 1, cn: '三针并一针' },
  CH: { consume: 0, produce: 1, cn: '锁针' },
  SL: { consume: 1, produce: 0, cn: '引拔' },
  K: { consume: 1, produce: 0, cn: '空针' },
};

const GAUGE = { stPerCm: 2.2, roundsPerCm: 2.2, hookMm: 2.5, yarn: '4ply 牛奶棉' };
const PALETTE4 = [
  { id: 'C1', name: '雪白', hex: '#F7F3EE', role: 'skin', yarnMetersPerGram: 4.2 },
  { id: 'C2', name: '苔绿', hex: '#5B8C5A', role: 'hair', yarnMetersPerGram: 4.2 },
  { id: 'C3', name: '奶油黄', hex: '#F2D59B', role: 'main', yarnMetersPerGram: 4.2 },
  { id: 'C4', name: '腮红粉', hex: '#F2A7A0', role: 'accent', yarnMetersPerGram: 4.2 },
];

/** 把 ops 规格展开成正式 ops 数组，并做算术自证 */
function roundOf(r, spec) {
  const ops = spec.ops.map(([sym, n]) => {
    if (!OPS[sym]) throw new Error(`fixture 未知记号 ${sym}`);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`fixture ${sym} 的 n 必须为正整数`);
    return { sym, n };
  });
  const consume = ops.reduce((s, o) => s + OPS[o.sym].consume * o.n, 0);
  const produce = ops.reduce((s, o) => s + OPS[o.sym].produce * o.n, 0);
  return { r, kind: spec.kind, color: spec.color, ops, consume, produce, spec };
}

function buildPart(id, name, shape, specs) {
  const rounds = [];
  let prevOut = null;
  for (let i = 0; i < specs.length; i += 1) {
    const s = specs[i];
    const base = roundOf(i + 1, s);
    let stitchesIn;
    if (i === 0) {
      if (base.kind === 'magic-ring') stitchesIn = 0;
      else if (base.kind === 'attach') stitchesIn = shape.attachTo.stitches;
      else throw new Error(`${id} 第 1 圈 kind=${base.kind} 需要显式起针规则`);
    } else {
      stitchesIn = prevOut;
    }
    // magic-ring 的「消耗」是起针基座，不从上一圈来；产出即 ops 的 produce 总和。
    // 其余圈一律 stitchesOut = stitchesIn + produce - consume（R5 的等价形式）。
    const stitchesOut = base.kind === 'magic-ring'
      ? base.produce
      : stitchesIn + base.produce - base.consume;

    // 自证：非 magic-ring / 非 attach 分支的圈，R1 必须成立（consume === stitchesIn）
    // 注：契约 §2.3 的 magic-ring 样例是 stitchesIn:0 + [{X,6}]，字面上违反 R1 的
    //     sum(consume*n) === stitchesIn，故 magic-ring 圈必须豁免 R1 的「消耗」侧。
    if (base.kind !== 'magic-ring' && base.consume !== stitchesIn) {
      throw new Error(`${id} R${base.r} 的 ops 消耗 ${base.consume} ≠ stitchesIn ${stitchesIn}`);
    }
    if (stitchesOut < 0) throw new Error(`${id} R${base.r} 产出为负`);

    const round = {
      r: base.r,
      kind: base.kind,
      color: base.color,
      stitchesIn,
      stitchesOut,
      ops: base.ops,
      note: s.note,
    };
    if (s.loop) round.loop = s.loop;
    if (s.loop && 'reservedFor' in s) round.reservedFor = s.reservedFor;
    if (s.decor) round.decor = s.decor;
    rounds.push(round);
    prevOut = stitchesOut;
  }
  return {
    id,
    name,
    shape,
    rounds,
    subtotal: { stitches: rounds.reduce((s, r) => s + r.stitchesOut, 0), rounds: rounds.length },
  };
}

const chartShell = (name, spec, parts, extra = {}) => {
  const stitches = parts.reduce((s, p) => s + p.subtotal.stitches, 0);
  const meters = Math.round(stitches * 0.025 * 10) / 10;
  return {
    version: 1,
    name,
    createdAt: '2026-10-29T00:00:00.000Z',
    spec,
    gauge: GAUGE,
    palette: PALETTE4,
    parts,
    ...extra,
    yarn: {
      perPart: parts.map((p) => ({
        id: p.id,
        stitches: p.subtotal.stitches,
        meters: Math.round(p.subtotal.stitches * 0.025 * 10) / 10,
        grams: Math.round((p.subtotal.stitches * 0.025 / 4.2) * 10) / 10,
      })),
      total: { stitches, meters, grams: Math.round((meters / 4.2) * 10) / 10 },
      withBuffer: { meters: Math.round(meters * 1.25 * 10) / 10, grams: Math.round((meters * 1.25 / 4.2) * 10) / 10 },
      bufferRatio: 0.25,
      constants: { metersPerStitch: 0.025, note: 'fixture 手工按契约 §3.6 算出，仅用于结构参考' },
    },
  };
};

/* ─────────────── 合格 chart：body(14 圈) + hem(4 圈) ─────────────── */
const body = buildPart(
  'body', '身体',
  { kind: 'cylinder', diameterCm: 5.2, heightCm: 6.5 },
  [
    { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
    { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
    { kind: 'round', color: 'C3', ops: [['X', 6], ['V', 6]], note: '(X,V)×6 = 18' },
    { kind: 'round', color: 'C3', ops: [['X', 12], ['V', 6]], note: '(2X,V)×6 = 24' },
    { kind: 'round', color: 'C3', ops: [['X', 18], ['V', 6]], note: '(3X,V)×6 = 30' },
    { kind: 'round', color: 'C3', ops: [['X', 24], ['V', 6]], note: '(4X,V)×6 = 36' },
    { kind: 'round', color: 'C4', loop: 'blo', reservedFor: 'hem', ops: [['X', 36]], note: '36X（内半针，外半针留给荷叶边）' },
    {
      kind: 'round', color: 'C4', ops: [['X', 36]], note: '36X',
      decor: [{ kind: 'curly', every: 2, count: 18, ch: 6, note: '18 个卷曲针，每个 6CH' }],
    },
    { kind: 'round', color: 'C3', ops: [['X', 24], ['A', 6]], note: '(4X,A)×6 = 30' },
    { kind: 'round', color: 'C3', ops: [['X', 18], ['A', 6]], note: '(3X,A)×6 = 24' },
    { kind: 'round', color: 'C3', ops: [['X', 12], ['A', 6]], note: '(2X,A)×6 = 18' },
    { kind: 'round', color: 'C3', ops: [['X', 6], ['A', 6]], note: '(X,A)×6 = 12' },
    { kind: 'round', color: 'C3', ops: [['A', 6]], note: '6A = 6' },
    { kind: 'round', color: 'C3', ops: [['X', 6]], note: '6X 收口' },
  ],
);

const hem = buildPart(
  'hem', '荷叶边',
  {
    kind: 'flat-round', diameterCm: 5.2,
    attachTo: { part: 'body', round: 7, loop: 'flo', stitches: 36 },
  },
  [
    { kind: 'attach', color: 'C4', ops: [['X', 24], ['V', 12]], note: '接外半针 36 针：(2X,V)×12 = 48' },
    { kind: 'round', color: 'C4', ops: [['X', 48]], note: '48X' },
    { kind: 'round', color: 'C1', ops: [['X', 36], ['V', 12]], note: '(3X,V)×12 = 60' },
    { kind: 'round', color: 'C1', ops: [['X', 60]], note: '60X' },
  ],
);

const goodChart = chartShell('测试用合格图解 · 身体+荷叶边', { name: '测试用', heightCm: 9, style: 'chibi' }, [body, hem]);

/* ─────────────── 迷你 chart 工具：3 圈最小可校验部件 ─────────────── */
const mini = (name, mutate = (rounds) => rounds, extraPart = null) => {
  const p = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 3, heightCm: 2 }, [
    { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
    { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
    { kind: 'round', color: 'C3', ops: [['X', 12]], note: '12X' },
  ]);
  mutate(p.rounds);
  p.subtotal = { stitches: p.rounds.reduce((s, r) => s + r.stitchesOut, 0), rounds: p.rounds.length };
  const parts = extraPart ? [p, extraPart] : [p];
  return chartShell(name, { name: '测试用', heightCm: 4, style: 'chibi' }, parts);
};

/* ─────────────── 坏 chart：每条规则一个，尽量少牵连 ─────────────── */
const bad = {};

// R1 环内守恒：第 3 圈 ops 消耗 13 ≠ stitchesIn 12
bad['bad-r1-consume.json'] = {
  rule: 'R1', round: 3,
  why: '第 3 圈 ops 为 13X，消耗 13 针，但 stitchesIn 声明 12（上一圈产出）。R1 应报错。',
  chart: mini('坏图 · R1 环内消耗不符', (rounds) => {
    rounds[2].ops = [{ sym: 'X', n: 13 }];
  }),
};

// R2 产出正确：第 3 圈 12X + 1SL → 消耗 12（R1 通过），但产出 12 ≠ stitchesOut 12？不，12X 产出 12。
// 要让「消耗对、产出错」：X×11 + SL×1 → 消耗 12，产出 11 ≠ 12。
bad['bad-r2-produce.json'] = {
  rule: 'R2', round: 3,
  why: '第 3 圈 ops 为 11X+1SL，消耗 12 针（R1 通过），但产出 11 针 ≠ stitchesOut 12。R2 应报错。',
  chart: mini('坏图 · R2 产出不符', (rounds) => {
    rounds[2].ops = [{ sym: 'X', n: 11 }, { sym: 'SL', n: 1 }];
  }),
};

// R3 衔接守恒：第 3 圈 stitchesIn 写成 11，上一圈产出 12
bad['bad-r3-chain.json'] = {
  rule: 'R3', round: 3,
  why: '第 3 圈 stitchesIn 声明 11，但第 2 圈产出 12。R3 应报错。',
  chart: mini('坏图 · R3 衔接不符', (rounds) => {
    rounds[2].stitchesIn = 11;
  }),
};

// R4 起针：第 1 圈 kind=magic-ring 却声明 stitchesIn=6
bad['bad-r4-start.json'] = {
  rule: 'R4', round: 1,
  why: '第 1 圈 kind=magic-ring 但 stitchesIn=6（应为 0）。此图 R1/R2/R5 均自洽，只有 R4 会被抓。',
  chart: mini('坏图 · R4 起针不符', (rounds) => {
    rounds[0].stitchesIn = 6;
  }),
};

// R5 增减一致：第 3 圈声明 stitchesIn 12 → stitchesOut 18，但 ops 全是 X（无增针）
bad['bad-r5-incdec.json'] = {
  rule: 'R5', round: 3,
  why: '第 3 圈 12→18，差值 +6，但 ops 只有 12X（#V/#W/#CH 全为 0）。R5 应报错：增量无法由增减针解释。',
  chart: mini('坏图 · R5 增减不一致', (rounds) => {
    rounds[2].stitchesOut = 18;
  }),
};

// R6 配色合法：第 2 圈用不存在的颜色 C9
bad['bad-r6-color.json'] = {
  rule: 'R6', round: 2,
  why: '第 2 圈 color=C9，不在 palette（C1..C4）中。R6 应报错。',
  chart: mini('坏图 · R6 配色非法', (rounds) => {
    rounds[1].color = 'C9';
  }),
};

// R7 可钩性上限：第 2 圈 stitchesOut=240 > 200
bad['bad-r7-bound.json'] = {
  rule: 'R7', round: 2,
  why: '第 2 圈 stitchesOut=240（>200 上限，且 6 针起针一圈不可能产出 240）。R7 应报错。',
  chart: mini('坏图 · R7 超出可钩性上限', (rounds) => {
    rounds[1].stitchesOut = 240;
  }),
};

/* ─────────────── v1.1 专项 fixtures ─────────────── */
// R8 正例：36 针圈挂 18 个卷曲针（18×2=36）
const decorGoodBody = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, [
  { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
  { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
  { kind: 'round', color: 'C3', ops: [['V', 12]], note: '12V = 24' },
  { kind: 'round', color: 'C3', ops: [['X', 12], ['V', 12]], note: '(X,V)×12 = 36' },
  {
    kind: 'round', color: 'C2', ops: [['X', 36]], note: '36X',
    decor: [{ kind: 'curly', every: 2, count: 18, ch: 6, note: '18 个卷曲针' }],
  },
]);
const decorGood = chartShell('合格图 · R8 装饰针迹（36 针 / every 2 / count 18）', { name: '装饰测试' }, [decorGoodBody]);

const decorBadBody = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, [
  { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
  { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
  { kind: 'round', color: 'C3', ops: [['V', 12]], note: '12V = 24' },
  { kind: 'round', color: 'C3', ops: [['X', 12], ['V', 12]], note: '(X,V)×12 = 36' },
  {
    kind: 'round', color: 'C2', ops: [['X', 36]], note: '36X',
    decor: [{ kind: 'curly', every: 2, count: 17, ch: 6, note: '17×2=34≠36，应当报错' }],
  },
]);
bad['bad-r8-decor.json'] = {
  rule: 'R8', round: 5,
  why: '第 5 圈 stitchesOut=36，decor 为 every=2 / count=17（17×2=34≠36）。R8 应报错。',
  chart: chartShell('坏图 · R8 装饰针迹数量不符', { name: '装饰测试' }, [decorBadBody]),
};

// R9 警告：blo 圈无人接，也没有 reservedFor
const r9WarnBody = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, [
  { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
  { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
  { kind: 'round', color: 'C3', ops: [['V', 12]], note: '12V = 24' },
  { kind: 'round', color: 'C3', ops: [['X', 18], ['V', 6]], note: '24→30：(3X,V)×6，留内半针', loop: 'blo' },
]);
const r9Warn = chartShell('合格图但带警告 · R9 留针无人接', { name: '留针测试' }, [r9WarnBody]);

// R9 干净：blo 圈 + reservedFor=hem，且 hem 通过 attachTo 接上 → warnings 为空
const loopBody = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 5.2, heightCm: 4 }, [
  { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
  { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
  { kind: 'round', color: 'C3', ops: [['X', 6], ['V', 6]], note: '(X,V)×6 = 18' },
  { kind: 'round', color: 'C3', ops: [['X', 12], ['V', 6]], note: '(2X,V)×6 = 24' },
  {
    kind: 'round', color: 'C3', ops: [['X', 18], ['V', 6]], loop: 'blo', reservedFor: 'hem',
    note: '(3X,V)×6 = 30（内半针）',
  },
]);
const loopHem = buildPart(
  'hem', '荷叶边',
  { kind: 'flat-round', diameterCm: 4.3, attachTo: { part: 'body', round: 5, loop: 'flo', stitches: 30 } },
  [
    { kind: 'attach', color: 'C4', ops: [['X', 18], ['V', 12]], note: '接 30 外半针：(X,V)×12,6X = 42' },
    { kind: 'round', color: 'C4', ops: [['X', 42]], note: '42X' },
  ],
);
const loopClean = chartShell('合格图 · R9 留针被荷叶边接上', { name: '留针测试' }, [loopBody, loopHem]);

// reservedFor: null 表示「留针但不用」→ 不应告警
const loopNullBody = buildPart('body', '身体', { kind: 'cylinder', diameterCm: 5.2, heightCm: 3 }, [
  { kind: 'magic-ring', color: 'C3', ops: [['X', 6]], note: '环形起针 6X' },
  { kind: 'round', color: 'C3', ops: [['V', 6]], note: '6V = 12' },
  { kind: 'round', color: 'C3', ops: [['V', 12]], note: '12V = 24' },
  { kind: 'round', color: 'C3', ops: [['X', 24]], note: '24X（外半针留用但不接）', loop: 'flo', reservedFor: null },
]);
const loopNull = chartShell('合格图 · R9 reservedFor=null 显式声明不用', { name: '留针测试' }, [loopNullBody]);

/* ─────────────── 写出 ─────────────── */
const write = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  return p;
};

const written = [];
written.push(write(path.join(FIXTURES_DIR, 'good-chart.json'), goodChart));
written.push(write(path.join(FIXTURES_DIR, 'decor-good-chart.json'), decorGood));
written.push(write(path.join(FIXTURES_DIR, 'loop-warn-chart.json'), r9Warn));
written.push(write(path.join(FIXTURES_DIR, 'loop-clean-chart.json'), loopClean));
written.push(write(path.join(FIXTURES_DIR, 'loop-null-chart.json'), loopNull));

const manifest = [];
for (const [file, meta] of Object.entries(bad)) {
  written.push(write(path.join(FIXTURES_DIR, 'bad-charts', file), meta.chart));
  manifest.push({ file: `bad-charts/${file}`, rule: meta.rule, round: meta.round, why: meta.why });
}
written.push(write(path.join(FIXTURES_DIR, 'bad-charts', 'manifest.json'), manifest));

// toySpec fixtures
const toySpec5 = {
  name: '绿发少女 · 五件套',
  heightCm: 14,
  style: 'chibi',
  gauge: GAUGE,
  palette: PALETTE4,
  defaultColor: 'C3',
  parts: [
    {
      id: 'head', name: '头部', shape: { kind: 'sphere', diameterCm: 8 },
      colorRounds: [{ from: 1, to: 6, color: 'C1' }, { from: 7, to: 999, color: 'C2' }],
    },
    {
      id: 'body', name: '身体', shape: { kind: 'capsule', diameterCm: 6.5, heightCm: 8 },
      colorRounds: [{ from: 1, to: 999, color: 'C3' }],
    },
    {
      id: 'armL', name: '左臂', shape: { kind: 'capsule', diameterCm: 2.5, heightCm: 5 },
      colorRounds: [{ from: 1, to: 999, color: 'C1' }],
    },
    {
      id: 'armR', name: '右臂', shape: { kind: 'capsule', diameterCm: 2.5, heightCm: 5 },
      colorRounds: [{ from: 1, to: 999, color: 'C1' }],
    },
    {
      id: 'leg', name: '腿', shape: { kind: 'capsule', diameterCm: 3, heightCm: 4 },
      colorRounds: [{ from: 1, to: 999, color: 'C4' }],
    },
  ],
};
written.push(write(path.join(FIXTURES_DIR, 'toyspec-5part.json'), toySpec5));

const toySpecV11 = {
  name: '绿发少女 · v1.1 装饰与留针',
  heightCm: 13,
  style: 'chibi',
  gauge: GAUGE,
  palette: PALETTE4,
  defaultColor: 'C3',
  parts: [
    {
      id: 'body', name: '身体', shape: { kind: 'capsule', diameterCm: 6, heightCm: 7 },
      colorRounds: [{ from: 1, to: 999, color: 'C3' }],
      decorRounds: [{ round: 6, kind: 'bobble', every: 1, count: 36 }],
      loopRounds: [{ round: 8, loop: 'blo', reservedFor: 'hem' }],
    },
    {
      id: 'hem', name: '荷叶边',
      shape: {
        kind: 'flat-round', diameterCm: 5, attachTo: { part: 'body', round: 8, loop: 'flo', stitches: 30 },
      },
    },
    {
      id: 'head', name: '头部', shape: { kind: 'sphere', diameterCm: 7.5 },
      colorRounds: [{ from: 1, to: 999, color: 'C2' }],
      decorRounds: [{ round: 9, kind: 'curly', every: 2, count: 18, ch: 6 }],
    },
  ],
  buildOrder: ['先钩身体，第 8 圈钩内半针', '在外半针上钩荷叶边', '钩头部并缝上', '绣五官'],
};
written.push(write(path.join(FIXTURES_DIR, 'toyspec-v11.json'), toySpecV11));

console.log('已生成 fixtures:');
for (const p of written) console.log(`  ${path.relative(process.cwd(), p)}`);
