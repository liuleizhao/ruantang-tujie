#!/usr/bin/env node
/**
 * tools/render-html.mjs —— 把 chart 注入模板，产出单文件自包含 HTML（契约 §4.3 + §5）
 *
 * 用法：
 *   node tools/render-html.mjs <chart.json> --out <x.html>
 *   node tools/render-html.mjs <chart.json> --out <x.html> --check
 *   node tools/render-html.mjs <chart.json> --out <x.html> --template <path>
 *   node tools/render-html.mjs <chart.json> --out <x.html> --ref <照片.jpg>
 *
 * `--check`：渲染后立刻用 tools/_selftest/render-check.mjs 的 DOM 桩跑一遍产出的
 * HTML，确认「脚本执行无异常 + 每圈都渲染 + SVG 生成」。改模板后能立刻发现
 * 「渲染出来是白屏」这类问题，而不是等人打开浏览器才发现。
 *
 * `--ref`：把参考照片以 data URL 嵌入 chart.reference.image（单文件离线可读）；
 * 若 chart 尚无 reference.regions，会用引擎 layoutPartMap 自动生成 Q 版热区。
 *
 * 注入方式（契约 §5，模板内保留两个占位符）：
 *   1. `/*__GUMMY_CHART__*\/null`  → 替换为 chart JSON
 *   2. `/*__GUMMY_ENGINE__*\/`     → 替换为引擎源码（保证单文件自包含）
 *
 * 模板由 template-dev 并行编写（契约 §7：templates/ 不是本工具的写入范围）。
 * 因此本工具对「模板暂不存在」必须优雅失败：给出清晰中文报错 + 退出码 2，
 * 而不是抛一个看不懂的 ENOENT。
 *
 * 退出码：0 成功 / 1 图表校验失败 / 2 用法或 IO 错误（含模板缺失）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PATH, TEMPLATE_PATH, EngineLoadError, loadEngine, readJsonFile } from './_load-engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

const CHART_PLACEHOLDER = '/*__GUMMY_CHART__*/null';
const ENGINE_PLACEHOLDER = '/*__GUMMY_ENGINE__*/';

function usage(msg) {
  if (msg) process.stderr.write(`错误：${msg}\n\n`);
  process.stderr.write(
    '用法：node tools/render-html.mjs <chart.json> --out <x.html> [--template <gummy-atelier.html>] [--ref <照片>]\n',
  );
  process.exit(EXIT_USAGE);
}

function parseArgs(argv) {
  const out = {
    chart: null,
    out: null,
    template: TEMPLATE_PATH,
    allowMissingTemplate: false,
    check: false,
    ref: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      out.out = argv[++i];
      if (!out.out) usage('--out 后面缺少路径');
    } else if (a.startsWith('--out=')) {
      out.out = a.slice(6);
    } else if (a === '--template' || a === '-t') {
      out.template = argv[++i];
      if (!out.template) usage('--template 后面缺少路径');
    } else if (a.startsWith('--template=')) {
      out.template = a.slice(11);
    } else if (a === '--ref' || a === '--reference') {
      out.ref = argv[++i];
      if (!out.ref) usage('--ref 后面缺少图片路径');
    } else if (a.startsWith('--ref=')) {
      out.ref = a.slice(6);
    } else if (a === '--check') {
      // 渲染后用 DOM 桩自检产物，见文件头说明
      out.check = true;
    } else if (a === '--allow-missing-template') {
      // 联调用：模板还没写出来时，先用内置最小骨架跑通注入流程
      out.allowMissingTemplate = true;
    } else if (a.startsWith('-')) {
      usage(`未知选项：${a}`);
    } else if (!out.chart) {
      out.chart = a;
    } else {
      usage(`多余参数：${a}`);
    }
  }
  if (!out.chart) usage('缺少 chart.json 参数');
  if (!out.out) usage('缺少 --out <x.html>');
  return out;
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** 把本地图片读成 data URL，嵌入 chart.reference（保持单文件零外链） */
async function embedReference(chart, refPath, engine) {
  const abs = path.resolve(refPath);
  if (!existsSync(abs)) {
    throw Object.assign(new Error(`找不到参考图：${abs}`), { code: 'ENOENT' });
  }
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`不支持的参考图格式 ${ext || '(无扩展名)'}，请用 png/jpg/webp/gif/svg`);
  }
  const buf = await readFile(abs);
  // 过大时仍嵌入，但给出提示（自包含 HTML 体积会涨）
  if (buf.length > 1.5 * 1024 * 1024) {
    process.stderr.write(
      `警告：参考图 ${(buf.length / 1024 / 1024).toFixed(1)} MB，嵌入后 HTML 会显著变大。\n`,
    );
  }
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const prev = chart.reference && typeof chart.reference === 'object' ? chart.reference : {};
  if (engine && typeof engine.resolveReference === 'function') {
    chart.reference = engine.resolveReference(chart, {
      ...prev,
      image: dataUrl,
      imageMime: mime,
      caption: prev.caption || '参考图 · 部件对照（点击定位）',
    });
  } else {
    chart.reference = {
      ...prev,
      image: dataUrl,
      imageMime: mime,
      caption: prev.caption || '参考图 · 部件对照（点击定位）',
      regions: prev.regions || [],
    };
  }
  return chart;
}

