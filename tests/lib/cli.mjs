// 子进程封装：跑 tools/ 下的 CLI
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, rel } from './paths.mjs';

export function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 180000,
    windowsHide: true,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    signal: r.signal || null,
    error: r.error || null,
    cmd: `node ${args.map((a) => (String(a).includes(' ') ? JSON.stringify(a) : a)).join(' ')}`,
  };
}

let pythonCmdCache;
export function pythonCmd() {
  if (pythonCmdCache !== undefined) return pythonCmdCache;
  for (const cand of ['python', 'py', 'python3']) {
    const r = spawnSync(cand, ['-c', 'import sys;print(sys.version_info[0])'], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    if (r.status === 0 && String(r.stdout).trim().startsWith('3')) {
      pythonCmdCache = cand;
      return cand;
    }
  }
  pythonCmdCache = null;
  return null;
}

export function runPython(args, opts = {}) {
  const cmd = opts.cmd || pythonCmd();
  if (!cmd) {
    return { status: -1, stdout: '', stderr: 'python 不可用', error: new Error('python not found'), cmd: 'python ...' };
  }
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 300000,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(opts.env || {}) },
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
    cmd: `${cmd} ${args.join(' ')}`,
  };
}

/** 宽松 JSON 解析：允许 CLI 在 JSON 前后打印人类可读日志 */
export function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'stdout 为空' };
  try { return { ok: true, value: JSON.parse(raw) }; } catch { /* 继续 */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = raw.slice(start, end + 1);
    try { return { ok: true, value: JSON.parse(slice), from: 'extracted' }; } catch { /* 继续 */ }
  }
  return { ok: false, reason: `stdout 不是合法 JSON: ${raw.slice(0, 400)}` };
}

export function describeRun(r) {
  const out = String(r.stdout || '').trim();
  const err = String(r.stderr || '').trim();
  return [
    `命令: ${r.cmd}`,
    `退出码: ${r.status}`,
    out ? `stdout: ${out.length > 1200 ? out.slice(0, 1200) + '…' : out}` : 'stdout: (空)',
    err ? `stderr: ${err.length > 1200 ? err.slice(0, 1200) + '…' : err}` : 'stderr: (空)',
  ].join('\n  ');
}

/** 断言退出码，失败时把命令输出整体带出（方便贴给 lead） */
export function expectStatus(assert, r, expected, msg) {
  if (r.status !== expected) {
    throw new (class extends Error {})(`${msg}\n  期望退出码 ${expected}，实际 ${r.status}\n  ${describeRun(r)}`);
  }
}

export function fileExists(p) {
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
}

/** CLI 是否已交付 */
export function cliReady(p) {
  return fileExists(p);
}

export function relTool(p) {
  return rel(path.resolve(p));
}
