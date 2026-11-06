// 单一入口：node tests/run-tests.mjs
// 全部通过（含无失败、无跳过）→ 退出码 0；否则 1。
import fs from 'node:fs';
import path from 'node:path';
import { createHarness } from './lib/harness.mjs';
import * as P from './lib/paths.mjs';
import { loadEngine } from './lib/engine.mjs';
import { cleanupTmp } from './lib/paths.mjs';
import * as B from './lib/builders.mjs';

const CASE_FILES = [
  'a-engine-api.mjs',
  'b-ops.mjs',
  'c-invariants.mjs',
  'd-buildshape.mjs',
  'e-buildchart.mjs',
  'g-layout-quantize.mjs',
  'i-cli.mjs',
  'j-template-k-skills.mjs',
  'l-m-n-o-p-v11.mjs',
  'q-template-v11.mjs',
  'r-craft-identity.mjs',
];

async function main() {
  // 只跑指定分组：node tests/run-tests.mjs --only=C,M   （便于定位）
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toUpperCase()) : null;

  const h = createHarness();

  if (only) {
    h.note(`过滤模式: 仅跑分组 ${only.join(',')}`);
    // 用 section 名字前缀过滤：需要在 register 前后钩住，这里用最简单的方式——
    // harness.section 记录，it 时判前缀。给 harness 补一个过滤器。
    h._filter = (section) => only.some((o) => section.trim().toUpperCase().startsWith(o));
  }

  const engine = await loadEngine();
  const ctx = {
    ROOT: P.ROOT,
    rel: P.rel,
    fixtures: P.fixture,
    tmpFile: P.tmpFile,
    tmpDir: P.tmpDir,
    TEMPLATE_PATH: P.TEMPLATE_PATH,
    SKILLS_DIR: P.SKILLS_DIR,
    CLI: P.CLI,
    PHOTO_PATH: P.PHOTO_PATH,
    ENGINE_PATH: P.ENGINE_PATH,
    engine,
    readJson: P.readJson,
    readText: P.readText,
    builders: B,
  };

  // 引擎加载状态的横幅
  if (engine.ok) {
    console.log(`\n引擎已加载（${engine.how}）：${P.rel(P.ENGINE_PATH)}`);
  } else {
    console.log(`\n\x1b[31m引擎不可用\x1b[0m：${engine.reason}`);
  }

  const loaded = [];
  for (const file of CASE_FILES) {
    const full = path.join(P.CASES_DIR, file);
    if (!fs.existsSync(full)) {
      console.log(`\x1b[33m警告: 用例文件缺失 ${file}\x1b[0m`);
      continue;
    }
    const mod = await import(new URL(`./cases/${file}`, import.meta.url).href);
    if (typeof mod.register !== 'function') {
      console.log(`\x1b[33m警告: ${file} 未导出 register()\x1b[0m`);
      continue;
    }
    loaded.push(file);
    mod.register(h, ctx);
  }

  const result = await h.run();
  cleanupTmp();

  // 结果落盘，方便 lead 直接看
  try {
    const outDir = path.join(P.TESTS_DIR, 'report');
    fs.mkdirSync(outDir, { recursive: true });
    const report = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      engine: engine.ok ? { ok: true, how: engine.how } : { ok: false, reason: engine.reason },
      caseFiles: loaded,
      totals: { total: result.total, passed: result.passed, failed: result.failed, skipped: result.skipped },
      failures: result.rows.filter((r) => r.status === 'fail').map((r) => ({
        section: r.section, name: r.name, detail: r.detail,
      })),
      skips: result.rows.filter((r) => r.status === 'skip').map((r) => ({
        section: r.section, name: r.name, reason: r.skip,
      })),
    };
    fs.writeFileSync(path.join(outDir, 'last-run.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (e) {
    console.log(`（无法写出 tests/report/last-run.json: ${e.message}）`);
  }

  process.exitCode = result.exitCode;
}

main().catch((e) => {
  console.error('\x1b[31m测试入口自身崩溃:\x1b[0m');
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
