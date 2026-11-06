// 统一路径解析：所有测试都从本文件推工作区根，保证在任意 cwd 下可跑
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <root>/tests/lib
export const ROOT = path.resolve(HERE, '..', '..');
export const TESTS_DIR = path.join(ROOT, 'tests');
export const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
export const CASES_DIR = path.join(TESTS_DIR, 'cases');

export const ENGINE_PATH = path.join(ROOT, 'engine', 'gummy-engine.js');
export const TOOLS_DIR = path.join(ROOT, 'tools');
export const TEMPLATE_PATH = path.join(ROOT, 'templates', 'gummy-atelier.html');
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const CONTRACT_PATH = path.join(ROOT, 'docs', 'CONTRACT.md');

export const CLI = {
  validate: path.join(TOOLS_DIR, 'validate-chart.mjs'),
  build: path.join(TOOLS_DIR, 'build-chart.mjs'),
  render: path.join(TOOLS_DIR, 'render-html.mjs'),
  photo: path.join(TOOLS_DIR, 'analyze_photo.py'),
  identity: path.join(TOOLS_DIR, 'check-identity.mjs'),
  markdown: path.join(TOOLS_DIR, 'export-markdown.mjs'),
};

/** 任务书给定的测试照片（266x264 PNG） */
export const PHOTO_PATH = 'C:\\Users\\17130\\.dsh\\attachments\\v1\\objects\\b6\\b6911dfb6f5adc169a11c8d9e7e0c7758dc041f4d2ca4c0028bf1e5dd376d8da';

export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

export function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

export function readJson(p) {
  return JSON.parse(readText(p));
}

export function fixture(...segments) {
  return path.join(FIXTURES_DIR, ...segments);
}

const tmpDirs = [];

/** 每个进程一个临时目录，避免污染 tests/ */
export function tmpDir(tag = 'gummy') {
  if (!tmpDirs.length) tmpDirs.push(fs.mkdtempSync(path.join(os.tmpdir(), `gummy-qa-${process.pid}-`)));
  const base = tmpDirs[0];
  const dir = path.join(base, tag);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function tmpFile(tag, name) {
  return path.join(tmpDir(tag), name);
}

export function cleanupTmp() {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  tmpDirs.length = 0;
}