/**
 * 模板缺失时的兜底骨架。
 *
 * 注意：这不是替代 template-dev 的模板，只是让注入链路可测。
 * 真正的交付 HTML 由 templates/gummy-atelier.html 决定。
 */
const MINIMAL_SKELETON = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>软糖图解（骨架）</title></head>
<body>
<div id="app">模板缺失，仅验证注入链路。</div>
<script>
/*__GUMMY_ENGINE__*/
</script>
<script>
window.__GUMMY_CHART__ = /*__GUMMY_CHART__*/null;
</script>
</body>
</html>
`;

/** 把字符串安全地嵌进 <script> —— 防止 chart 里的 </script> 截断文档 */
function safeJsonForScript(obj) {
  return JSON.stringify(obj, null, 2).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  // ── 1. 读 chart ──
  let chart;
  try {
    chart = await readJsonFile(opts.chart);
  } catch (err) {
    if (err.code === 'ENOENT') usage(`找不到 chart 文件：${opts.chart}`);
    usage(`无法读取或解析 ${opts.chart}：${err.message}`);
  }

  // ── 1b. 补齐 / 嵌入参考图（部件热区）──
  let engineForRef = null;
  try {
    engineForRef = await loadEngine();
  } catch (err) {
    if (!(err instanceof EngineLoadError)) throw err;
  }
  if (engineForRef && typeof engineForRef.resolveReference === 'function') {
    chart.reference = engineForRef.resolveReference(chart, chart.reference || null);
  }
  if (opts.ref) {
    try {
      await embedReference(chart, opts.ref, engineForRef);
      process.stdout.write(`已嵌入参考图：${path.resolve(opts.ref)}\n`);
    } catch (err) {
      if (err.code === 'ENOENT') usage(err.message);
      usage(`无法嵌入参考图：${err.message}`);
    }
  }

  // ── 2. 读模板（容忍模板还没被 template-dev 写出来）──
  let template;
  const tplPath = path.resolve(opts.template);
  if (!existsSync(tplPath)) {
    if (!opts.allowMissingTemplate) {
      process.stderr.write(
        `错误：找不到模板文件\n` +
          `  期望路径：${tplPath}\n\n` +
          `模板 templates/gummy-atelier.html 由 template-dev 负责（契约 §7），可能尚未生成。\n` +
          `可选做法：\n` +
          `  · 等模板落地后重跑本命令；\n` +
          `  · 或用 --template <其它模板路径> 指定别处；\n` +
          `  · 或加 --allow-missing-template 用内置最小骨架验证注入链路。\n`,
      );
      process.exit(EXIT_USAGE);
    }
    process.stderr.write(
      `警告：模板缺失（${tplPath}），已按 --allow-missing-template 使用内置最小骨架。\n` +
        `      产出的 HTML 不是正式交付物。\n`,
    );
    template = MINIMAL_SKELETON;
  } else {
    template = await readFile(tplPath, 'utf8');
  }

  // ── 3. 检查占位符 ──
  const hasChart = template.includes(CHART_PLACEHOLDER);
  const hasEngine = template.includes(ENGINE_PLACEHOLDER);
  if (!hasChart && !hasEngine) {
    process.stderr.write(
      `错误：模板里找不到任何注入占位符\n` +
        `  模板：${tplPath}\n` +
        `  契约 §5 要求保留：\n` +
        `    ${CHART_PLACEHOLDER}\n` +
        `    ${ENGINE_PLACEHOLDER}\n`,
    );
    process.exit(EXIT_USAGE);
  }
  if (!hasChart) process.stderr.write(`警告：模板缺少图表占位符 ${CHART_PLACEHOLDER}，未注入 chart。\n`);
  if (!hasEngine) process.stderr.write(`警告：模板缺少引擎占位符 ${ENGINE_PLACEHOLDER}，未注入引擎（HTML 将不自包含）。\n`);

  // ── 4. 引擎：优先用已加载的模块，保证 HTML 里的引擎与校验用的是同一份 ──
  let engineSource = '';
  if (hasEngine) {
    if (!existsSync(ENGINE_PATH)) {
      process.stderr.write(
        `错误：找不到引擎源码 ${ENGINE_PATH}\n` +
          `      契约 §5 要求 HTML 单文件自包含，需要把引擎源码注入模板。\n`,
      );
      process.exit(EXIT_USAGE);
    }
    engineSource = await readFile(ENGINE_PATH, 'utf8');
    // 防御：源码里若含 </script> 会截断文档
    if (/<\/script/i.test(engineSource)) {
      engineSource = engineSource.replace(/<\/(script)/gi, '<\\/$1');
    }
  }

  // ── 5. 注入 ──
  let html = template;
  if (hasChart) {
    // 保留原有的 `null` 语义：把占位符整体替换成 JSON 字面量
    html = html.split(CHART_PLACEHOLDER).join(safeJsonForScript(chart));
  }
  if (hasEngine) {
    html = html.split(ENGINE_PLACEHOLDER).join(engineSource);
  }

  // ── 6. 校验图表本身，失败仍写出但退出码 1 ──
  let validation = chart.validation;
  let verdict = true;
  if (!validation) {
    try {
      const engine = await loadEngine();
      validation = engine.validateChart(chart);
      verdict = validation.ok;
    } catch (err) {
      if (err instanceof EngineLoadError) {
        process.stderr.write(`警告：无法复校图表（引擎不可用）：${err.message}\n`);
      } else throw err;
    }
  } else {
    verdict = validation.ok !== false;
  }

  // ── 7. 写出 ──
  try {
    await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
    await writeFile(opts.out, html, 'utf8');
  } catch (err) {
    process.stderr.write(`错误：无法写出 ${opts.out}：${err.message}\n`);
    process.exit(EXIT_USAGE);
  }

  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  process.stdout.write(`\n软糖图解 · HTML 渲染完成\n`);
  process.stdout.write(`作品：${chart.name || '(未命名)'}\n`);
  process.stdout.write(`模板：${existsSync(tplPath) ? tplPath : '(内置最小骨架)'}\n`);
  process.stdout.write(`输出：${path.resolve(opts.out)}  (${sizeKb} KB，单文件自包含)\n`);
  process.stdout.write(`注入：chart ${hasChart ? '✓' : '✗'}   引擎 ${hasEngine ? '✓' : '✗'} (${(engineSource.length / 1024).toFixed(1)} KB)\n`);

  if (validation) {
    const s = validation.summary || {};
    process.stdout.write(
      `图表：${verdict ? '✓ 校验通过' : '✗ 校验未通过'}  ${s.rounds ?? '?'} 圈 / ${s.totalStitches ?? '?'} 针\n`,
    );
  }
  if (!verdict) {
    process.stdout.write('\n图表未通过校验，HTML 已写出但内容可能不可信：\n');
    for (const e of validation.errors || []) process.stdout.write(`  ✗ ${e}\n`);
    process.stdout.write('\n');
    process.exit(EXIT_INVALID);
  }

  // ── 8. --check：用 DOM 桩跑一遍产物，抓「白屏」类问题 ──
  if (opts.check) {
    const checker = path.join(HERE, '_selftest', 'render-check.mjs');
    process.stdout.write('\n▍渲染自检（--check）\n');
    if (!existsSync(checker)) {
      process.stderr.write(
        `警告：找不到渲染自检脚本 ${checker}，跳过 --check。\n`,
      );
    } else {
      const { spawnSync } = await import('node:child_process');
      const res = spawnSync(process.execPath, [checker, path.resolve(opts.out)], {
        encoding: 'utf8',
      });
      const body = `${res.stdout || ''}${res.stderr || ''}`.trimEnd();
      for (const line of body.split('\n')) process.stdout.write(`  ${line}\n`);
      if (res.status !== 0) {
        process.stdout.write('\n结论：✗ 渲染自检未通过 —— HTML 已写出，但页面可能不完整。\n\n');
        process.exit(EXIT_INVALID);
      }
      process.stdout.write('\n结论：✓ 渲染自检通过\n\n');
    }
  } else {
    process.stdout.write('\n');
  }
  process.exit(EXIT_OK);
}

run().catch((err) => {
  process.stderr.write(`内部错误：${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT_USAGE);
});
