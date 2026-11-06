#!/usr/bin/env node
/**
 * tools/build-chart.mjs —— 从 toySpec.json 生成 chart.json（契约 §4.2）
 *
 * 用法：
 *   node tools/build-chart.mjs <toySpec.json> --out <chart.json>
 *
 * 行为：
 *   - 调 GummyEngine.buildChart(toySpec)，写 chart.json；
 *   - 同时打印用线量摘要；
 *   - 校验失败**仍然写出文件**，但退出码 1（契约 §4.2 明确要求）。
 *
 * 退出码：0 成功 / 1 校验失败 / 2 用法或 IO 错误。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EngineLoadError, loadEngine, readJsonFile, fmt } from './_load-engine.mjs';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function usage(msg) {
  if (msg) process.stderr.write(`错误：${msg}\n\n`);
  process.stderr.write('用法：node tools/build-chart.mjs <toySpec.json> --out <chart.json>\n');
  process.exit(EXIT_USAGE);
}

function parseArgs(argv) {
  const out = { spec: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      out.out = argv[i + 1];
      i += 1;
      if (!out.out) usage('--out 后面缺少路径');
    } else if (a.startsWith('--out=')) {
      out.out = a.slice('--out='.length);
    } else if (a.startsWith('-')) {
      usage(`未知选项：${a}`);
    } else if (!out.spec) {
      out.spec = a;
    } else {
      usage(`多余参数：${a}`);
    }
  }
  if (!out.spec) usage('缺少 toySpec.json 参数');
  if (!out.out) usage('缺少 --out <chart.json>');
  return out;
}

async function run() {
  const { spec: specPath, out: outPath } = parseArgs(process.argv.slice(2));

  let toySpec;
  try {
    toySpec = await readJsonFile(specPath);
  } catch (err) {
    if (err.code === 'ENOENT') usage(`找不到 toySpec 文件：${specPath}`);
    usage(`无法读取或解析 ${specPath}：${err.message}`);
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

  // 引擎内部已调用 validateChart，且 ok===false 时不抛异常（契约 §3.5）
  let chart;
  try {
    chart = engine.buildChart(toySpec);
  } catch (err) {
    process.stderr.write(`错误：buildChart 抛出异常 —— ${err && err.message ? err.message : err}\n`);
    process.exit(EXIT_USAGE);
  }

  // 契约 §4.2：校验失败仍写出文件
  try {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(chart, null, 2)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`错误：无法写出 ${outPath}：${err.message}\n`);
    process.exit(EXIT_USAGE);
  }

  // ─────────────────────────── 摘要 ───────────────────────────
  process.stdout.write(`\n软糖图解 · 生成完成\n`);
  process.stdout.write(`作品：${chart.name || toySpec.name || '(未命名)'}\n`);
  process.stdout.write(`输出：${path.resolve(outPath)}\n`);

  const g = chart.gauge || {};
  process.stdout.write(
    `规格：${toySpec.heightCm ?? '?'} cm 成品 · 钩针 ${g.hookMm ?? '?'} mm · ${g.yarn || '线材未定'}\n`,
  );

  const parts = chart.parts || [];
  process.stdout.write(`部件：${parts.length} 个 — ${parts.map((p) => `${p.id}(${p.rounds.length}圈)`).join('、')}\n`);

  const v = chart.validation || {};
  const s = v.summary || {};
  process.stdout.write(`合计：${s.rounds ?? '?'} 圈 · ${s.totalStitches ?? '?'} 针\n`);

  // 用线量（契约 §3.6）
  const y = chart.yarn;
  if (y && y.total) {
    process.stdout.write(`\n用线量：\n`);
    const rows = (y.perPart || []).map((p) => [p.id, `${p.stitches} 针`, `${fmt(p.meters)} m`, `${fmt(p.grams)} g`]);
    const wId = Math.max(4, ...rows.map((r) => String(r[0]).length));
    for (const r of rows) {
      process.stdout.write(`  ${String(r[0]).padEnd(wId)}  ${r[1].padStart(7)}  ${r[2].padStart(8)}  ${r[3].padStart(7)}\n`);
    }
    process.stdout.write(
      `  ${'─'.repeat(wId + 26)}\n` +
        `  ${'合计'.padEnd(wId)}  ${String(y.total.stitches).padStart(6)} 针  ${fmt(y.total.meters).padStart(8)} m  ${fmt(y.total.grams).padStart(7)} g\n`,
    );
    if (y.withBuffer) {
      const pct = Math.round((y.bufferRatio ?? 0.25) * 100);
      process.stdout.write(
        `  ${`含${pct}%缓冲`.padEnd(wId)}  ${''.padStart(8)}  ${fmt(y.withBuffer.meters).padStart(8)} m  ${fmt(y.withBuffer.grams).padStart(7)} g\n`,
      );
    }
    if (y.constants && y.constants.metersPerStitch) {
      process.stdout.write(`  常数：metersPerStitch = ${y.constants.metersPerStitch}\n`);
    }
  }

  // ─────────────────────────── 校验结论 ───────────────────────────
  process.stdout.write('\n');
  if (v.ok) {
    process.stdout.write('校验：✓ 通过\n\n');
    process.exit(EXIT_OK);
  }

  process.stdout.write('校验：✗ 未通过（chart.json 已写出，便于排查）\n');
  for (const e of v.errors || []) process.stdout.write(`  ✗ ${e}\n`);
  for (const p of v.parts || []) {
    for (const rd of p.rounds || []) {
      for (const e of rd.errors || []) process.stdout.write(`  ✗ [${p.id} R${rd.r}] ${e}\n`);
    }
    for (const e of p.errors || []) process.stdout.write(`  ✗ [${p.id}] ${e}\n`);
  }
  for (const w of v.warnings || []) process.stdout.write(`  ! ${w}\n`);
  process.stdout.write('\n');
  process.exit(EXIT_INVALID);
}

run().catch((err) => {
  process.stderr.write(`内部错误：${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT_USAGE);
});
