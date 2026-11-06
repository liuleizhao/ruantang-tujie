// I. CLI（契约 §4）
import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../lib/harness.mjs';
import { runNode, runPython, parseJsonLoose, describeRun, pythonCmd } from '../lib/cli.mjs';

export function register(h, ctx) {
  h.section('I. CLI 退出码与产物（契约 §4）');

  const requireFile = (p, label) => {
    if (!fs.existsSync(p)) {
      throw new (class extends Error {})(`${label} 尚未交付：${ctx.rel(p)}`);
    }
  };

  /* ── 4.1 validate-chart ── */
  h.it('validate-chart.mjs 对合格 chart → 退出码 0', () => {
    const cli = ctx.CLI.validate;
    requireFile(cli, 'tools/validate-chart.mjs');
    const good = ctx.fixtures('good-chart.json');
    requireFile(good, 'fixture good-chart.json');
    const r = runNode([cli, good]);
    assert.eq(r.status, 0, `合格图应退出 0，实际 ${r.status}\n  ${describeRun(r)}`);
  });

  h.it('validate-chart.mjs 对坏 chart → 退出码 1', () => {
    const cli = ctx.CLI.validate;
    requireFile(cli, 'tools/validate-chart.mjs');
    const bad = ctx.fixtures('bad-charts', 'bad-r1-consume.json');
    requireFile(bad, 'fixture bad-r1-consume.json');
    const r = runNode([cli, bad]);
    assert.eq(r.status, 1, `坏图应退出 1，实际 ${r.status}\n  ${describeRun(r)}`);
    // 应把问题人类可读地打印出来
    assert.ok(/R1|消耗|不符|错误|失败|✗/i.test(r.stdout + r.stderr),
      `输出应说明失败原因\n  ${describeRun(r)}`);
  });

  h.it('validate-chart.mjs 对 R5/R6 坏图同样退出 1（不是只认 R1）', () => {
    const cli = ctx.CLI.validate;
    requireFile(cli, 'tools/validate-chart.mjs');
    for (const f of ['bad-r5-incdec.json', 'bad-r6-color.json', 'bad-r8-decor.json']) {
      const p = ctx.fixtures('bad-charts', f);
      requireFile(p, `fixture ${f}`);
      const r = runNode([cli, p]);
      assert.eq(r.status, 1, `${f} 应退出 1，实际 ${r.status}\n  ${describeRun(r)}`);
    }
  });

  h.it('validate-chart.mjs 缺参数 → 退出码 2（用法错误）', () => {
    const cli = ctx.CLI.validate;
    requireFile(cli, 'tools/validate-chart.mjs');
    const r = runNode([cli]);
    assert.eq(r.status, 2, `缺参数应退出 2（契约 §4），实际 ${r.status}\n  ${describeRun(r)}`);
  });

  /* ── 4.2 build-chart ── */
  h.it('build-chart.mjs 生成可解析 chart.json → 退出码 0', () => {
    const cli = ctx.CLI.build;
    requireFile(cli, 'tools/build-chart.mjs');
    const spec = ctx.fixtures('toyspec-5part.json');
    requireFile(spec, 'fixture toyspec-5part.json');
    const out = ctx.tmpFile('build', 'chart.json');
    const r = runNode([cli, spec, '--out', out]);
    assert.eq(r.status, 0, `合格 toySpec 应退出 0，实际 ${r.status}\n  ${describeRun(r)}`);
    assert.ok(fs.existsSync(out), `应生成 ${out}\n  ${describeRun(r)}`);
    const parsed = parseJsonLoose(fs.readFileSync(out, 'utf8'));
    assert.ok(parsed.ok, `生成的 chart.json 必须可解析: ${parsed.reason}`);
    assert.isArr(parsed.value.parts, '生成 chart 的 parts 必须是数组');
    assert.eq(parsed.value.parts.length, 5, '生成 chart 应有 5 个部件');
  });

  h.it('build-chart.mjs 打印用线量摘要', () => {
    const cli = ctx.CLI.build;
    requireFile(cli, 'tools/build-chart.mjs');
    const spec = ctx.fixtures('toyspec-5part.json');
    const out = ctx.tmpFile('build', 'chart2.json');
    const r = runNode([cli, spec, '--out', out]);
    assert.ok(/用线|米|m\b|yarn/i.test(r.stdout + r.stderr),
      `应打印用线量摘要\n  ${describeRun(r)}`);
  });

  /* ── 4.3 render-html ── */
  h.it('render-html.mjs 生成 HTML，占位符已替换', () => {
    const cli = ctx.CLI.render;
    requireFile(cli, 'tools/render-html.mjs');
    const chartPath = ctx.fixtures('good-chart.json');
    requireFile(chartPath, 'fixture good-chart.json');
    const out = ctx.tmpFile('render', 'out.html');
    const r = runNode([cli, chartPath, '--out', out]);
    assert.eq(r.status, 0, `应退出 0，实际 ${r.status}\n  ${describeRun(r)}`);
    assert.ok(fs.existsSync(out), '应生成 HTML 文件');
    const html = fs.readFileSync(out, 'utf8');
    assert.ok(html.length > 5000, `产物过短（${html.length} 字符），疑似模板未正确注入`);
    assert.notIncludes(html, '/*__GUMMY_CHART__*/null', '占位符 /*__GUMMY_CHART__*/null 必须被替换');
    assert.notIncludes(html, '/*__GUMMY_ENGINE__*/', '占位符 /*__GUMMY_ENGINE__*/ 必须被替换');
    assert.includes(html, 'GummyEngine', '产物应内嵌引擎（含 GummyEngine 标识）');
  });

  /* ── 4.4 analyze_photo.py ── */
  h.it('analyze_photo.py 输出合法 JSON 且 dominant 非空', () => {
    const py = ctx.CLI.photo;
    requireFile(py, 'tools/analyze_photo.py');
    if (!fs.existsSync(ctx.PHOTO_PATH)) {
      throw new (class extends Error {})(`测试照片不存在: ${ctx.PHOTO_PATH}`);
    }
    if (!pythonCmd()) throw new (class extends Error {})('本机 python 不可用');
    const r = runPython([py, ctx.PHOTO_PATH, '--k', '8', '--json']);
    assert.eq(r.status, 0, `应退出 0，实际 ${r.status}\n  ${describeRun(r)}`);
    const parsed = parseJsonLoose(r.stdout);
    assert.ok(parsed.ok, `stdout 必须是合法 JSON: ${parsed.reason}\n  ${describeRun(r)}`);
    const v = parsed.value;
    assert.hasKeys(v, ['width', 'height', 'dominant', 'bands', 'suggested'], 'JSON 缺字段（契约 §4.4）');
    assert.isArr(v.dominant, 'dominant 必须是数组');
    assert.ok(v.dominant.length > 0, 'dominant 不能为空');
    assert.hasKeys(v.bands, ['top', 'middle', 'bottom'], 'bands 必须含 top/middle/bottom');
    assert.hasKeys(v.suggested, ['hair', 'skin', 'cloth'], 'suggested 必须含 hair/skin/cloth');
    assert.eq(v.width, 266, `照片宽应为 266，实际 ${v.width}`);
    assert.eq(v.height, 264, `照片高应为 264，实际 ${v.height}`);
    for (const c of v.dominant) {
      assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/, `dominant.hex 必须是 #RRGGBB，实际 ${c.hex}`);
    }
  });

  h.it('analyze_photo.py 的 bands 与引擎 summarizePhotoRegions 语义一致', () => {
    const py = ctx.CLI.photo;
    requireFile(py, 'tools/analyze_photo.py');
    if (!ctx.engine.ok) throw new (class extends Error {})(`引擎不可加载: ${ctx.engine.reason}`);
    const r = runPython([py, ctx.PHOTO_PATH, '--k', '8', '--json']);
    assert.eq(r.status, 0, `应退出 0\n  ${describeRun(r)}`);
    const parsed = parseJsonLoose(r.stdout);
    assert.ok(parsed.ok, `stdout 必须是合法 JSON: ${parsed.reason}`);
    // 每个 band 的 ratio 之和应 ≈ 1（同一套上/中/下三段定义）
    for (const k of ['top', 'middle', 'bottom']) {
      const arr = parsed.value.bands[k] || [];
      const sum = arr.reduce((s, c) => s + (c.ratio || 0), 0);
      assert.approx(sum, 1, 0.05, `bands.${k} 的 ratio 之和应 ≈ 1（三段各自的占比），实际 ${sum}`);
    }
  });

  h.it('analyze_photo.py 非 --json 模式人可读输出', () => {
    const py = ctx.CLI.photo;
    requireFile(py, 'tools/analyze_photo.py');
    const r = runPython([py, ctx.PHOTO_PATH, '--k', '6']);
    assert.eq(r.status, 0, `人类可读模式也应退出 0，实际 ${r.status}\n  ${describeRun(r)}`);
    assert.ok(String(r.stdout).trim().length > 20, '人类可读模式应有输出');
  });
}
