/**
 * 「软糖图解」确定性引擎 · gummy-engine.js
 *
 * 设计原则：
 *   1. 零依赖，UMD 单文件，浏览器与 Node 双用。
 *   2. 所有针数计算必须是纯函数、确定性、可复现。
 *   3. 一切针数由本引擎计算，调用方（模型）不得手写针数。
 *
 * 契约见 docs/CONTRACT.md。本文件实现其 §1 / §3 / §5b 的全部 API。
 *
 * 记号守恒（契约 §1）：
 *   X 1/1  V 1/2  A 2/1  T 1/1  F 1/1  W 1/3  M 3/1  CH 0/1  SL 1/0  K 1/0
 *   （前一个数字=消耗针数，后一个=产出针数）
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    // CommonJS：默认导出即引擎，同时挂一个具名属性，
    // 便于 cjs-module-lexer 在 ESM 里识别 `import { GummyEngine }`。
    module.exports = api;
    module.exports.GummyEngine = api;
    module.exports.default = api;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return api; });
  } else {
    root.GummyEngine = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.1.0';

  /** 主体部件最宽圈可钩性门槛（对照竞品与实体试钩经验） */
  var CRAFT_FLOOR_HARD = 18;  // 低于此 → 错误（头/身太小，几乎不可钩）
  var CRAFT_FLOOR_SOFT = 24;  // 低于此 → 警告（偏紧，建议加高或加粗）

  /* ============================================================
   * §1 记号表
   * ========================================================== */
  var OPS = {
    X:  { cn: '短针',     en: 'sc',  consume: 1, produce: 1 },
    V:  { cn: '加针',     en: 'inc', consume: 1, produce: 2 },
    A:  { cn: '减针',     en: 'dec', consume: 2, produce: 1 },
    T:  { cn: '中长针',   en: 'hdc', consume: 1, produce: 1 },
    F:  { cn: '长针',     en: 'dc',  consume: 1, produce: 1 },
    W:  { cn: '一针三短针', en: '3sc', consume: 1, produce: 3 },
    M:  { cn: '三针并一针', en: '3tog', consume: 3, produce: 1 },
    B:  { cn: '爆米花针', en: 'bobble', consume: 1, produce: 1 }, // 软糖体手脚：同针 5F 一次收
    CH: { cn: '锁针',     en: 'ch',  consume: 0, produce: 1 },
    SL: { cn: '引拔',     en: 'sl',  consume: 1, produce: 0 },
    K:  { cn: '空针',     en: 'skip', consume: 1, produce: 0 }
  };

  var DEFAULT_GAUGE = {
    stPerCm: 2.2,
    roundsPerCm: 2.2,
    hookMm: 2.5,
    yarn: '4ply 牛奶棉'
  };

  var SHAPE_KINDS = ['sphere', 'capsule', 'cylinder', 'cone', 'flat-round', 'flat-row'];

  /** 各形状必填字段（契约 §3.4）。漏字段必须报错，静默产出会让圈数算成 0。 */
  var SHAPE_REQUIRED = {
    'sphere':     ['diameterCm'],
    'capsule':    ['diameterCm', 'heightCm'],
    'cylinder':   ['diameterCm', 'heightCm'],
    'cone':       ['diameterCm', 'heightCm'],
    'flat-round': ['diameterCm'],
    'flat-row':   ['widthCm', 'heightCm']
  };

  /* ============================================================
   * 小工具
   * ========================================================== */
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isPositiveNum(v) { return isNum(v) && v > 0; }
  function delimJoin(parts, sep) {
    var out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
    return out.join(sep || ' ');
  }

  /* ============================================================
   * 记号 <-> 针数
   * ========================================================== */

  /** 统计一圈 ops 的消耗/产出与各符号次数。 */
  function opsTotals(ops) {
    var consume = 0, produce = 0, counts = {};
    var list = ops || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var sym = o && o.sym;
      var meta = OPS[sym];
      if (!meta) continue;                       // ✱ 等排版符号直接跳过
      var n = isNum(o.n) && o.n > 0 ? Math.floor(o.n) : 1;
      consume += meta.consume * n;
      produce += meta.produce * n;
      counts[sym] = (counts[sym] || 0) + n;
    }
    return { consume: consume, produce: produce, counts: counts };
  }

  /** 把 ops 展开成扁平的符号数组。 */
  function expandOps(ops) {
    var flat = [];
    var list = ops || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!OPS[o && o.sym]) continue;
      var n = isNum(o.n) && o.n > 0 ? Math.floor(o.n) : 1;
      for (var k = 0; k < n; k++) flat.push(o.sym);
    }
    return flat;
  }

  /** 连续相同符号压缩成 `6X` 形式。 */
  function runsToString(arr) {
    var out = '', i = 0;
    while (i < arr.length) {
      var j = i;
      while (j < arr.length && arr[j] === arr[i]) j++;
      var c = j - i;
      out += (c > 1 ? String(c) : '') + arr[i];
      i = j;
    }
    return out;
  }

  /**
   * 把扁平符号数组压缩成人类记法：优先找最小重复周期。
   *   [X,X,X,X,V] 重复 6 次 -> "6(4X,V)"
   *   [X,X,X,X,X,X]        -> "6X"
   * 周期体内的不同符号之间用逗号分隔（`6(X,V)` 而非 `6(XV)`），
   * 这是钩织图解的通行写法，可读性明显更好。
   */
  function compressSymbols(flat) {
    if (!flat.length) return '';
    var allSame = true;
    for (var i = 1; i < flat.length; i++) if (flat[i] !== flat[0]) { allSame = false; break; }
    if (allSame) return runsToString(flat);

    // 找最小周期 p（p >= 2，因为全同已处理）
    for (var p = 2; p <= flat.length; p++) {
      if (flat.length % p !== 0) continue;
      var ok = true;
      for (var q = p; q < flat.length; q++) {
        if (flat[q] !== flat[q - p]) { ok = false; break; }
      }
      if (!ok) continue;
      var times = flat.length / p;
      if (times < 2) continue;
      return String(times) + '(' + runsList(flat.slice(0, p)) + ')';
    }
    return runsList(flat);
  }

  /** 同 runsToString，但不同符号段之间用逗号分隔。 */
  function runsList(arr) {
    var segs = [], i = 0;
    while (i < arr.length) {
      var j = i;
      while (j < arr.length && arr[j] === arr[i]) j++;
      var c = j - i;
      segs.push((c > 1 ? String(c) : '') + arr[i]);
      i = j;
    }
    return segs.join(',');
  }

  function compressOps(ops) { return compressSymbols(expandOps(ops)); }

  /**
   * §3.3 buildRound(ops) -> { stitchesIn, stitchesOut, note }
   * 把 ops 折算成针数并生成人类可读 note。
   */
  function buildRound(ops) {
    var t = opsTotals(ops);
    return {
      stitchesIn: t.consume,
      stitchesOut: t.produce,
      note: compressOps(ops)
    };
  }

  /* ============================================================
   * 形状推导（契约 §3.4）
   * ========================================================== */

  function normalizeGauge(g) {
    var src = g || {};
    return {
      stPerCm: isPositiveNum(src.stPerCm) ? src.stPerCm : DEFAULT_GAUGE.stPerCm,
      roundsPerCm: isPositiveNum(src.roundsPerCm) ? src.roundsPerCm : DEFAULT_GAUGE.roundsPerCm,
      hookMm: isPositiveNum(src.hookMm) ? src.hookMm : DEFAULT_GAUGE.hookMm,
      yarn: typeof src.yarn === 'string' && src.yarn ? src.yarn : DEFAULT_GAUGE.yarn
    };
  }

  function circumference(diameterCm) { return Math.PI * diameterCm; }

  /** 取最接近的 6 的倍数，且至少 6。 */
  function nearest6(x) {
    var v = Math.round(x / 6) * 6;
    if (v < 6) v = 6;
    return v;
  }

  /**
   * 递增圈（第 2 圈起）：从 6(r-1) 增到 6r，写法 `6((r-2)X,V)`。
   * 递减圈：从 S 减到 S-6，写法 `6((S/6-2)X,A)`。
   * 两者都展开成 ops 数组（交错而非分块，因为交错才是真实钩法）。
   */
  function incOpsForRound(r) {
    var xCount = r - 2;                 // 每单元里的 X 数
    var unit = [];
    if (xCount > 0) unit.push({ sym: 'X', n: xCount });
    unit.push({ sym: 'V', n: 1 });
    var out = [];
    for (var i = 0; i < 6; i++) out = out.concat(unit);
    return out;
  }

  function decOpsForStitches(s) {
    var xCount = s / 6 - 2;             // 每单元里的 X 数
    var unit = [];
    if (xCount > 0) unit.push({ sym: 'X', n: xCount });
    unit.push({ sym: 'A', n: 1 });
    var out = [];
    for (var i = 0; i < 6; i++) out = out.concat(unit);
    return out;
  }

  function magicRingRound(color) {
    return {
      r: 1,
      kind: 'magic-ring',
      color: color,
      stitchesIn: 0,
      stitchesOut: 6,
      ops: [{ sym: 'X', n: 6 }],
      note: '环形起针 6X'
    };
  }

  /**
   * 生成「环形起针 → 递增到 max → 平织 → 对称递减」的通用序列。
   * sphere / capsule / cylinder / cone 都复用它，只是平织段与收口方式不同。
   */
  function ringSequence(opts) {
    var maxStitches = opts.maxStitches;
    var incRounds = maxStitches / 6 - 1;                 // 递增圈数
    var straightRounds = Math.max(0, opts.straightRounds || 0);
    var doClose = opts.doClose !== false;
    var color = opts.color;

    var rounds = [];
    rounds.push(magicRingRound(color));

    // 递增：R2..R(1+incRounds)，第 r 圈产出 6r
    for (var i = 1; i <= incRounds; i++) {
      var r = i + 1;
      var ops = incOpsForRound(r);
      rounds.push({
        r: r, kind: 'round', color: color,
        stitchesIn: 6 * (r - 1),
        stitchesOut: 6 * r,
        ops: ops,
        note: ''
      });
    }

    // 平织
    for (var s = 0; s < straightRounds; s++) {
      rounds.push({
        r: rounds.length + 1, kind: 'round', color: color,
        stitchesIn: maxStitches, stitchesOut: maxStitches,
        ops: [{ sym: 'X', n: maxStitches }],
        note: ''
      });
    }

    // 对称递减：max -> max-6 -> ... -> 6
    if (doClose && incRounds > 0) {
      for (var d = 0; d < incRounds; d++) {
        var from = maxStitches - 6 * d;
        var ops2;
        if (from === 6) {
          // 6 针无法再减（R7 下限 6），以引拔收口
          ops2 = [{ sym: 'SL', n: 6 }];
          rounds.push({
            r: rounds.length + 1, kind: 'round', color: color,
            stitchesIn: 6, stitchesOut: 0, ops: ops2, note: ''
          });
          break;
        }
        ops2 = decOpsForStitches(from);
        rounds.push({
          r: rounds.length + 1, kind: 'round', color: color,
          stitchesIn: from, stitchesOut: from - 6,
          ops: ops2, note: ''
        });
      }
    }

    // 补 note（在针数确定后统一生成，保证与 ops 一致）
    for (var k = 0; k < rounds.length; k++) {
      if (!rounds[k].note) rounds[k].note = compressOps(rounds[k].ops);
    }
    return rounds;
  }

  /** 部件接在留针上时的序列：R1 接 N 针，R2 外扩，R3 平织。 */
  function attachSequence(opts) {
    var n = opts.stitches;
    var color = opts.color;
    var rounds = [];

    // R1：接在留针上，钩 N 个短针（消耗 N = 留针数）
    rounds.push({
      r: 1, kind: 'attach', color: color,
      stitchesIn: n, stitchesOut: n,
      ops: [{ sym: 'X', n: n }],
      note: ''
    });

    // R2：外扩。vCount 个加针，其余短针均匀分布。
    if (n >= 2) {
      var vCount = Math.floor(n / 2);
      var xCount = n - vCount;                  // 与 vCount 配对消耗
      // 每单元 (xPer V) 个 X + 1 个 V，需要 xPer = xCount / vCount
      if (xCount % vCount === 0) {
        var xPer = xCount / vCount;
        var unit = [];
        if (xPer > 0) unit.push({ sym: 'X', n: xPer });
        unit.push({ sym: 'V', n: 1 });
        var ops = [];
        for (var i = 0; i < vCount; i++) ops = ops.concat(unit);
        rounds.push({
          r: 2, kind: 'round', color: color,
          stitchesIn: n, stitchesOut: n + vCount,
          ops: ops, note: ''
        });

        // R3：平织（荷叶边的外缘），按 heightCm 追加更多平织圈
        var flareOut = n + vCount;
        var plain = Math.max(1, isPositiveNum(opts.heightCm)
          ? Math.round(opts.heightCm * opts.roundsPerCm) : 1);
        for (var p = 0; p < plain; p++) {
          rounds.push({
            r: rounds.length + 1, kind: 'round', color: color,
            stitchesIn: flareOut, stitchesOut: flareOut,
            ops: [{ sym: 'X', n: flareOut }], note: ''
          });
        }
      }
    }

    for (var k = 0; k < rounds.length; k++) {
      if (!rounds[k].note) rounds[k].note = compressOps(rounds[k].ops);
    }
    return rounds;
  }

  /**
   * §3.4 buildShape(shape, gauge) -> { rounds, plan }
   */
  function buildShape(shape, gauge) {
    var g = normalizeGauge(gauge);
    var sh = shape || {};
    var kind = sh.kind;
    var plan = { kind: kind };
    var rounds = [];
    var color = sh.color || null;

    if (SHAPE_KINDS.indexOf(kind) === -1) {
      return { rounds: [], plan: plan, error: '未知形状 ' + String(kind) +
        '，可选：' + SHAPE_KINDS.join(' / ') };
    }

    // 必填字段校验
    var required = SHAPE_REQUIRED[kind] || [];
    for (var i = 0; i < required.length; i++) {
      if (!isPositiveNum(sh[required[i]])) {
        return { rounds: [], plan: plan,
          error: '形状 ' + kind + ' 缺少必填字段 ' + required[i] + '（必须是正数）' };
      }
    }

    // —— 接在留针上：走 attachSequence ——
    if (sh.attachTo && isPositiveNum(sh.attachTo.stitches)) {
      rounds = attachSequence({
        stitches: Math.round(sh.attachTo.stitches),
        color: color,
        heightCm: sh.heightCm,
        roundsPerCm: g.roundsPerCm
      });
      plan.attachTo = sh.attachTo;
      plan.totalRounds = rounds.length;
      return { rounds: rounds, plan: plan };
    }

    var maxStitches = nearest6(circumference(sh.diameterCm) * g.stPerCm);
    plan.maxStitches = maxStitches;
    plan.diameterCm = sh.diameterCm;
    plan.circumferenceCm = round2(circumference(sh.diameterCm));

    if (kind === 'flat-row') {
      // 片织：CH 起针 n -> 每行 n 针来回
      var n = Math.max(1, Math.round(sh.widthCm * g.stPerCm));
      var rows = Math.max(1, Math.round(sh.heightCm * g.roundsPerCm));
      rounds.push({
        r: 1, kind: 'row', color: color,
        stitchesIn: 0, stitchesOut: n,
        ops: [{ sym: 'CH', n: n }],
        note: ''
      });
      for (var ri = 1; ri < rows; ri++) {
        rounds.push({
          r: ri + 1, kind: 'row', color: color,
          stitchesIn: n, stitchesOut: n,
          ops: [{ sym: 'X', n: n }],
          note: ''
        });
      }
      for (var ki = 0; ki < rounds.length; ki++) {
        if (!rounds[ki].note) rounds[ki].note = compressOps(rounds[ki].ops);
      }
      plan.stitchesPerRow = n;
      plan.rows = rows;
      plan.totalRounds = rounds.length;
      return { rounds: rounds, plan: plan };
    }

    var incRounds = maxStitches / 6 - 1;
    plan.incRounds = incRounds;

    if (kind === 'sphere') {
      var totalRounds = Math.round(sh.diameterCm * g.roundsPerCm);
      var straight = Math.max(0, totalRounds - 2 * incRounds);
      plan.totalRoundsTarget = totalRounds;
      plan.straightRounds = straight;
      rounds = ringSequence({
        maxStitches: maxStitches, straightRounds: straight,
        doClose: sh.close !== 'open', color: color
      });
    } else if (kind === 'capsule') {
      var straightC = Math.max(1, Math.round((sh.heightCm - sh.diameterCm) * g.roundsPerCm));
      plan.straightRounds = straightC;
      rounds = ringSequence({
        maxStitches: maxStitches, straightRounds: straightC,
        doClose: sh.close !== 'open', color: color
      });
    } else if (kind === 'cylinder') {
      var straightY = Math.max(0, Math.round(sh.heightCm * g.roundsPerCm));
      plan.straightRounds = straightY;
      rounds = ringSequence({
        maxStitches: maxStitches, straightRounds: straightY,
        doClose: false, color: color
      });
    } else if (kind === 'cone') {
      // 锥形：环形起针 -> 递增到 max，开口不收（锥尖在起针端）
      rounds = ringSequence({
        maxStitches: maxStitches, straightRounds: 0,
        doClose: false, color: color
      });
    } else if (kind === 'flat-round') {
      // 圆片：纯递增到 maxStitches，不分收口
      rounds = ringSequence({
        maxStitches: maxStitches, straightRounds: 0,
        doClose: false, color: color
      });
    }

    plan.totalRounds = rounds.length;
    return { rounds: rounds, plan: plan };
  }

  /* ============================================================
   * §3.5 buildChart(toySpec) -> chart
   * ========================================================== */

  function normalizePalette(palette) {
    var out = [];
    var src = palette || [];
    for (var i = 0; i < src.length; i++) {
      var p = src[i] || {};
      out.push({
        id: p.id || ('C' + (i + 1)),
        name: p.name || ('色 ' + (i + 1)),
        hex: typeof p.hex === 'string' ? p.hex.toUpperCase() : '#CCCCCC',
        role: p.role || 'main',
        yarnMetersPerGram: isPositiveNum(p.yarnMetersPerGram) ? p.yarnMetersPerGram : 4.2
      });
    }
    return out;
  }

  /** 按 colorRounds 求某一圈的颜色。 */
  function colorForRound(colorRounds, defaultColor, r, totalRounds) {
    var list = colorRounds || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var from = isNum(c.from) ? c.from : 1;
      var to = isNum(c.to) ? c.to : 99;
      if (to >= 99) to = totalRounds;                  // 99 = 直到收口
      if (r >= from && r <= to) return c.color;
    }
    return defaultColor || null;
  }

  function buildChart(toySpec) {
    var spec = toySpec || {};
    var g = normalizeGauge(spec.gauge);
    var palette = normalizePalette(spec.palette);
    var errors = [];
    var warnings = [];

    if (!palette.length) {
      errors.push('palette 为空：至少需要 1 个线色');
    }
    var firstColor = palette.length ? palette[0].id : null;

    var parts = [];
    var specParts = spec.parts || [];
    if (!specParts.length) errors.push('parts 为空：至少需要 1 个部件');

    for (var pi = 0; pi < specParts.length; pi++) {
      var sp = specParts[pi] || {};
      var shape = sp.shape || {};
      shape = JSON.parse(JSON.stringify(shape));       // 不改调用方的对象
      if (!shape.color && sp.defaultColor) shape.color = sp.defaultColor;

      var rounds;
      var built = { plan: { manual: false } };

      // 手工圈序（软糖体 / 发条）：toySpec.parts[].rounds 优先于 shape 推导
      if (Array.isArray(sp.rounds) && sp.rounds.length) {
        rounds = JSON.parse(JSON.stringify(sp.rounds));
        built.plan = { manual: true, source: 'toySpec.rounds' };
        for (var mr = 0; mr < rounds.length; mr++) {
          var mrd = rounds[mr] || {};
          if (!isPositiveNum(mrd.r)) mrd.r = mr + 1;
          if (!mrd.kind) {
            mrd.kind = mr === 0 ? 'magic-ring' : 'round';
          }
          if (!mrd.ops) mrd.ops = [];
          if (!mrd.note) {
            var br = buildRound(mrd.ops);
            mrd.note = br.note;
          }
          // 若未声明针数，用 ops 反推（magic-ring / strand 的 stitchesIn 固定 0）
          if (!isNum(mrd.stitchesIn) || !isNum(mrd.stitchesOut)) {
            var mt = opsTotals(mrd.ops);
            if (mrd.kind === 'magic-ring' || mrd.kind === 'strand') {
              if (!isNum(mrd.stitchesIn)) mrd.stitchesIn = 0;
              if (!isNum(mrd.stitchesOut)) mrd.stitchesOut = mt.produce;
            } else {
              if (!isNum(mrd.stitchesIn)) mrd.stitchesIn = mt.consume;
              if (!isNum(mrd.stitchesOut)) mrd.stitchesOut = mt.produce;
            }
          }
          rounds[mr] = mrd;
        }
      } else {
        built = buildShape(shape, g);
        if (built.error) {
          errors.push('部件 "' + (sp.id || ('#' + pi)) + '"：' + built.error);
          parts.push({
            id: sp.id || ('part' + pi), name: sp.name || ('部件 ' + (pi + 1)),
            shape: shape, rounds: [], subtotal: { stitches: 0, rounds: 0 },
            plan: built.plan
          });
          continue;
        }
        rounds = built.rounds;
      }

      var totalRounds = rounds.length;

      // —— 配色 ——
      // 手工圈（toySpec.rounds）若圈上已写 color，保留；shape 推导圈仍走 colorRounds
      var manualColors = !!(built.plan && built.plan.manual);
      for (var ri = 0; ri < rounds.length; ri++) {
        if (manualColors && rounds[ri].color) continue;
        var col = colorForRound(sp.colorRounds, sp.defaultColor || firstColor,
                                rounds[ri].r, totalRounds);
        rounds[ri].color = col || firstColor;
      }

      // —— §3.4b 映射①：decor 装饰针迹 ——
      var decorSpecs = sp.decor || [];
      for (var di = 0; di < decorSpecs.length; di++) {
        var ds = decorSpecs[di] || {};
        var from = isNum(ds.roundFrom) ? ds.roundFrom : 1;
        var to = isNum(ds.roundTo) ? ds.roundTo : 99;
        if (to >= 99) to = totalRounds;
        var every = isPositiveNum(ds.every) ? Math.floor(ds.every) : 1;
        for (var rr = 0; rr < rounds.length; rr++) {
          var rd = rounds[rr];
          if (rd.r < from || rd.r > to) continue;
          var cnt = Math.floor(rd.stitchesOut / every);
          if (cnt * every !== rd.stitchesOut) {
            warnings.push('部件 "' + (sp.id || pi) + '" R' + rd.r +
              '：装饰针迹 every=' + every + ' 不能整除本圈 ' + rd.stitchesOut +
              ' 针，已向下取整为 ' + cnt + ' 个（R8 将不通过）');
          }
          var item = { kind: ds.kind || 'curly', every: every, count: cnt };
          if (isNum(ds.ch)) item.ch = ds.ch;
          if (typeof ds.note === 'string' && ds.note) item.note = ds.note;
          if (!rd.decor) rd.decor = [];
          rd.decor.push(item);
        }
      }

      // —— §3.4b 映射②：loopRounds 半针留针 ——
      var loopSpecs = sp.loopRounds || [];
      for (var li = 0; li < loopSpecs.length; li++) {
        var ls = loopSpecs[li] || {};
        for (var rj = 0; rj < rounds.length; rj++) {
          if (rounds[rj].r !== ls.round) continue;
          rounds[rj].loop = ls.loop || 'blo';
          if (Object.prototype.hasOwnProperty.call(ls, 'reservedFor')) {
            rounds[rj].reservedFor = ls.reservedFor;
          }
          break;
        }
      }

      var totalStitches = 0;
      for (var si = 0; si < rounds.length; si++) {
        totalStitches += Math.max(rounds[si].stitchesIn, rounds[si].stitchesOut);
      }

      parts.push({
        id: sp.id || ('part' + pi),
        name: sp.name || ('部件 ' + (pi + 1)),
        shape: shape,
        rounds: rounds,
        subtotal: { stitches: totalStitches, rounds: rounds.length },
        plan: built.plan,
        defaultColor: sp.defaultColor || firstColor
      });
    }

    var chart = {
      version: 1,
      name: spec.name || '未命名作品',
      createdAt: new Date().toISOString(),
      spec: spec,
      gauge: {
        stPerCm: g.stPerCm, roundsPerCm: g.roundsPerCm,
        hookMm: g.hookMm, yarn: g.yarn
      },
      palette: palette,
      parts: parts,
      buildOrder: Array.isArray(spec.buildOrder) && spec.buildOrder.length
        ? spec.buildOrder.slice()
        : defaultBuildOrder(parts),
      // 参考图热区：用户 toySpec.reference 优先，缺省自动按 Q 版正面布局
      reference: resolveReference(
        { parts: parts, palette: palette, spec: spec },
        spec.reference || null
      )
    };

    // 先算用线量（validateChart 的 summary 需要，且用线量不依赖校验结果）
    chart.yarn = yarnEstimate(chart, spec.yarnOptions || {});

    // —— 最终校验 ——
    var v = validateChart(chart);
    // 合并 buildChart 阶段的错误/警告（它们发生在 chart 字段成形之前）
    if (errors.length || warnings.length) {
      v.errors = errors.concat(v.errors);
      v.warnings = warnings.concat(v.warnings || []);
      v.ok = v.errors.length === 0;
    }
    chart.validation = v;

    return chart;
  }

  /** 缺省制作顺序：主体 -> 附着件 -> 装饰 -> 缝合。 */
  function defaultBuildOrder(parts) {
    var main = [], attached = [], decor = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.shape && p.shape.attachTo) attached.push(p);
      else main.push(p);
    }
    var order = [];
    for (var m = 0; m < main.length; m++) {
      order.push('钩 ' + main[m].name + '（' + main[m].rounds.length + ' 圈）');
    }
    for (var a = 0; a < attached.length; a++) {
      var at = attached[a].shape.attachTo || {};
      order.push('在 ' + (at.part || '主体') + ' R' + (at.round || '?') +
                 ' 的留针上钩 ' + attached[a].name);
    }
    var hasDecor = false;
    for (var d = 0; d < parts.length; d++) {
      for (var r = 0; r < parts[d].rounds.length; r++) {
        if (parts[d].rounds[r].decor && parts[d].rounds[r].decor.length) hasDecor = true;
      }
    }
    if (hasDecor) decor.push('在标记的圈上钩装饰针迹（卷曲针/枣针/花瓣针）');
    return order.concat(decor).concat([
      '塞棉：头部与躯干 7 分满，四肢少塞或不塞',
      '按顺序缝合各部件，压住领口与接缝',
      '绣五官、扫腮红，藏好所有线头'
    ]);
  }

  /* ============================================================
   * §3.2 validateChart —— R1..R9
   * ========================================================== */

  function validateChart(chart) {
    var errors = [];
    var warnings = [];
    var partReports = [];
    var ch = chart || {};
    var parts = ch.parts || [];
    var palette = ch.palette || [];

    var paletteIds = {};
    for (var p = 0; p < palette.length; p++) paletteIds[palette[p].id] = true;

    var totalRounds = 0;
    var totalStitches = 0;
    var colorChanges = 0;
    var decorCount = 0;       // 装饰针迹的「个体总数」（18 个卷曲针就记 18）
    var decorSegments = 0;    // 装饰声明的「段数」（一圈上挂 2 种装饰就记 2）
    var reservedLoops = 0;

    // 收集所有 attachTo 引用，用于 R9
    //   注意：parts 可能是稀疏数组或含 null，这里必须防住，
    //   校验器自己不能崩——崩了就等于把「图纸有错」伪装成「工具坏了」。
    var attachRefs = {};
    for (var ai = 0; ai < parts.length; ai++) {
      var ap = parts[ai];
      if (!ap || !ap.shape) continue;
      var at = ap.shape.attachTo;
      if (at) {
        var key = String(at.part) + '#' + String(at.round);
        attachRefs[key] = true;
      }
    }

    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi] || {};
      var rounds = part.rounds || [];
      var pErrs = [];
      var roundReports = [];

      if (!rounds.length) pErrs.push('部件 "' + (part.id || pi) + '" 没有任何圈');

      for (var ri = 0; ri < rounds.length; ri++) {
        var rd = rounds[ri] || {};
        var rErr = [];
        var isLast = ri === rounds.length - 1;
        var t = opsTotals(rd.ops);
        var c = t.counts;

        // 发条 strand：锁针倒回钩，不进环内守恒（以 note / ops 原文为准）
        var isStrand = rd.kind === 'strand';

        // R1 环内守恒：消耗总数 === stitchesIn
        //   例外：magic-ring 钩进环；strand 是 CH 起条，不消耗旧圈。
        if (!isStrand && rd.kind !== 'magic-ring' && t.consume !== rd.stitchesIn) {
          rErr.push('R1 环内守恒不成立：本圈针法共消耗 ' + t.consume +
                    ' 针，但 stitchesIn 声明为 ' + rd.stitchesIn +
                    '（差 ' + (t.consume - rd.stitchesIn) + '）');
        }

        // R2 产出正确：产出总数 === stitchesOut
        if (!isStrand && t.produce !== rd.stitchesOut) {
          rErr.push('R2 产出不正确：本圈针法共产出 ' + t.produce +
                    ' 针，但 stitchesOut 声明为 ' + rd.stitchesOut +
                    '（差 ' + (t.produce - rd.stitchesOut) + '）');
        }

        // R3 衔接守恒
        if (ri > 0) {
          var prev = rounds[ri - 1] || {};
          if (!isStrand && rd.stitchesIn !== prev.stitchesOut) {
            rErr.push('R3 衔接不成立：本圈消耗 ' + rd.stitchesIn +
                      ' 针，但上一圈产出 ' + prev.stitchesOut +
                      ' 针（差 ' + (rd.stitchesIn - prev.stitchesOut) + '）');
          }
        } else {
          // R4 起针
          if (rd.kind === 'magic-ring' && rd.stitchesIn !== 0) {
            rErr.push('R4 起针错误：环形起针的 stitchesIn 必须为 0，实际为 ' + rd.stitchesIn);
          }
          if (rd.kind === 'attach') {
            var need = part.shape && part.shape.attachTo && part.shape.attachTo.stitches;
            if (isPositiveNum(need) && rd.stitchesIn !== Math.round(need)) {
              rErr.push('R4 接针错误：attachTo.stitches 声明 ' + Math.round(need) +
                        '，但第 1 圈 stitchesIn 为 ' + rd.stitchesIn);
            }
          }
          if (rd.kind !== 'magic-ring' && rd.kind !== 'attach' && rd.kind !== 'strand' &&
              rd.stitchesIn !== 0) {
            rErr.push('R4 起针错误：第 1 圈 kind 为 "' + rd.kind +
                      '"，若为环形起针 stitchesIn 应为 0，若接留针应为 attach');
          }
          if (isStrand && rd.stitchesIn !== 0) {
            rErr.push('R4 发条起针：strand 的 stitchesIn 必须为 0');
          }
        }

        // R5 增减一致
        //   例外：magic-ring / strand；B 爆米花 1→1 不改变增减差。
        var delta = rd.stitchesOut - rd.stitchesIn;
        var incdec = (c.V || 0) + 2 * (c.W || 0) + (c.CH || 0)
                   - (c.A || 0) - 2 * (c.M || 0) - (c.SL || 0) - (c.K || 0);
        if (!isStrand && rd.kind !== 'magic-ring' && delta !== incdec) {
          rErr.push('R5 增减不一致：产出−消耗 = ' + delta +
                    '，但加针/减针解释的增量 = ' + incdec +
                    '（差 ' + (delta - incdec) + '）');
        }

        // R6 配色合法
        if (paletteIds && Object.keys(paletteIds).length) {
          if (!rd.color || !paletteIds[rd.color]) {
            rErr.push('R6 配色非法：color "' + String(rd.color) + '" 不在 palette 中');
          }
        }

        // R7 可钩性（软糖体允许 5X 起针；发条允许 0）
        if (typeof rd.stitchesOut !== 'number' || !isFinite(rd.stitchesOut) ||
            rd.stitchesOut !== Math.floor(rd.stitchesOut)) {
          rErr.push('R7 可钩性：stitchesOut 必须是整数，实际为 ' + rd.stitchesOut);
        } else if (rd.stitchesOut > 200) {
          rErr.push('R7 可钩性：stitchesOut = ' + rd.stitchesOut + ' 超过上限 200');
        } else if (rd.stitchesOut < 5) {
          // 例外：最后一圈允许 0；发条允许 0
          if (!(isLast && rd.stitchesOut === 0) && !(isStrand && rd.stitchesOut === 0)) {
            rErr.push('R7 可钩性：stitchesOut = ' + rd.stitchesOut +
                      ' 低于下限 5（软糖体 5X 起针；收口/发条允许 0）');
          }
        }

        // R8 装饰针迹
        if (rd.decor && rd.decor.length) {
          for (var dj = 0; dj < rd.decor.length; dj++) {
            var dec = rd.decor[dj] || {};
            var every = isPositiveNum(dec.every) ? dec.every : 1;
            var cnt = isNum(dec.count) ? dec.count : 0;
            if (cnt * every !== rd.stitchesOut) {
              rErr.push('R8 装饰针迹数量不匹配：' + cnt + ' 个 × every ' + every +
                        ' = ' + (cnt * every) + '，但本圈 ' + rd.stitchesOut + ' 针');
            }
            decorCount += cnt;
            decorSegments += 1;
          }
        }

        // R9 半针留针（警告级）
        if (rd.loop && rd.loop !== 'both') {
          reservedLoops++;
          var hasRef = attachRefs[String(part.id) + '#' + String(rd.r)];
          var explicitlyUnused = Object.prototype.hasOwnProperty.call(rd, 'reservedFor')
            && rd.reservedFor === null;
          if (!hasRef && !explicitlyUnused) {
            warnings.push('部件 "' + (part.id || pi) + '" R' + rd.r + ' 标记了 ' +
              (rd.loop === 'blo' ? '内半针' : '外半针') +
              ' 留针，但没有部件通过 attachTo 接上去（如确定不用，写 "reservedFor": null）');
          }
        }

        if (ri > 0) {
          var prevC = (rounds[ri - 1] || {}).color;
          if (prevC !== rd.color) colorChanges++;
        }

        totalRounds++;
        totalStitches += Math.max(rd.stitchesIn || 0, rd.stitchesOut || 0);

        roundReports.push({
          r: rd.r,
          consumed: t.consume,
          declaredIn: rd.stitchesIn,
          produced: t.produce,
          declaredOut: rd.stitchesOut,
          delta: delta,
          incdec: incdec,
          ok: rErr.length === 0,
          errors: rErr
        });

        for (var e = 0; e < rErr.length; e++) pErrs.push('部件 "' + (part.id || pi) +
          '" R' + rd.r + '：' + rErr[e]);
      }

      partReports.push({
        id: part.id || ('part' + pi),
        ok: pErrs.length === 0,
        errors: pErrs,
        rounds: roundReports
      });
      errors = errors.concat(pErrs);
    }

    // R10 接针一致性：attachTo 引用的圈必须真的存在、真的留了半针、针数对得上
    for (var qi = 0; qi < parts.length; qi++) {
      var qp = parts[qi] || {};
      var qat = qp.shape && qp.shape.attachTo;
      if (!qat) continue;

      var target = null;
      for (var qj = 0; qj < parts.length; qj++) {
        if (parts[qj] && parts[qj].id === qat.part) { target = parts[qj]; break; }
      }
      if (!target) {
        errors.push('部件 "' + qp.id + '" 的 attachTo.part = "' + qat.part +
          '" 找不到对应部件');
        continue;
      }

      var targetRound = null;
      for (var qk = 0; qk < (target.rounds || []).length; qk++) {
        if (target.rounds[qk].r === qat.round) { targetRound = target.rounds[qk]; break; }
      }
      if (!targetRound) {
        errors.push('部件 "' + qp.id + '" 的 attachTo 指向 ' + qat.part +
          ' 的 R' + qat.round + '，但该部件只有 ' + (target.rounds || []).length + ' 圈');
        continue;
      }

      // 引用的圈必须标记了留针
      if (!targetRound.loop || targetRound.loop === 'both') {
        warnings.push('部件 "' + qp.id + '" 接在 ' + qat.part + ' R' + qat.round +
          ' 上，但该圈没有标记 loop（内/外半针留针）——请确认这是有意的');
      }

      // 针数必须精确相等，差 1 针就缝不上
      if (isPositiveNum(qat.stitches) && targetRound.stitchesOut !== qat.stitches) {
        errors.push('R10 接针不一致：部件 "' + qp.id + '" 声明接 ' + qat.stitches +
          ' 针，但 ' + qat.part + ' R' + qat.round + ' 实际产出 ' +
          targetRound.stitchesOut + ' 针（差 ' +
          (qat.stitches - targetRound.stitchesOut) + '）');
      }
    }

    // R11 主体可钩性门槛：头 / 身 / 发帽最宽圈过窄时成品难钩、难塞棉
    var craftability = { hardFails: 0, softWarns: 0, checked: [] };
    for (var ci = 0; ci < parts.length; ci++) {
      var cp = parts[ci];
      if (!cp || !isPrimaryPart(cp)) continue;
      var maxOut = 0;
      var crs = cp.rounds || [];
      for (var cr = 0; cr < crs.length; cr++) {
        var so = crs[cr] && crs[cr].stitchesOut;
        if (typeof so === 'number' && so > maxOut) maxOut = so;
      }
      craftability.checked.push({ id: cp.id, maxStitches: maxOut });
      if (maxOut < CRAFT_FLOOR_HARD) {
        craftability.hardFails++;
        errors.push('R11 可钩性不足：主体部件 "' + (cp.id || ci) +
          '" 最宽圈仅 ' + maxOut + ' 针（硬下限 ' + CRAFT_FLOOR_HARD +
          '）。请加大 diameterCm / heightCm 后重算。');
      } else if (maxOut < CRAFT_FLOOR_SOFT) {
        craftability.softWarns++;
        warnings.push('R11 可钩性偏紧：主体部件 "' + (cp.id || ci) +
          '" 最宽圈 ' + maxOut + ' 针（建议 ≥ ' + CRAFT_FLOOR_SOFT +
          '）。成品会偏小、塞棉困难。');
      }
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      parts: partReports,
      summary: {
        parts: parts.length,
        rounds: totalRounds,
        totalStitches: totalStitches,
        colorChanges: colorChanges,
        decorCount: decorSegments,   // 装饰「段数」：一圈挂 2 种装饰记 2（契约 §5b.3 的 38 示例即此口径）
        decorStitches: decorCount,   // 装饰「个体总数」：18 个卷曲针记 18
        reservedLoops: reservedLoops,
        craftability: craftability
      }
    };
  }

  /** 头 / 身 / 发帽等主体部件（四肢、眼、荷叶边等小件不参与 R11） */
  function isPrimaryPart(part) {
    var id = String(part.id || '').toLowerCase();
    if (/^(head|body|hair)([-_]|$)/.test(id)) return true;
    if (id === '头' || id === '头部' || id === '躯干' || id === '身体' || id === '发帽') return true;
    return false;
  }

  /**
   * 还原度 / 特征完备性评估（契约 §3.11）
   * 只看 toySpec 或 chart（含内嵌 spec），回答「特征层是否够认出是谁」。
   */
  function assessIdentity(input) {
    var src = input || {};
    var spec = src.spec && typeof src.spec === 'object' ? src.spec : src;
    var palette = src.palette || spec.palette || [];
    var parts = src.parts || spec.parts || [];
    var heightCm = isPositiveNum(src.heightCm) ? src.heightCm
      : (isPositiveNum(spec.heightCm) ? spec.heightCm : null);
    var style = src.style || spec.style || 'chibi';

    var roles = {};
    for (var i = 0; i < palette.length; i++) {
      if (palette[i] && palette[i].role) roles[palette[i].role] = palette[i];
    }

    var partIds = {};
    var hasEye = false, hasHairPart = false, hasHead = false, hasBody = false;
    var accentParts = [];
    var headDiam = null, bodyHeight = null;

    for (var j = 0; j < parts.length; j++) {
      var p = parts[j];
      if (!p) continue;
      var pid = String(p.id || '');
      partIds[pid] = p;
      var low = pid.toLowerCase();
      if (low === 'head' || low === '头' || low === '头部') {
        hasHead = true;
        if (p.shape && isPositiveNum(p.shape.diameterCm)) headDiam = p.shape.diameterCm;
      }
      if (low === 'body' || low === '躯干' || low === '身体') {
        hasBody = true;
        // 软糖体：头身一体，body 同时计为 head
        if (style === 'softcandy' ||
            (p.shape && (p.shape.kind === 'softcandy' || /一体|软糖/.test(String(p.name || ''))))) {
          hasHead = true;
        }
        if (p.shape && isPositiveNum(p.shape.heightCm)) bodyHeight = p.shape.heightCm;
        else if (p.shape && isPositiveNum(p.shape.diameterCm)) bodyHeight = p.shape.diameterCm;
      }
      if (/^hair|发帽|刘海|bangs/.test(low) || /发/.test(pid)) hasHairPart = true;
      if (/^eye|眼/.test(low) || /眼/.test(pid)) hasEye = true;
      if (/^(hat|horn|ear|bow|wing|tail|accessory|帽|角|耳|结|翅|尾)/.test(low)) {
        accentParts.push(pid);
      }
    }

    var checks = [];
    function pushCheck(id, ok, detail) {
      checks.push({ id: id, ok: !!ok, detail: detail });
    }

    pushCheck('role-hair', !!roles.hair, roles.hair
      ? 'hair=' + roles.hair.hex : 'palette 缺少 role=hair');
    pushCheck('role-main', !!roles.main, roles.main
      ? 'main=' + roles.main.hex : 'palette 缺少 role=main');
    pushCheck('role-eye', !!roles.eye, roles.eye
      ? 'eye=' + roles.eye.hex : 'palette 缺少 role=eye');
    pushCheck('role-skin', !!roles.skin, roles.skin
      ? 'skin=' + roles.skin.hex : 'palette 缺少 role=skin');
    pushCheck('part-head', hasHead, hasHead ? '有头部部件' : '缺少 head 部件');
    pushCheck('part-body', hasBody, hasBody ? '有躯干部件' : '缺少 body 部件');
    pushCheck('part-hair', hasHairPart, hasHairPart ? '有发帽/发片' : '缺少头发部件（发帽/刘海）');
    pushCheck('part-eye', hasEye, hasEye ? '有眼睛部件' : '缺少眼睛部件（识别级五官）');

    var ratioOk = true;
    var ratioDetail = '未提供头径/身长，跳过比例检查';
    if (headDiam && bodyHeight) {
      var ratio = bodyHeight / headDiam;
      if (style === 'chibi') {
        ratioOk = ratio >= 0.5 && ratio <= 1.0;
        ratioDetail = '头身比 body/head=' + (Math.round(ratio * 100) / 100) +
          '（chibi 期望约 0.6–0.9）';
      } else {
        ratioOk = ratio >= 0.8 && ratio <= 2.2;
        ratioDetail = '头身比 body/head=' + (Math.round(ratio * 100) / 100) +
          '（realistic 期望约 1.0–1.9）';
      }
    }
    pushCheck('proportion', ratioOk, ratioDetail);

    if (heightCm) {
      var hOk = heightCm >= 8 && heightCm <= 30;
      pushCheck('height', hOk, '成品高 ' + heightCm + ' cm' +
        (hOk ? '' : '（建议 8–30 cm）'));
    } else {
      pushCheck('height', true, '未声明 heightCm（可用默认 14）');
    }

    pushCheck('accent-optional', true, accentParts.length
      ? '标志配件：' + accentParts.join(', ')
      : '无独立标志配件（若角色有帽/角/耳机等应补部件）');

    var required = ['role-hair', 'role-main', 'role-eye', 'role-skin',
      'part-head', 'part-body', 'part-hair', 'part-eye', 'proportion'];
    var failed = checks.filter(function (c) {
      return required.indexOf(c.id) >= 0 && !c.ok;
    });
    var score = Math.round(100 * (required.length - failed.length) / required.length);

    var notes = [];
    if (failed.length) {
      notes.push('识别级特征不齐：' + failed.map(function (f) { return f.id; }).join(', '));
    } else {
      notes.push('结构级 + 识别级特征齐备；肖像级（表情细节/渐变/姿态）仍属合法损失');
    }
    if (!roles.blush) notes.push('未声明 blush；非表情卖点角色可省略');

    return {
      ok: failed.length === 0,
      score: score,
      style: style,
      heightCm: heightCm,
      checks: checks,
      missing: failed.map(function (f) { return f.id; }),
      accents: accentParts,
      notes: notes
    };
  }

  /* ============================================================
   * §3.6 yarnEstimate
   * ========================================================== */

  function yarnEstimate(chart, opts) {
    var o = opts || {};
    var ch = chart || {};
    var metersPerStitch = isPositiveNum(o.metersPerStitch) ? o.metersPerStitch : 0.025;
    var bufferRatio = isNum(o.bufferRatio) ? o.bufferRatio : 0.25;

    var palette = ch.palette || [];
    var mpgByColor = {};
    for (var i = 0; i < palette.length; i++) {
      mpgByColor[palette[i].id] = isPositiveNum(palette[i].yarnMetersPerGram)
        ? palette[i].yarnMetersPerGram : 4.2;
    }

    var parts = ch.parts || [];
    var perPart = [];
    var colorStitches = {};
    var totalStitches = 0;

    for (var p = 0; p < parts.length; p++) {
      var part = parts[p] || {};
      var rounds = part.rounds || [];
      var pStitches = 0;
      for (var r = 0; r < rounds.length; r++) {
        var rd = rounds[r] || {};
        // 实际钩织的针数：取消耗与产出的较大者
        //   X 圈: 两者相等;  V 圈: 产出更大（一针里钩两针）;
        //   A 圈: 消耗更大（两针并一针要动两针）; 环形起针: 产出 6
        var worked = Math.max(rd.stitchesIn || 0, rd.stitchesOut || 0);
        pStitches += worked;
        var col = rd.color || (palette[0] && palette[0].id);
        colorStitches[col] = (colorStitches[col] || 0) + worked;
      }
      totalStitches += pStitches;
      perPart.push({
        id: part.id,
        stitches: pStitches,
        meters: round1(pStitches * metersPerStitch),
        grams: round1((pStitches * metersPerStitch) / 4.2)
      });
    }

    var perColor = [];
    for (var cid in colorStitches) {
      if (!Object.prototype.hasOwnProperty.call(colorStitches, cid)) continue;
      var st = colorStitches[cid];
      var m = st * metersPerStitch;
      var mpg = mpgByColor[cid] || 4.2;
      perColor.push({
        color: cid,
        stitches: st,
        meters: round1(m),
        grams: round1(m / mpg)
      });
    }
    perColor.sort(function (a, b) { return b.stitches - a.stitches; });

    // 修正 perPart 的 grams 用各自部件主色的 mpg
    for (var pp = 0; pp < perPart.length; pp++) {
      var pid = perPart[pp].id;
      var ppart = null;
      for (var q = 0; q < parts.length; q++) if (parts[q].id === pid) ppart = parts[q];
      var rc = (ppart && ppart.rounds && ppart.rounds[0] && ppart.rounds[0].color) || null;
      var mpgPart = (rc && mpgByColor[rc]) || 4.2;
      perPart[pp].grams = round1(perPart[pp].meters / mpgPart);
    }

    // 合计必须与逐部件显示值一致：
    //   用户看到的是 perPart 各自四舍五入后的数字，把它们加起来应当等于 total，
    //   否则页面上「各部件相加 ≠ 总计」会被当成图纸错误。
    //   所以 total 由已取整的 perPart 累加而来，而不是另算一遍。
    var totalMetersRaw = 0, totalGramsRaw = 0;
    for (var pmet = 0; pmet < perPart.length; pmet++) {
      totalMetersRaw += perPart[pmet].meters;
      totalGramsRaw += perPart[pmet].grams;
    }
    var totalMeters = round1(totalMetersRaw);
    var totalGrams = round1(totalGramsRaw);

    return {
      perPart: perPart,
      perColor: perColor,
      total: { stitches: totalStitches, meters: totalMeters, grams: totalGrams },
      withBuffer: {
        meters: round1(totalMeters * (1 + bufferRatio)),
        grams: round1(totalGrams * (1 + bufferRatio))
      },
      bufferRatio: bufferRatio,
      constants: {
        metersPerStitch: metersPerStitch,
        note: '单短针用线按 2.5cm 计（2.5mm 钩针 + 4ply 棉线）；实际用量随手劲浮动，已含 ' +
              Math.round(bufferRatio * 100) + '% 损耗缓冲'
      }
    };
  }

  /* ============================================================
   * §3.7 circleLayout
   * ========================================================== */

  function circleLayout(part, opts) {
    var o = opts || {};
    var rounds = (part && part.rounds) || [];
    var maxStitches = 1;
    for (var i = 0; i < rounds.length; i++) {
      if (rounds[i].stitchesOut > maxStitches) maxStitches = rounds[i].stitchesOut;
    }
    var out = [];
    for (var r = 0; r < rounds.length; r++) {
      var rd = rounds[r];
      var n = Math.max(0, Math.round(rd.stitchesOut || 0));
      var radius = n > 0 ? Math.sqrt(n / maxStitches) : 0;
      var stitches = [];
      for (var k = 0; k < n; k++) {
        // 起始角 -π/2（12 点方向），顺时针
        var angle = -Math.PI / 2 + (2 * Math.PI * k) / n;
        stitches.push({
          i: k,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle)
        });
      }
      out.push({ r: rd.r, radius: radius, stitches: stitches });
    }
    return out;
  }

  /* ============================================================
   * §3.8 toNotation
   * ========================================================== */

  function decorSuffix(rd) {
    if (!rd.decor || !rd.decor.length) return '';
    var names = { curly: '卷曲针', bobble: '枣针', petal: '花瓣针', picot: '狗牙针' };
    var segs = [];
    for (var i = 0; i < rd.decor.length; i++) {
      var d = rd.decor[i];
      var nm = names[d.kind] || d.kind;
      var s = String(d.count) + '×' + nm;
      if (isNum(d.ch)) s += '(' + d.ch + 'CH)';
      segs.push(s);
    }
    return '  ⟡ ' + segs.join('、');
  }

  function toNotation(part) {
    var rounds = (part && part.rounds) || [];
    var out = [];
    for (var i = 0; i < rounds.length; i++) {
      var rd = rounds[i];
      var body;
      if (rd.kind === 'magic-ring') {
        body = '环形起针 ' + compressOps(rd.ops);
      } else if (rd.kind === 'attach') {
        body = '接留针 ' + compressOps(rd.ops);
      } else if (rd.kind === 'strand') {
        body = '发条 ' + (rd.note && rd.note.indexOf('CH') >= 0 ? rd.note : compressOps(rd.ops));
      } else if (rd.kind === 'row') {
        body = (i === 0 ? '起针 ' : '') + compressOps(rd.ops);
      } else {
        body = compressOps(rd.ops);
      }
      var tail = '';
      if (rd.kind !== 'magic-ring' && rd.kind !== 'attach' && rd.kind !== 'row' &&
          rd.kind !== 'strand') {
        tail = ' = ' + rd.stitchesOut;
      }
      var loopTag = '';
      if (rd.loop === 'blo') loopTag = ' ［内半针］';
      else if (rd.loop === 'flo') loopTag = ' ［外半针］';
      out.push('R' + rd.r + ' ' + body + tail + loopTag + decorSuffix(rd));
    }
    return out;
  }

  /* ============================================================
   * §3.9 / §3.10 颜色量化
   * ========================================================== */

  /** 确定性 PRNG（mulberry32）。 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    var v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  /** sRGB -> CIELAB (D65) */
  function rgbToLab(r, g, b) {
    var lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    var x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    var y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    var z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    var xn = 0.95047, yn = 1.0, zn = 1.08883;
    var fx = fxyz(x / xn), fy = fxyz(y / yn), fz = fxyz(z / zn);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function fxyz(t) {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
  }

  /** CIELAB -> sRGB */
  function labToRgb(L, A, B) {
    var fy = (L + 16) / 116;
    var fx = fy + A / 500;
    var fz = fy - B / 200;
    var xn = 0.95047, yn = 1.0, zn = 1.08883;
    var x = xn * finv(fx), y = yn * finv(fy), z = zn * finv(fz);
    var rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    var gl = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
    var bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    return { r: linearToSrgb(rl), g: linearToSrgb(gl), b: linearToSrgb(bl) };
  }

  function finv(t) {
    var t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  }

  function toHex(r, g, b) {
    function h(v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase();
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + h(r) + h(g) + h(b);
  }

  /**
   * 把像素统一成 [{r,g,b}]。支持的输入：
   *   · [[r,g,b], ...]            —— 数组三元组
   *   · [r,g,b, r,g,b, ...]       —— 扁平数组
   *   · [{r,g,b}, ...]            —— 已经是归一化形态（必须幂等！）
   *
   * 幂等性是硬要求：summarizePhotoRegions 会先归一化再交给 quantize，
   * 而 quantize 内部还会再归一化一次。早期版本不认对象数组，第二次调用
   * 会把 {r,g,b} 当成扁平数组取值 → undefined → NaN → 颜色全成 "#NANNANNAN"。
   */
  function normalizePixels(pixels) {
    var out = [];
    if (!pixels || !pixels.length) return out;
    var first = pixels[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      // 已经是 {r,g,b} 形态：原样复制（幂等）
      for (var k = 0; k < pixels.length; k++) {
        var o = pixels[k];
        if (!o || typeof o !== 'object') continue;
        out.push({ r: o.r, g: o.g, b: o.b });
      }
    } else if (Array.isArray(first)) {
      for (var i = 0; i < pixels.length; i++) {
        var p = pixels[i];
        out.push({ r: p[0], g: p[1], b: p[2] });
      }
    } else {
      for (var j = 0; j + 2 < pixels.length; j += 3) {
        out.push({ r: pixels[j], g: pixels[j + 1], b: pixels[j + 2] });
      }
    }
    return out;
  }

  function dist2Lab(a, b) {
    var dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
    return dL * dL + da * da + db * db;
  }

  /**
   * §3.9 quantize(pixels, k, opts) -> { palette: [{hex,count,ratio}] }
   * k-means++ / CIELAB / 固定种子 42 -> 确定性输出。
   */
  function quantize(pixels, k, opts) {
    var o = opts || {};
    var seed = isNum(o.seed) ? o.seed : 42;
    var maxIter = isNum(o.maxIter) ? o.maxIter : 30;
    var px = normalizePixels(pixels);
    var kk = isPositiveNum(k) ? Math.floor(k) : 8;

    if (!px.length) return { palette: [] };
    if (kk > px.length) kk = px.length;

    // 转 Lab
    var labs = new Array(px.length);
    for (var i = 0; i < px.length; i++) {
      var p = px[i];
      labs[i] = rgbToLab(p.r, p.g, p.b);
    }

    var rnd = mulberry32(seed);

    // k-means++ 初始化
    var centers = [];
    var firstIdx = Math.floor(rnd() * labs.length);
    centers.push({ L: labs[firstIdx].L, a: labs[firstIdx].a, b: labs[firstIdx].b });

    while (centers.length < kk) {
      var d2 = new Array(labs.length);
      var sum = 0;
      for (var di = 0; di < labs.length; di++) {
        var best = Infinity;
        for (var ci = 0; ci < centers.length; ci++) {
          var dd = dist2Lab(labs[di], centers[ci]);
          if (dd < best) best = dd;
        }
        d2[di] = best;
        sum += best;
      }
      if (sum <= 0) {
        // 所有点重合，补重复中心
        centers.push({ L: centers[0].L, a: centers[0].a, b: centers[0].b });
        continue;
      }
      var target = rnd() * sum;
      var acc = 0, pick = labs.length - 1;
      for (var si = 0; si < d2.length; si++) {
        acc += d2[si];
        if (acc >= target) { pick = si; break; }
      }
      centers.push({ L: labs[pick].L, a: labs[pick].a, b: labs[pick].b });
    }

    // 迭代
    var assign = new Array(labs.length);
    for (var it = 0; it < maxIter; it++) {
      var changed = false;
      for (var ai = 0; ai < labs.length; ai++) {
        var bi = 0, bd = Infinity;
        for (var cj = 0; cj < centers.length; cj++) {
          var ddd = dist2Lab(labs[ai], centers[cj]);
          if (ddd < bd) { bd = ddd; bi = cj; }
        }
        if (assign[ai] !== bi) { assign[ai] = bi; changed = true; }
      }
      // 重算中心
      var acc2 = [];
      for (var c0 = 0; c0 < centers.length; c0++) acc2.push({ L: 0, a: 0, b: 0, n: 0 });
      for (var pi2 = 0; pi2 < labs.length; pi2++) {
        var cluster = assign[pi2];
        var ac = acc2[cluster];
        ac.L += labs[pi2].L; ac.a += labs[pi2].a; ac.b += labs[pi2].b; ac.n++;
      }
      for (var c1 = 0; c1 < centers.length; c1++) {
        var a1 = acc2[c1];
        if (a1.n > 0) {
          centers[c1] = { L: a1.L / a1.n, a: a1.a / a1.n, b: a1.b / a1.n };
        }
      }
      if (!changed && it > 0) break;
    }

    // 统计
    var counts = new Array(centers.length);
    for (var ci2 = 0; ci2 < centers.length; ci2++) counts[ci2] = 0;
    for (var pj = 0; pj < assign.length; pj++) counts[assign[pj]]++;

    var palette = [];
    for (var ck = 0; ck < centers.length; ck++) {
      var rgb = labToRgb(centers[ck].L, centers[ck].a, centers[ck].b);
      palette.push({
        hex: toHex(rgb.r, rgb.g, rgb.b),
        count: counts[ck],
        ratio: counts[ck] / labs.length
      });
    }
    palette.sort(function (x, y) {
      if (y.count !== x.count) return y.count - x.count;
      return x.hex < y.hex ? -1 : (x.hex > y.hex ? 1 : 0);   // 平手按 hex 定序，保证确定性
    });
    return { palette: palette };
  }

  /** sRGB -> HSL（用于判断肤色/暗色） */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  function parseHex(hex) {
    var s = String(hex || '').replace('#', '');
    if (s.length !== 6) return { r: 128, g: 128, b: 128 };
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    };
  }

  function hexToLab(hex) {
    var c = parseHex(hex);
    return rgbToLab(c.r, c.g, c.b);
  }

  function hexHsl(hex) {
    var c = parseHex(hex);
    return rgbToHsl(c.r, c.g, c.b);
  }

  /**
   * §3.10 summarizePhotoRegions(pixels, w, h, k)
   * 把图像按 k 色量化，给出全局占比 + 上/中/下三段占比 + 发/肤/衣建议色。
   */
  function summarizePhotoRegions(pixels, w, h, k, opts) {
    var kk = isPositiveNum(k) ? Math.floor(k) : 8;
    var px = normalizePixels(pixels);
    var width = isPositiveNum(w) ? Math.floor(w) : 0;
    var height = isPositiveNum(h) ? Math.floor(h) : 0;

    if (!width || !height) {
      // 没给尺寸时，退化为正方形估算
      var side = Math.max(1, Math.floor(Math.sqrt(px.length)));
      width = side; height = side;
    }

    var q = quantize(px, kk, opts);
    var dominant = q.palette;

    // 建立「最近中心」映射，用来给每个像素分带
    var dominantLabs = [];
    for (var d = 0; d < dominant.length; d++) dominantLabs.push(hexToLab(dominant[d].hex));

    function nearestIndex(p) {
      var lab = rgbToLab(p.r, p.g, p.b);
      var bi = 0, bd = Infinity;
      for (var i = 0; i < dominantLabs.length; i++) {
        var dd = dist2Lab(lab, dominantLabs[i]);
        if (dd < bd) { bd = dd; bi = i; }
      }
      return bi;
    }

    // 三段：上/中/下，各占画面高度 1/3
    var bandCounts = [{}, {}, {}];
    var bandTotals = [0, 0, 0];
    var total = Math.min(px.length, width * height);

    for (var i2 = 0; i2 < total; i2++) {
      var row = Math.floor(i2 / width);
      var band = Math.min(2, Math.floor((row / height) * 3));
      var idx = nearestIndex(px[i2]);
      bandCounts[band][idx] = (bandCounts[band][idx] || 0) + 1;
      bandTotals[band]++;
    }

    function bandSummary(band) {
      var arr = [];
      for (var idx2 in bandCounts[band]) {
        if (!Object.prototype.hasOwnProperty.call(bandCounts[band], idx2)) continue;
        var cnt = bandCounts[band][idx2];
        arr.push({
          hex: dominant[idx2].hex,
          ratio: bandTotals[band] ? cnt / bandTotals[band] : 0
        });
      }
      arr.sort(function (a, b) { return b.ratio - a.ratio; });
      return arr;
    }

    var bands = {
      top: bandSummary(0),
      middle: bandSummary(1),
      bottom: bandSummary(2)
    };

    // —— 启发式建议 ——
    //
    // 关键认识：单个 k-means 簇只是「一个颜色」，而人物特征是「一个色系」。
    // 绿头发会被切成 3–4 个簇（亮绿/中绿/暗绿），每个簇占比都不大；
    // 而背景墙往往就是一个大簇。按单簇比占比，绿色会输给墙。
    // 所以这里先按**色相族**把簇合并，再在族层面判断，才符合人的直觉。
    //
    // 注意：这只是「建议」，不是判定。真正的发/肤/衣判断由模型看照片完成
    // （见 skills/photo-to-toy 的交叉判定表）。这里的目标是「别给误导性的建议」。

    function hueOf(hex) { return hexHsl(hex).h; }

    /** 色相族：暖红/橙黄/绿/青绿/蓝/紫/洋红/中性。中性按明度再分。 */
    function hueFamily(hex) {
      var hsl = hexHsl(hex);
      if (hsl.s < 0.15) {
        if (hsl.l > 0.72) return 'neutral-light';   // 白墙、浅灰、米白背景
        if (hsl.l < 0.22) return 'neutral-dark';    // 黑发、深色影
        return 'neutral-mid';
      }
      var h = hsl.h;
      if (h < 20 || h >= 330) return 'red';
      if (h < 45) return 'orange';
      if (h < 70) return 'yellow';
      if (h < 170) return 'green';
      if (h < 200) return 'cyan';
      if (h < 260) return 'blue';
      if (h < 300) return 'purple';
      return 'magenta';
    }

    /** 把一段（top/middle/bottom）的簇按色相族聚合。 */
    function familyAggregate(list) {
      var fam = {};
      for (var i = 0; i < list.length; i++) {
        var f = hueFamily(list[i].hex);
        if (!fam[f]) fam[f] = { family: f, ratio: 0, members: [] };
        fam[f].ratio += list[i].ratio;
        fam[f].members.push(list[i]);
      }
      var arr = [];
      for (var k in fam) if (Object.prototype.hasOwnProperty.call(fam, k)) arr.push(fam[k]);
      // 族内成员按占比降序，取代表色 = 族内占比最大的那个簇
      for (var j = 0; j < arr.length; j++) {
        arr[j].members.sort(function (a, b) { return b.ratio - a.ratio; });
        arr[j].hex = arr[j].members[0].hex;
      }
      arr.sort(function (a, b) { return b.ratio - a.ratio; });
      return arr;
    }

    var topFam = familyAggregate(bands.top);
    var midFam = familyAggregate(bands.middle);
    var botFam = familyAggregate(bands.bottom);

    // 中性浅色族 = 背景墙嫌疑（白墙/浅灰/米色布景）
    function isBgFamily(f) {
      return f.family === 'neutral-light' || f.family === 'neutral-mid';
    }

    // 头发：上段里非背景、占比最大的色族
    var hair = null;
    for (var t = 0; t < topFam.length; t++) {
      if (isBgFamily(topFam[t])) continue;
      hair = topFam[t].hex;
      break;
    }
    // 上段整段都是背景（近景全身照常见）：改用整图里最有辨识度的非背景色族
    if (!hair) {
      var allFam = topFam.concat(midFam, botFam).filter(function (f) { return !isBgFamily(f); });
      allFam.sort(function (a, b) { return b.ratio - a.ratio; });
      if (allFam.length) hair = allFam[0].hex;
      else if (topFam.length) hair = topFam[0].hex;
    }

    // 肤色：中段里「明度偏高、饱和度中低」的**暖色**族。
    // 中性族（灰/白/黑）一律不参与——那是墙、地板、虚化背景，不是皮肤。
    var skin = null, skinScore = -Infinity;
    for (var m = 0; m < midFam.length; m++) {
      if (isBgFamily(midFam[m])) continue;
      var hxM = midFam[m].hex;
      var hslM = hexHsl(hxM);
      if (hslM.l < 0.30) continue;
      var warm = (hslM.h <= 70 || hslM.h >= 320) ? 1 : 0;
      if (!warm) continue;                       // 冷色族不可能是皮肤
      var scoreM = hslM.l * 1.8 - Math.abs(hslM.s - 0.28) * 2.2
                 + warm * 1.2 + midFam[m].ratio * 1.2;
      if (scoreM > skinScore) { skinScore = scoreM; skin = hxM; }
    }
    // 中段没有暖色族（如侧脸/背影）：放宽到全图的暖色族
    if (!skin) {
      var warmAll = topFam.concat(midFam, botFam).filter(function (f) {
        if (isBgFamily(f)) return false;
        var hh = hexHsl(f.hex);
        return hh.l >= 0.30 && (hh.h <= 70 || hh.h >= 320);
      });
      warmAll.sort(function (a, b) { return b.ratio - a.ratio; });
      if (warmAll.length) skin = warmAll[0].hex;
    }

    // 衣服：中段+下段合计占比最大、非肤色、非背景浅色的色族
    var clothFam = {};
    var combined = midFam.concat(botFam);
    for (var ci = 0; ci < combined.length; ci++) {
      var cHex = combined[ci].hex;
      if (cHex === skin) continue;
      if (isBgFamily(combined[ci])) continue;
      if (!clothFam[cHex]) clothFam[cHex] = 0;
      clothFam[cHex] += combined[ci].ratio;
    }
    var cloth = null, clothBest = -Infinity;
    for (var cx in clothFam) {
      if (clothFam[cx] > clothBest) { clothBest = clothFam[cx]; cloth = cx; }
    }

    // 兜底：三层都必须在有主导色时给出非空 hex，否则调用方（模板）会渲染成空白。
    // 优先级：本层推断 → 全局主导色里第一个互不相同的 → 主导色首位。
    function fallbackHex(notThese) {
      for (var f = 0; f < dominant.length; f++) {
        var h2 = dominant[f].hex;
        var clash = false;
        for (var n = 0; n < notThese.length; n++) if (notThese[n] === h2) clash = true;
        if (!clash) return h2;
      }
      return dominant.length ? dominant[0].hex : null;
    }
    if (!hair) hair = fallbackHex([skin, cloth]);
    if (!skin) skin = fallbackHex([hair]);
    if (!cloth) cloth = fallbackHex([hair, skin]);

    return {
      width: width,
      height: height,
      dominant: dominant,
      bands: bands,
      suggested: { hair: hair, skin: skin, cloth: cloth }
    };
  }

  /**
   * §3.12 layoutPartMap(chart|parts) → 参考图部件热区
   * 在统一 Q 版正面素体坐标系（宽 100 × 高 140）上，为每个部件给出椭圆热区。
   * 坐标为相对值，可叠在素体示意图或参考照片上。
   */
  function layoutPartMap(input) {
    var parts = [];
    var palette = [];
    if (Array.isArray(input)) {
      parts = input;
    } else if (input && typeof input === 'object') {
      parts = input.parts || [];
      palette = input.palette || (input.spec && input.spec.palette) || [];
    }
    var colorById = {};
    for (var i = 0; i < palette.length; i++) {
      if (palette[i] && palette[i].id) colorById[palette[i].id] = palette[i].hex;
    }

    // 预置 Q 版正面布局（归一化到 100×140）。未知 id 落到侧栏清单。
    var PRESET = {
      'hat-top':   { cx: 50, cy: 10, rx: 7,  ry: 6,  z: 90 },
      'hat':       { cx: 50, cy: 20, rx: 16, ry: 10, z: 80 },
      'hat-brim':  { cx: 50, cy: 28, rx: 34, ry: 7,  z: 70 },
      'hair-cap':  { cx: 50, cy: 40, rx: 23, ry: 18, z: 40 },
      'hair-back': { cx: 50, cy: 42, rx: 24, ry: 20, z: 35 },
      'bangs':     { cx: 50, cy: 44, rx: 18, ry: 9,  z: 55 },
      'head':      { cx: 50, cy: 50, rx: 18, ry: 18, z: 50 },
      'eye':       { cx: 50, cy: 50, rx: 12, ry: 5,  z: 60 },
      'body':      { cx: 50, cy: 82, rx: 15, ry: 20, z: 30 },
      'hem':       { cx: 50, cy: 98, rx: 22, ry: 8,  z: 25 },
      'arm':       { cx: 28, cy: 78, rx: 7,  ry: 16, z: 45, mirror: { cx: 72, cy: 78, rx: 7, ry: 16 } },
      'leg':       { cx: 42, cy: 112, rx: 7, ry: 14, z: 20, mirror: { cx: 58, cy: 112, rx: 7, ry: 14 } }
    };

    var regions = [];
    var extras = 0;
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi];
      if (!p || !p.id) continue;
      var id = String(p.id);
      var low = id.toLowerCase();
      var preset = PRESET[low] || PRESET[id] || null;
      // 宽松匹配：hair-* / hat-*
      if (!preset && /^hair/.test(low)) preset = PRESET['hair-cap'];
      if (!preset && /^hat/.test(low) && low.indexOf('brim') >= 0) preset = PRESET['hat-brim'];
      if (!preset && /^hat/.test(low) && low.indexOf('top') >= 0) preset = PRESET['hat-top'];
      if (!preset && /^hat/.test(low)) preset = PRESET['hat'];
      if (!preset && /^(head|头)/.test(low)) preset = PRESET['head'];
      if (!preset && /^(body|躯|身)/.test(low)) preset = PRESET['body'];
      if (!preset && /^(arm|手|臂)/.test(low)) preset = PRESET['arm'];
      if (!preset && /^(leg|腿|脚)/.test(low)) preset = PRESET['leg'];
      if (!preset && /^(eye|眼)/.test(low)) preset = PRESET['eye'];
      if (!preset && /^(bang|刘海)/.test(low)) preset = PRESET['bangs'];
      if (!preset && /^(hem|摆)/.test(low)) preset = PRESET['hem'];

      var color = null;
      if (p.defaultColor && colorById[p.defaultColor]) color = colorById[p.defaultColor];
      else if (p.rounds && p.rounds.length && colorById[p.rounds[0].color]) {
        color = colorById[p.rounds[0].color];
      }

      if (preset) {
        regions.push({
          partId: id,
          name: p.name || id,
          color: color,
          shape: 'ellipse',
          cx: preset.cx, cy: preset.cy, rx: preset.rx, ry: preset.ry,
          z: preset.z || 10,
          mirror: preset.mirror || null
        });
      } else {
        // 未知配件：放到右侧清单热区
        var ey = 18 + extras * 14;
        extras++;
        regions.push({
          partId: id,
          name: p.name || id,
          color: color,
          shape: 'ellipse',
          cx: 88, cy: ey, rx: 9, ry: 5,
          z: 15,
          mirror: null,
          side: true
        });
      }
    }

    regions.sort(function (a, b) { return (a.z || 0) - (b.z || 0); });

    return {
      width: 100,
      height: 140,
      unit: 'normalized',
      kind: 'chibi-front',
      regions: regions
    };
  }

  /** 合并用户自定义 reference 与自动布局（用户 regions / 画布尺寸优先） */
  function resolveReference(chartOrSpec, existing) {
    var base = existing && typeof existing === 'object' ? existing : {};
    var map = layoutPartMap(chartOrSpec);
    var userRegions = Array.isArray(base.regions) && base.regions.length ? base.regions : null;
    var width = isPositiveNum(base.width) ? base.width : map.width;
    var height = isPositiveNum(base.height) ? base.height : map.height;
    return {
      caption: base.caption || '部件对照 · 点击定位到图解',
      image: typeof base.image === 'string' ? base.image : null,
      imageMime: base.imageMime || null,
      width: width,
      height: height,
      unit: base.unit || map.unit,
      kind: userRegions ? (base.kind || 'custom') : map.kind,
      regions: userRegions || map.regions
    };
  }

  /* ============================================================
   * 导出
   * ========================================================== */
  return {
    VERSION: VERSION,
    OPS: OPS,
    DEFAULT_GAUGE: DEFAULT_GAUGE,
    SHAPE_KINDS: SHAPE_KINDS,
    SHAPE_REQUIRED: SHAPE_REQUIRED,
    CRAFT_FLOOR_HARD: CRAFT_FLOOR_HARD,
    CRAFT_FLOOR_SOFT: CRAFT_FLOOR_SOFT,

    opsTotals: opsTotals,
    expandOps: expandOps,
    compressOps: compressOps,
    buildRound: buildRound,
    buildShape: buildShape,
    buildChart: buildChart,
    validateChart: validateChart,
    assessIdentity: assessIdentity,
    layoutPartMap: layoutPartMap,
    resolveReference: resolveReference,
    yarnEstimate: yarnEstimate,
    circleLayout: circleLayout,
    toNotation: toNotation,
    quantize: quantize,
    summarizePhotoRegions: summarizePhotoRegions,

    // 颜色工具（模板/CLI 也会用到）
    rgbToLab: rgbToLab,
    labToRgb: labToRgb,
    rgbToHsl: rgbToHsl,
    toHex: toHex,
    parseHex: parseHex,
    mulberry32: mulberry32
  };
}));
