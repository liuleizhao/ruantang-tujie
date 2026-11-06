#!/usr/bin/env node
/**
 * tools/check-identity.mjs —— 还原度 / 特征完备性自检（契约 §4.6）
 *
 * 用法：
 *   node tools/check-identity.mjs <toySpec.json|chart.json>
 *
 * 只看规格/图解（不看照片），回答「特征层是否够认出是谁」。
 * 退出码：0 齐备 / 1 缺关键特征 / 2 用法或 IO 错误。
 */

import { EngineLoadError, loadEngine, readJsonFile } from './_load-engine.mjs';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function usage(msg) {
  if (msg) process.stderr.write(`错误：${msg}\n\n`);
  process.stderr.write('用法：node tools/check-identity.mjs <toySpec.json|chart.json>\n');
  process.exit(EXIT_USAGE);
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) {
    usage(args.length ? `参数不对：${args.join(' ')}` : '缺少 toySpec/chart 参数');
  }
  const path = args[0];

  let doc;
  try {
    doc = await readJsonFile(path);
  } catch (err) {
    if (err.code === 'ENOENT') usage(`找不到文件：${path}`);
    usage(`无法读取或解析 ${path}：${err.message}`);
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

  if (typeof engine.assessIdentity !== 'function') {
    process.stderr.write('错误：当前引擎不支持 assessIdentity（需要 ≥ 1.1.0）\n');
    process.exit(EXIT_USAGE);
  }

  const result = engine.assessIdentity(doc);
  const name = doc.name || (doc.spec && doc.spec.name) || '(未命名)';

  process.stdout.write(`\n软糖图解 · 还原度自检\n`);
  process.stdout.write(`作品：${name}\n`);
  process.stdout.write(`风格：${result.style || '?'}    得分：${result.score}/100\n\n`);

  for (const c of result.checks || []) {
    process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(16)} ${c.detail}\n`);
  }

  if (result.notes && result.notes.length) {
    process.stdout.write('\n说明：\n');
    for (const n of result.notes) process.stdout.write(`  · ${n}\n`);
  }

  process.stdout.write('\n');
  if (result.ok) {
    process.stdout.write('结论：✓ 识别级特征齐备 —— 可进入 build / validate / 交付。\n\n');
    process.exit(EXIT_OK);
  }
  process.stdout.write(
    `结论：✗ 缺关键特征 —— ${ (result.missing || []).join(', ') || '见上表' }\n` +
      `请先补齐 toySpec 再生成图解。\n\n`,
  );
  process.exit(EXIT_INVALID);
}

run().catch((err) => {
  process.stderr.write(`内部错误：${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT_USAGE);
});
