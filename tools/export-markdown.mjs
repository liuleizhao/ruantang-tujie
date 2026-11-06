#!/usr/bin/env node
/**
 * tools/export-markdown.mjs —— 把 chart 导出为可读 Markdown 图解（契约 §4.5）
 *
 * 用法：
 *   node tools/export-markdown.mjs <chart.json> --out <x.md>
 *   node tools/export-markdown.mjs <chart.json> --out <x.md> --force
 *
 * 默认：校验失败则拒绝写出（对齐竞品「自检不过不导出」）。
 * `--force`：仍写出，但文首标注「校验未通过」。
 *
 * 退出码：0 成功 / 1 校验失败（未写或 --force 已写） / 2 用法或 IO 错误。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EngineLoadError, loadEngine, readJsonFile, safeNotation, fmt } from './_load-engine.mjs';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function usage(msg) {
  if (msg) process.stderr.write(`错误：${msg}\n\n`);
  process.stderr.write(
    '用法：node tools/export-markdown.mjs <chart.json> --out <x.md> [--force]\n',
  );
  process.exit(EXIT_USAGE);
}

function parseArgs(argv) {
  const out = { chart: null, out: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      out.out = argv[++i];
      if (!out.out) usage('--out 后面缺少路径');
    } else if (a.startsWith('--out=')) {
      out.out = a.slice(6);
    } else if (a === '--force') {
      out.force = true;
    } else if (a.startsWith('-')) {
      usage(`未知选项：${a}`);
    } else if (!out.chart) {
      out.chart = a;
    } else {
      usage(`多余参数：${a}`);
    }
  }
  if (!out.chart) usage('缺少 chart.json 参数');
  if (!out.out) usage('缺少 --out <x.md>');
  return out;
}

function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

function buildMarkdown(chart, engine, validation) {
  const lines = [];
  const name = chart.name || '(未命名)';
  const gauge = chart.gauge || {};
  const yarn = chart.yarn || {};
  const ok = !!(validation && validation.ok);

  lines.push(`# ${name} · 钩织图解`);
  lines.push('');
  if (!ok) {
    lines.push('> ⚠️ **校验未通过** — 本文件仅供排查，请勿按此下针。');
    lines.push('');
  } else {
    lines.push('> ✓ 逐圈守恒校验通过（R1–R11）。');
    lines.push('');
  }

  lines.push('## 概要');
  lines.push('');
  lines.push(`| 项 | 值 |`);
  lines.push(`|---|---|`);
  lines.push(`| 作品 | ${mdEscape(name)} |`);
  if (chart.spec && chart.spec.heightCm) {
    lines.push(`| 成品高 | ${chart.spec.heightCm} cm |`);
  }
  lines.push(`| 钩针 / 线材 | ${gauge.hookMm || '?'} mm / ${mdEscape(gauge.yarn || '?')} |`);
  lines.push(`| 密度 | ${gauge.stPerCm || '?'} 针/cm · ${gauge.roundsPerCm || '?'} 圈/cm |`);
  if (validation && validation.summary) {
    const s = validation.summary;
    lines.push(`| 部件 / 圈 / 总针 | ${s.parts} / ${s.rounds} / ${s.totalStitches} |`);
    lines.push(`| 换色 | ${s.colorChanges} |`);
  }
  if (yarn.total) {
    lines.push(
      `| 用线量 | ${fmt(yarn.total.meters)} m / ${fmt(yarn.total.grams)} g` +
        (yarn.withBuffer
          ? `（含缓冲 ${fmt(yarn.withBuffer.meters)} m / ${fmt(yarn.withBuffer.grams)} g）`
          : '') +
        ` |`,
    );
  }
  lines.push('');

  if (chart.palette && chart.palette.length) {
    lines.push('## 配色');
    lines.push('');
    lines.push('| id | 名称 | 色值 | 角色 |');
    lines.push('|---|---|---|---|');
    for (const c of chart.palette) {
      lines.push(
        `| ${mdEscape(c.id)} | ${mdEscape(c.name || '')} | \`${c.hex || ''}\` | ${mdEscape(c.role || '')} |`,
      );
    }
    lines.push('');
  }

  if (chart.buildOrder && chart.buildOrder.length) {
    lines.push('## 制作顺序');
    lines.push('');
    chart.buildOrder.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');
  }

  lines.push('## 逐圈图解');
  lines.push('');
  for (const part of chart.parts || []) {
    if (!part) continue;
    lines.push(`### ${part.name || part.id}`);
    lines.push('');
    const notation = safeNotation(engine, part);
    lines.push('| 圈 | 配色 | 记法 | 消耗 | 产出 |');
    lines.push('|---|---|---|---:|---:|');
    (part.rounds || []).forEach((rd, idx) => {
      const note = notation[idx] || rd.note || '';
      let extra = '';
      if (rd.loop && rd.loop !== 'both') {
        extra += ` 〔${rd.loop}${rd.reservedFor ? '→' + rd.reservedFor : ''}〕`;
      }
      if (rd.decor && rd.decor.length) {
        extra += ' 〔decor×' + rd.decor.reduce((n, d) => n + (d.count || 0), 0) + '〕';
      }
      lines.push(
        `| R${rd.r} | ${mdEscape(rd.color || '')} | ${mdEscape(note + extra)} | ${rd.stitchesIn} | ${rd.stitchesOut} |`,
      );
    });
    lines.push('');
  }

  if (validation && validation.errors && validation.errors.length) {
    lines.push('## 校验错误');
    lines.push('');
    for (const e of validation.errors) lines.push(`- ✗ ${e}`);
    lines.push('');
  }
  if (validation && validation.warnings && validation.warnings.length) {
    lines.push('## 警告');
    lines.push('');
    for (const w of validation.warnings) lines.push(`- ! ${w}`);
    lines.push('');
  }

  if (typeof engine.assessIdentity === 'function') {
    const idn = engine.assessIdentity(chart);
    lines.push('## 还原度自检');
    lines.push('');
    lines.push(`得分 **${idn.score}/100** ${idn.ok ? '✓' : '✗'}`);
    lines.push('');
    for (const c of idn.checks || []) {
      lines.push(`- ${c.ok ? '✓' : '✗'} **${c.id}**：${c.detail}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*由软糖图解 GummyEngine 导出 · 针数由引擎计算，请勿手改。*');
  lines.push('');
  return lines.join('\n');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  let chart;
  try {
    chart = await readJsonFile(args.chart);
  } catch (err) {
    if (err.code === 'ENOENT') usage(`找不到文件：${args.chart}`);
    usage(`无法读取或解析 ${args.chart}：${err.message}`);
  }

  let engine;
  try {
    engine = await loadEngine();
  } catch (err) {
    if (err instanceof EngineLoadError) {
      process.stderr.write(`错误：引擎不可用 —— ${err.message}\n`);
      process.exit(EXIT_USAGE);
    }
    throw err;
  }

  const validation = engine.validateChart(chart);
  if (!validation.ok && !args.force) {
    process.stderr.write('错误：校验未通过，拒绝导出 Markdown（可加 --force 强制写出）。\n');
    for (const e of validation.errors || []) process.stderr.write(`  ✗ ${e}\n`);
    process.exit(EXIT_INVALID);
  }

  const md = buildMarkdown(chart, engine, validation);
  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(args.out, md, 'utf8');
  process.stdout.write(`已写出 ${args.out}（${md.length} 字符）\n`);

  if (!validation.ok) {
    process.stderr.write('警告：文件已写出，但校验未通过。\n');
    process.exit(EXIT_INVALID);
  }
  process.exit(EXIT_OK);
}

run().catch((err) => {
  process.stderr.write(`内部错误：${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT_USAGE);
});
