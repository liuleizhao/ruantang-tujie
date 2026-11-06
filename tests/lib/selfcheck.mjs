// 自证：用参考校验器检查 fixtures 是否「该过的过、该挂的挂」。
// 用法：node tests/lib/selfcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR, rel } from './paths.mjs';
import { referenceValidate } from './reference-validator.mjs';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
let bad = 0;
const log = (ok, msg) => {
  if (!ok) bad += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
};

console.log('\n〔自证〕合格 fixture 必须 ok===true');
for (const f of ['good-chart.json', 'decor-good-chart.json', 'loop-clean-chart.json', 'loop-null-chart.json']) {
  const v = referenceValidate(readJson(path.join(FIXTURES_DIR, f)));
  log(v.ok && v.warnings.length === 0, `${f}  ok=${v.ok} warnings=${v.warnings.length}` +
    (v.ok ? '' : `\n      ${v.errors.join('\n      ')}`));
}

console.log('\n〔自证〕loop-warn fixture 必须 ok===true 但有 warning');
{
  const v = referenceValidate(readJson(path.join(FIXTURES_DIR, 'loop-warn-chart.json')));
  log(v.ok && v.warnings.length > 0, `loop-warn-chart.json  ok=${v.ok} warnings=${v.warnings.length}` +
    `\n      warnings: ${v.warnings.join(' | ')}`);
}

console.log('\n〔自证〕坏图必须 ok===false 且命中声明的规则');
const manifest = readJson(path.join(FIXTURES_DIR, 'bad-charts', 'manifest.json'));
for (const m of manifest) {
  const v = referenceValidate(readJson(path.join(FIXTURES_DIR, 'bad-charts', path.basename(m.file))));
  const hitRule = v.errors.some((e) => new RegExp(`\\b${m.rule}\\b`).test(e));
  const hitRound = v.errors.some((e) => new RegExp(`R${m.round}(?![0-9])`).test(e) || new RegExp(`第\\s*${m.round}\\s*圈`).test(e));
  log(!v.ok && hitRule && hitRound, `${m.file}  ${m.rule} 圈${m.round}  ok=${v.ok} 命中规则=${hitRule} 命中圈号=${hitRound}` +
    `\n      errors: ${v.errors.join(' | ')}`);
}

console.log('\n〔自证〕toyspec fixtures 结构完整性');
for (const f of ['toyspec-5part.json', 'toyspec-v11.json']) {
  const s = readJson(path.join(FIXTURES_DIR, f));
  const okParts = Array.isArray(s.parts) && s.parts.length > 0 && s.parts.every((p) => p.id && p.shape && p.shape.kind);
  log(okParts && !!s.palette && !!s.gauge, `${f}  parts=${s.parts.length} palette=${s.palette.length}`);
}

const summary = referenceValidate(readJson(path.join(FIXTURES_DIR, 'good-chart.json'))).summary;
console.log(`\n〔参考〕good-chart summary: ${JSON.stringify(summary)}`);
console.log(`\n${bad === 0 ? '自证通过：fixtures 语义正确' : `自证失败：${bad} 项`}  (${rel(FIXTURES_DIR)})\n`);
process.exit(bad === 0 ? 0 : 1);
