// J. 模板完整性（契约 §5）；K. 技能合法性（§7）
import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../lib/harness.mjs';
import { runNode, describeRun } from '../lib/cli.mjs';
import { assertNoExternal, findExternalRefs } from '../lib/no-external.mjs';

export function register(h, ctx) {
  h.section('J. 模板完整性（契约 §5：单文件、零外链）');

  const requireTemplate = () => {
    if (!fs.existsSync(ctx.TEMPLATE_PATH)) {
      throw new (class extends Error {})(`模板尚未交付：${ctx.rel(ctx.TEMPLATE_PATH)}`);
    }
    return fs.readFileSync(ctx.TEMPLATE_PATH, 'utf8');
  };

  h.it('templates/gummy-atelier.html 存在', () => {
    assert.ok(fs.existsSync(ctx.TEMPLATE_PATH), `缺少 ${ctx.rel(ctx.TEMPLATE_PATH)}`);
    const st = fs.statSync(ctx.TEMPLATE_PATH);
    assert.ok(st.size > 3000, `模板过小（${st.size} 字节），疑似未完成`);
  });

  h.it('含占位符 /*__GUMMY_CHART__*/null（原样）', () => {
    const html = requireTemplate();
    assert.includes(html, '/*__GUMMY_CHART__*/null',
      '模板必须原样保留占位符 /*__GUMMY_CHART__*/null（契约 §5）');
  });

  h.it('含占位符 /*__GUMMY_ENGINE__*/（原样）', () => {
    const html = requireTemplate();
    assert.includes(html, '/*__GUMMY_ENGINE__*/',
      '模板必须原样保留占位符 /*__GUMMY_ENGINE__*/（契约 §5）');
  });

  h.it('无任何外链（http/https//cdn/link stylesheet）', () => {
    const html = requireTemplate();
    // 契约要求「单个文件、零外链、离线可用」。
    // 注：SVG 命名空间 http://www.w3.org/2000/svg 是标识符而非网络请求，判据见 lib/no-external.mjs
    assertNoExternal(assert, html, '模板 templates/gummy-atelier.html');
  });

  h.it('模板中出现的 http(s) 字样均为 SVG/XML 命名空间（不是资源外链）', () => {
    const html = requireTemplate();
    const hits = findExternalRefs(html);
    // 本用例只做取证：打印所有 http 字样，供 lead 复核
    const raw = (html.match(/https?:\/\/[^\s"')]+/gi) || []);
    const nsOnly = raw.every((u) => /w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml)/.test(u));
    assert.ok(nsOnly || hits.length === 0,
      `模板含非命名空间的 http(s) 字样: ${[...new Set(raw)].slice(0, 8).join(', ')}`);
  });

  h.it('含 @media print（打印友好）', () => {
    const html = requireTemplate();
    assert.match(html, /@media\s+print/i, '模板应含 @media print 样式（契约 §5.6）');
  });

  h.it('含 localStorage 进度保存', () => {
    const html = requireTemplate();
    assert.includes(html, 'localStorage', '模板应用 localStorage 保存进度（契约 §5.7）');
  });

  h.it('调用 circleLayout 绘制符号图', () => {
    const html = requireTemplate();
    assert.ok(/circleLayout/.test(html), '模板应调用 GummyEngine.circleLayout 绘制符号图（契约 §5.4）');
  });

  h.it('含参考图部件对照（reference / focusPart / ref-region）', () => {
    const html = requireTemplate();
    assert.includes(html, 'renderReferenceMap', '模板应渲染参考图对照区（契约 §5.2）');
    assert.includes(html, 'focusPart', '模板应支持热区 ↔ 部件双向定位');
    assert.includes(html, 'ref-region', '模板应含热区样式/标记');
    assert.includes(html, '在图上定位', '部件标题应有反向定位入口');
  });

  /* ── render-html 产物同样无外链 ── */
  h.it('render-html 产物：占位符已替换且同样无外链', () => {
    if (!fs.existsSync(ctx.CLI.render)) {
      throw new (class extends Error {})(`tools/render-html.mjs 尚未交付：${ctx.rel(ctx.CLI.render)}`);
    }
    requireTemplate();
    const chartPath = ctx.fixtures('good-chart.json');
    const out = ctx.tmpFile('render', 'j-out.html');
    const r = runNode([ctx.CLI.render, chartPath, '--out', out]);
    assert.eq(r.status, 0, `render-html 应退出 0\n  ${describeRun(r)}`);
    const html = fs.readFileSync(out, 'utf8');
    assert.notIncludes(html, '/*__GUMMY_CHART__*/null', '产物中 /*__GUMMY_CHART__*/null 必须已替换');
    assert.notIncludes(html, '/*__GUMMY_ENGINE__*/', '产物中 /*__GUMMY_ENGINE__*/ 必须已替换');
    const found = findExternalRefs(html);
    assert.eq(found.length, 0,
      `渲染产物必须零外链，发现: ${found.map((h) => `${h.label}(${h.sample})`).join(', ')}`);
    assert.includes(html, '测试用合格图解', '产物应包含 chart 的名称（说明 chart 已注入）');
  });

  /* ─────────────── K. 技能 ─────────────── */
  h.section('K. 技能 frontmatter 合法性（契约 §7）');

  const parseFrontmatter = (text) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { ok: false, reason: '缺少 --- frontmatter 分隔块' };
    const body = m[1];
    const fields = {};
    let key = null;
    for (const rawLine of body.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine);
      if (kv) {
        key = kv[1];
        let val = kv[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        fields[key] = val;
      } else if (key) {
        // 多行续行
        fields[key] = `${fields[key]} ${rawLine.trim()}`.trim();
      }
    }
    return { ok: true, fields };
  };

  h.it('skills/ 下至少存在 1 个 SKILL.md', () => {
    assert.ok(fs.existsSync(ctx.SKILLS_DIR), `缺少 ${ctx.rel(ctx.SKILLS_DIR)} 目录`);
    const dirs = fs.readdirSync(ctx.SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    assert.gte(dirs.length, 1, 'skills/ 下应至少有一个技能目录');
  });

  h.it('每个 SKILL.md 的 frontmatter 可解析且 name 与目录名一致', () => {
    const dirs = fs.readdirSync(ctx.SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const problems = [];
    let checked = 0;
    for (const dir of dirs) {
      const file = path.join(ctx.SKILLS_DIR, dir, 'SKILL.md');
      if (!fs.existsSync(file)) { problems.push(`${dir}: 缺少 SKILL.md`); continue; }
      checked += 1;
      const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      if (!fm.ok) { problems.push(`${dir}: ${fm.reason}`); continue; }
      if (!fm.fields.name) problems.push(`${dir}: frontmatter 缺少 name`);
      else if (fm.fields.name !== dir) problems.push(`${dir}: name="${fm.fields.name}" 与目录名不一致`);
      if (!fm.fields.description) problems.push(`${dir}: frontmatter 缺少 description`);
      else if (fm.fields.description.length < 10) problems.push(`${dir}: description 过短（${fm.fields.description.length} 字符）`);
    }
    assert.gte(checked, 1, '没有找到任何可检查的 SKILL.md');
    assert.eq(problems.length, 0, `技能 frontmatter 问题:\n  ${problems.join('\n  ')}`);
  });
}
