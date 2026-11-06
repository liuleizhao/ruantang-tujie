// 极简断言/运行框架（零依赖）
// 设计目标：清晰的中文失败信息 + 分组输出 + 全绿退出码 0 / 否则 1
import nodeAssert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NO_COLOR = !!process.env.NO_COLOR || process.env.TERM === 'dumb';
const wrap = (code) => (s) => (NO_COLOR ? String(s) : `\u001b[${code}m${s}\u001b[0m`);

export const C = {
  red: wrap('31'), green: wrap('32'), yellow: wrap('33'), blue: wrap('34'),
  magenta: wrap('35'), cyan: wrap('36'), gray: wrap('90'), bold: wrap('1'), dim: wrap('2'),
};

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function short(v, max = 700) {
  let s;
  try {
    if (typeof v === 'string') s = JSON.stringify(v);
    else if (typeof v === 'function') s = `[Function ${v.name || 'anonymous'}]`;
    else if (v && typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? `${s.slice(0, max)}…(共 ${s.length} 字符)` : s;
}

const fail = (msg) => { throw new AssertionError(msg); };

export const assert = {
  ok(cond, msg = '期望条件成立') { if (!cond) fail(msg); },
  notOk(cond, msg = '期望条件不成立') { if (cond) fail(msg); },
  eq(actual, expected, msg = '') {
    if (!Object.is(actual, expected)) {
      fail(`${msg}\n  期望: ${short(expected)}\n  实际: ${short(actual)}`);
    }
  },
  ne(actual, unexpected, msg = '') {
    if (Object.is(actual, unexpected)) {
      fail(`${msg}\n  期望不等于: ${short(unexpected)}`);
    }
  },
  deepEq(actual, expected, msg = '') {
    try { nodeAssert.deepStrictEqual(actual, expected); }
    catch (e) { fail(`${msg}\n  ${e.message}`); }
  },
  isFn(v, msg = '') { if (typeof v !== 'function') fail(`${msg}\n  期望函数，实际 typeof = ${typeof v} (${short(v, 200)})`); },
  isStr(v, msg = '') { if (typeof v !== 'string') fail(`${msg}\n  期望字符串，实际 typeof = ${typeof v} (${short(v, 200)})`); },
  isNum(v, msg = '') {
    if (typeof v !== 'number' || Number.isNaN(v)) fail(`${msg}\n  期望有限数字，实际: ${short(v, 200)}`);
  },
  isInt(v, msg = '') {
    if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${msg}\n  期望整数，实际: ${short(v, 200)}`);
  },
  isArr(v, msg = '') { if (!Array.isArray(v)) fail(`${msg}\n  期望数组，实际: ${short(v, 200)}`); },
  isObj(v, msg = '') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${msg}\n  期望对象，实际: ${short(v, 200)}`);
  },
  includes(hay, needle, msg = '') {
    if (typeof hay === 'string') {
      if (!hay.includes(needle)) fail(`${msg}\n  字符串中未找到: ${short(needle)}\n  实际（截断）: ${short(hay, 400)}`);
      return;
    }
    if (Array.isArray(hay)) {
      if (!hay.includes(needle)) fail(`${msg}\n  数组中未找到: ${short(needle)}\n  实际: ${short(hay, 400)}`);
      return;
    }
    fail(`${msg}\n  期望字符串或数组，实际: ${typeof hay}`);
  },
  notIncludes(hay, needle, msg = '') {
    if (typeof hay === 'string' && hay.includes(needle)) fail(`${msg}\n  不应包含: ${short(needle)}`);
    if (Array.isArray(hay) && hay.includes(needle)) fail(`${msg}\n  不应包含: ${short(needle)}`);
  },
  match(str, re, msg = '') {
    if (typeof str !== 'string' || !re.test(str)) fail(`${msg}\n  未匹配正则 ${re}\n  实际: ${short(str, 400)}`);
  },
  gte(v, min, msg = '') { if (!(typeof v === 'number' && v >= min)) fail(`${msg}\n  期望 >= ${min}，实际: ${short(v)}`); },
  lte(v, max, msg = '') { if (!(typeof v === 'number' && v <= max)) fail(`${msg}\n  期望 <= ${max}，实际: ${short(v)}`); },
  lt(a, b, msg = '') {
    if (!(typeof a === 'number' && typeof b === 'number' && a < b)) {
      fail(`${msg}\n  期望 ${short(a)} < ${short(b)}`);
    }
  },
  gt(a, b, msg = '') {
    if (!(typeof a === 'number' && typeof b === 'number' && a > b)) {
      fail(`${msg}\n  期望 ${short(a)} > ${short(b)}`);
    }
  },
  between(v, lo, hi, msg = '') {
    if (!(typeof v === 'number' && v >= lo && v <= hi)) fail(`${msg}\n  期望落在 [${lo}, ${hi}]，实际: ${short(v)}`);
  },
  approx(actual, expected, tol, msg = '') {
    if (typeof actual !== 'number' || !(Math.abs(actual - expected) <= tol)) {
      const d = typeof actual === 'number' ? Math.abs(actual - expected) : 'NaN';
      fail(`${msg}\n  期望 ≈ ${expected}（容差 ±${tol}）\n  实际: ${short(actual)}\n  偏差: ${d}`);
    }
  },
  noThrow(fn, msg = '') {
    try { return fn(); }
    catch (e) {
      const where = e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : String(e);
      fail(`${msg}\n  本不应抛异常，实际抛出: ${where}`);
    }
  },
  hasKeys(obj, keys, msg = '') {
    assert.isObj(obj, msg);
    const missing = keys.filter((k) => !(k in obj));
    if (missing.length) fail(`${msg}\n  缺少字段: ${missing.join(', ')}\n  实际字段: ${Object.keys(obj).join(', ')}`);
  },
};

/** 判定文本是否提到了某个圈号（兼容 R4 / 第 4 圈 / round 4 等写法） */
export function mentionsRound(texts, n) {
  const list = Array.isArray(texts) ? texts : [texts];
  const re = new RegExp(`(^|[^0-9A-Za-z])R\\s*${n}(?![0-9])|第\\s*${n}\\s*圈|round\\s*${n}(?![0-9])|行\\s*${n}(?![0-9])`, 'i');
  return list.some((t) => typeof t === 'string' && re.test(t));
}

/** 判定错误文本是否点到了某条规则（R1..R9） */
export function mentionsRule(texts, rule) {
  const list = Array.isArray(texts) ? texts : [texts];
  const re = new RegExp(`\\b${rule}\\b`, 'i');
  return list.some((t) => typeof t === 'string' && re.test(t));
}

export function createHarness() {
  const tests = [];
  const notes = [];
  let current = '（未分组）';

  const api = {
    _filter: null,
    section(name) { current = name; return api; },
    it(name, fn) {
      if (api._filter && !api._filter(current)) return api; // --only 过滤
      tests.push({ section: current, name, fn, skip: null });
      return api;
    },
    /** 缺失依赖时整组跳过：仍然计入失败（标红），因为被测物是必交付项 */
    skip(name, reason) {
      if (api._filter && !api._filter(current)) return api;
      tests.push({ section: current, name, fn: null, skip: reason });
      return api;
    },
    note(msg) { notes.push({ section: current, msg: String(msg) }); return api; },

    async run() {
      const root = process.cwd();
      console.log(C.bold('\n软糖图解 · 回归测试'));
      console.log(C.gray(`  node ${process.version} · 工作目录 ${root}`));

      const rows = [];
      let lastSection = null;
      const t0 = Date.now();

      for (const t of tests) {
        if (t.section !== lastSection) {
          console.log(`\n${C.cyan(C.bold(t.section))}`);
          lastSection = t.section;
        }
        if (t.fn === null) {
          rows.push({ ...t, status: 'skip' });
          console.log(`  ${C.yellow('⊘ SKIP')} ${t.name} ${C.yellow(`— ${t.skip}`)}`);
          continue;
        }
        const st = Date.now();
        try {
          await t.fn();
          const ms = Date.now() - st;
          rows.push({ ...t, status: 'pass', ms });
          console.log(`  ${C.green('✓')} ${t.name}${ms > 40 ? C.gray(`  (${ms}ms)`) : ''}`);
        } catch (e) {
          const ms = Date.now() - st;
          let detail;
          if (e instanceof AssertionError) {
            detail = e.message;
          } else {
            const stack = e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : String(e);
            detail = `未预期的异常（可能是实现抛错/语法错误）:\n${stack}`;
          }
          rows.push({ ...t, status: 'fail', ms, detail });
          const first = detail.split('\n')[0];
          console.log(`  ${C.red('✗')} ${t.name} ${C.red(`— ${first}`)}`);
        }
      }

      const ms = Date.now() - t0;
      const failedRows = rows.filter((r) => r.status === 'fail');
      const skipRows = rows.filter((r) => r.status === 'skip');
      const passRows = rows.filter((r) => r.status === 'pass');

      if (notes.length) {
        console.log(`\n${C.gray('── 备注（非断言，供 lead 参考）──')}`);
        for (const n of notes) console.log(C.gray(`  · [${n.section.split('.')[0]}] ${n.msg}`));
      }

      if (failedRows.length || skipRows.length) {
        console.log(`\n${C.bold(C.red('══ 失败明细 ══'))}`);
        for (const r of failedRows) {
          console.log(`\n${C.red(`[${r.section.split('.')[0]}] ${r.section} › ${r.name}`)}`);
          console.log(r.detail.split('\n').map((l) => `    ${l}`).join('\n'));
        }
        for (const r of skipRows) {
          console.log(`\n${C.yellow(`[${r.section.split('.')[0]}] ${r.section} › ${r.name}`)}`);
          console.log(`    ${C.yellow('跳过原因: ' + r.skip)}`);
        }
        console.log(`\n${C.gray('复现: node tests/run-tests.mjs')}`);
      }

      const total = rows.length;
      const head = `${failedRows.length + skipRows.length === 0 ? C.green('✔ 全部通过') : C.red('✘ 存在失败')}`;
      console.log('\n' + '─'.repeat(64));
      console.log(
        `${head}  ${C.green(`通过 ${passRows.length}`)}` +
        `${failedRows.length ? `  ${C.red(`失败 ${failedRows.length}`)}` : `  ${C.gray('失败 0')}`}` +
        `${skipRows.length ? `  ${C.yellow(`跳过 ${skipRows.length}`)}` : `  ${C.gray('跳过 0')}`}` +
        `  ${C.gray(`共 ${total} 项 / ${(ms / 1000).toFixed(2)}s`)}`,
      );
      console.log('─'.repeat(64) + '\n');

      return {
        total,
        passed: passRows.length,
        failed: failedRows.length,
        skipped: skipRows.length,
        rows,
        exitCode: failedRows.length + skipRows.length === 0 ? 0 : 1,
      };
    },
  };

  return api;
}

/** 供 cases 引用：报告当前文件路径（便于失败时定位） */
export const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
