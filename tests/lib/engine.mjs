// 引擎加载器：契约 §3 要求 UMD（浏览器全局 + Node import/require 双通）
// 这里提供两条加载路径：Node 动态 import；以及 vm 沙箱模拟浏览器全局。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { ENGINE_PATH, rel } from './paths.mjs';

function looksLikeEngine(E) {
  return !!E && typeof E === 'object' &&
    (typeof E.VERSION !== 'undefined' || typeof E.validateChart === 'function');
}

/** 在 vm 里以「浏览器脚本」方式执行引擎源码，返回挂到全局的 GummyEngine */
export function loadAsBrowserScript(src = fs.readFileSync(ENGINE_PATH, 'utf8')) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(ENGINE_PATH) });
  return {
    global: sandbox,
    engine: sandbox.GummyEngine || (sandbox.window && sandbox.window.GummyEngine) || null,
  };
}

/** 以 CommonJS 方式在 vm 里执行（模拟 require） */
function loadAsCommonJs(src) {
  const moduleObj = { exports: {} };
  const sandbox = { module: moduleObj, exports: moduleObj.exports, console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(ENGINE_PATH) });
  if (moduleObj.exports && looksLikeEngine(moduleObj.exports)) return moduleObj.exports;
  if (moduleObj.exports && moduleObj.exports.GummyEngine) return moduleObj.exports.GummyEngine;
  return sandbox.GummyEngine || (sandbox.window && sandbox.window.GummyEngine) || null;
}

/**
 * 加载引擎。返回 { ok, E, how } 或 { ok:false, missing?, reason, src? }
 * 不抛异常——由调用方决定 skip（标红）还是报错。
 */
export async function loadEngine() {
  if (!fs.existsSync(ENGINE_PATH)) {
    return { ok: false, missing: true, reason: `尚未生成 ${rel(ENGINE_PATH)}` };
  }
  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  const problems = [];

  // 路径 1：Node 动态 import（CJS-UMD 时 default 即 module.exports）
  try {
    const mod = await import(pathToFileURL(ENGINE_PATH).href);
    const candidates = [mod.default, mod.GummyEngine, mod.Engine, mod];
    const E = candidates.find(looksLikeEngine);
    if (E) return { ok: true, E, how: 'import', src };
    problems.push('import 成功但找不到 VERSION / validateChart 导出');
  } catch (e) {
    problems.push(`import 失败: ${String(e && e.message || e).split('\n')[0]}`);
  }

  // 路径 2：vm + CommonJS 沙箱
  try {
    const E = loadAsCommonJs(src);
    if (looksLikeEngine(E)) return { ok: true, E, how: 'vm-cjs', src };
    problems.push('vm(CJS) 执行后未挂 GummyEngine / module.exports');
  } catch (e) {
    problems.push(`vm(CJS) 执行失败: ${String(e && e.message || e).split('\n')[0]}`);
  }

  return { ok: false, reason: `${rel(ENGINE_PATH)} 无法作为 UMD 加载（契约 §3）：${problems.join(' | ')}`, src };
}

/** 需要引擎或跳过（跳过计失败：引擎是必交付项） */
export async function engineOrSkip(h, ctx) {
  if (ctx.engine && ctx.engine.ok) return ctx.engine.E;
  const reason = ctx.engine && ctx.engine.reason ? ctx.engine.reason : `无法加载 ${rel(ENGINE_PATH)}`;
  h.skip('（整组）引擎可用性 — 依赖 engine/gummy-engine.js', reason);
  return null;
}

export function engineRel() {
  return rel(ENGINE_PATH);
}
