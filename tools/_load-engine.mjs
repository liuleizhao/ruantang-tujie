/**
 * tools/_load-engine.mjs —— 引擎加载器（tools/ 内部共享，非契约 API）
 *
 * 契约 §3 要求 `engine/gummy-engine.js` 是 UMD 单文件：浏览器挂 `window.GummyEngine`，
 * Node 侧既能 `require` 也能 `import`。但引擎最终以哪种写法落地，取决于 Lead 的实现，
 * 而 `package.json` 里可能没有 `"type": "module"`。所以这里按**三级回退**加载：
 *
 *   1. 直接 `import()` —— 兼容 CJS 文件（Node 自动包一层）与 ESM 文件；
 *   2. `createRequire().require()` —— 兜底 CJS；
 *   3. 把源码当 `data:url` 再 import —— 兜底「.js 里写了 ESM 语法但没 type:module」的情况，
 *      这种情况直接 import 会报解析错误，但源码本身是合法的 ESM。
 *
 * 拿到模块后按 `GummyEngine` → `default.GummyEngine` → `default` → 模块本身 的顺序取导出。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** tools/ 目录（本文件所在目录） */
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 引擎文件相对仓库根的位置（契约 §7：engine/ 归 engine-dev） */
export const ENGINE_PATH = path.resolve(TOOLS_DIR, '..', 'engine', 'gummy-engine.js');

/** 契约 §5 的模板路径 */
export const TEMPLATE_PATH = path.resolve(TOOLS_DIR, '..', 'templates', 'gummy-atelier.html');

export class EngineLoadError extends Error {}

/** 从任意模块形状里嗅出 GummyEngine 对象 */
function pickEngine(mod) {
  if (!mod) return null;
  if (mod.GummyEngine) return mod.GummyEngine;
  if (mod.default && mod.default.GummyEngine) return mod.default.GummyEngine;
  if (mod.default && typeof mod.default === 'object') return mod.default;
  if (typeof mod === 'object') return mod;
  return null;
}

/**
 * 载入引擎并校验必备 API。
 * @param {string} [enginePath] 覆盖默认路径（自测用）
 * @returns {Promise<object>} GummyEngine
 */
export async function loadEngine(enginePath = ENGINE_PATH) {
  if (!existsSync(enginePath)) {
    throw new EngineLoadError(
      `找不到引擎文件：${enginePath}\n` +
        `契约 §3 要求 engine/gummy-engine.js 是 UMD 单文件，请确认引擎已生成。`,
    );
  }

  const attempts = [];
  let mod = null;

  // 1) 直接 import
  try {
    mod = await import(pathToFileURL(enginePath).href);
  } catch (err) {
    attempts.push(`import(): ${err.message}`);

    // 2) require 兜底
    try {
      const require = createRequire(pathToFileURL(enginePath).href);
      mod = require(enginePath);
    } catch (err2) {
      attempts.push(`require(): ${err2.message}`);

      // 3) 源码当 data:url ESM 再 import
      try {
        const src = await readFile(enginePath, 'utf8');
        const dataUrl = `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;
        mod = await import(dataUrl);
      } catch (err3) {
        attempts.push(`data-url import(): ${err3.message}`);
        throw new EngineLoadError(
          `无法加载引擎 ${enginePath}，三种方式均失败：\n  - ${attempts.join('\n  - ')}`,
        );
      }
    }
  }

  const engine = pickEngine(mod);
  if (!engine || typeof engine !== 'object') {
    throw new EngineLoadError(
      `${enginePath} 已加载但导出的不是 GummyEngine 对象；` +
        `契约 §3 要求导出 window.GummyEngine / module.exports 上含 VERSION、buildChart 等。`,
    );
  }

  // 缺 API 时给出精确提示，而不是让调用方在深处崩掉
  const REQUIRED = ['VERSION', 'buildChart', 'validateChart', 'yarnEstimate'];
  const missing = REQUIRED.filter((k) => engine[k] === undefined);
  if (missing.length) {
    throw new EngineLoadError(
      `引擎缺少契约 §3 要求的 API：${missing.join(', ')}`,
    );
  }

  return engine;
}

/**
 * 读取 JSON 文件，去掉 UTF-8 BOM。
 *
 * Windows 上的 PowerShell 5.1 `Set-Content -Encoding UTF8`、记事本「另存为 UTF-8」、
 * Excel 导出的 JSON 都会带 BOM（EF BB BF）。`JSON.parse` 遇到 BOM 会直接抛
 * `Unexpected token '﻿'`，而报错信息里的 BOM 不可见，极难排查。
 * 契约没规定编码细节，这里对所有 JSON 读取统一做宽容处理。
 */
export async function readJsonFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(text);
}

/** 逐圈记法的兜底实现：引擎没给 toNotation 时也能打印 */export function safeNotation(engine, part) {
  try {
    if (typeof engine.toNotation === 'function') {
      const lines = engine.toNotation(part);
      if (Array.isArray(lines) && lines.length) return lines;
    }
  } catch {
    /* 落到下面的兜底 */
  }
  return (part.rounds || []).map((rd) => {
    const ops = (rd.ops || [])
      .map((o) => (o.n > 1 ? `${o.sym}${o.n}` : o.sym))
      .join(' ');
    return `R${rd.r} ${ops} = ${rd.stitchesOut}`;
  });
}

/** 两位小数的安全格式化 */
export function fmt(n, digits = 1) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}
