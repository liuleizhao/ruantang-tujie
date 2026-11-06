#!/usr/bin/env node
/**
 * tools/validate-chart.mjs —— 校验 chart.json（契约 §4.1）
 *
 * 用法：
 *   node tools/validate-chart.mjs <chart.json>
 *
 * 打印逐圈守恒表 + 结论。
 * 退出码：0 校验通过 / 1 校验失败 / 2 用法或 IO 错误。
 */

import { readFile } from 'node:fs/promises';
import { EngineLoadError, loadEngine, readJsonFile, safeNotation, fmt } from './_load-engine.mjs';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function usage(msg) {
  if (msg) process.stderr.write(`错误：${msg}\n\n`);
  process.stderr.write('用法：node tools/validate-chart.mjs <chart.json>\n');
  process.exit(EXIT_USAGE);
}

/** 按显示宽度补齐（中文占 2 列），让表格在终端里对齐 */
function pad(str, width) {
  const s = String(str);
  let w = 0;
  for (const ch of s) w += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, width - w));
}

function rule(title, lines) {
  const bar = '─'.repeat(4);
  process.stdout.write(`\n${bar} ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\n`);
  for (const l of lines) process.stdout.write(`  ${l}\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) usage(args.length ? `参数不对：${args.join(' ')}` : '缺少 chart.json 参数');

  return args[0];
}

async function run() {
  const chartPath = main();

  let chart;
  try {
    chart = await readJsonFile(chartPath);
  } catch (err) {
    if (err.code === 'ENOENT') usage(`找不到文件：${chartPath}`);
    usage(`无法读取或解析 ${chartPath}：${err.message}`);
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

  const result = engine.validateChart(chart);

  // ─────────────────────────── 概览 ───────────────────────────
  process.stdout.write(`\n软糖图解 · 图解校验\n`);
  process.stdout.write(`作品：${chart.name || '(未命名)'}\n`);
  process.stdout.write(`部件：${result.summary.parts}    圈数：${result.summary.rounds}    `);
  process.stdout.write(`总针数：${result.summary.totalStitches}    换色：${result.summary.colorChanges}\n`);
  if (result.summary.decorCount !== undefined) {
    process.stdout.write(`装饰针迹：${result.summary.decorCount}    留针圈：${result.summary.reservedLoops}\n`);
  }

  // ─────────────────────── 逐部件逐圈表 ───────────────────────
  for (const part of result.parts) {
    const src = (chart.parts || []).find((p) => p && p.id === part.id);
    const notation = src ? safeNotation(engine, src) : [];
    const kindCn = {
      'magic-ring': '环形起针',
      row: '片织',
      attach: '接口起针',
      round: '圈织',
    };

    process.stdout.write(
      `\n\n▍部件 ${part.id}${src && src.name ? `（${src.name}）` : ''}  ` +
        `${part.ok ? '✓ 通过' : '✗ 失败'}\n`,
    );
    process.stdout.write(
      `  ${pad('圈', 5)}${pad('类型', 10)}${pad('消耗', 6)}${pad('声明', 6)}` +
        `${pad('产出', 6)}${pad('增减', 6)}${pad('状态', 6)}记法\n`,
    );
    process.stdout.write(`  ${'·'.repeat(78)}\n`);

    for (const rd of part.rounds) {
      const delta = rd.delta > 0 ? `+${rd.delta}` : String(rd.delta);
      const status = rd.ok ? '✓' : '✗';
      const note = notation[rd.r - 1] || '';
      const line =
        `  ${pad('R' + rd.r, 5)}${pad(kindCn[(src?.rounds?.[rd.r - 1] || {}).kind] || '', 10)}` +
        `${pad(rd.consumed, 6)}${pad(rd.declaredIn, 6)}${pad(rd.produced, 6)}` +
        `${pad(delta, 6)}${pad(status, 6)}${note}`;
      process.stdout.write(line + '\n');

      for (const e of rd.errors || []) process.stdout.write(`      ↳ ${e}\n`);
    }

    for (const e of part.errors || []) {
      if (!String(e).startsWith('R')) process.stdout.write(`  ✗ ${e}\n`);
    }
  }

  // ─────────────────────────── 结论 ───────────────────────────
  if (result.errors && result.errors.length) {
    rule('全局错误', result.errors.map((e) => `✗ ${e}`));
  }
  if (result.warnings && result.warnings.length) {
    rule('警告（不影响通过）', result.warnings.map((e) => `! ${e}`));
  }

  // 用线量摘要（chart 里可能有；没有就跳过）
  if (chart.yarn && chart.yarn.total) {
    const y = chart.yarn;
    rule('用线量', [
      `总针数 ${y.total.stitches} 针`,
      `净用线 ${fmt(y.total.meters)} m / ${fmt(y.total.grams)} g`,
      y.withBuffer
        ? `含 ${Math.round((y.bufferRatio ?? 0.25) * 100)}% 缓冲 ${fmt(y.withBuffer.meters)} m / ${fmt(y.withBuffer.grams)} g`
        : '',
    ].filter(Boolean));
  }

  process.stdout.write('\n');
  if (result.ok) {
    process.stdout.write('结论：✓ 校验通过 —— 每一圈的消耗/产出与增减针完全守恒。\n\n');
    process.exit(EXIT_OK);
  }
  process.stdout.write(
    `结论：✗ 校验未通过 —— 共 ${(result.errors || []).length} 处全局错误、` +
      `${result.parts.reduce((n, p) => n + (p.rounds || []).reduce((m, r) => m + (r.errors || []).length, 0) + (p.errors || []).length, 0)} 处部件/圈级错误。\n\n`,
  );
  process.exit(EXIT_INVALID);
}

run().catch((err) => {
  process.stderr.write(`内部错误：${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT_USAGE);
});
