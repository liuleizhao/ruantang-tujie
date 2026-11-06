import { findExternalRefs } from '../../tests/lib/no-external.mjs';
import { readFileSync } from 'node:fs';

const tpl = readFileSync('templates/gummy-atelier.html', 'utf8');
const hits = findExternalRefs(tpl);
console.log('模板外链命中:', hits.length);
for (const h of hits) console.log('  ·', h.label, '|', h.sample);

const raw = tpl.match(/https?:\/\/[^\s"')]+/gi) || [];
console.log('裸 http 串:', [...new Set(raw)]);

import { existsSync } from 'node:fs';
const out = process.env.TEMP + '/g2.html';
if (existsSync(out)) {
  const h2 = findExternalRefs(readFileSync(out, 'utf8'));
  console.log('渲染产物外链命中:', h2.length);
  for (const h of h2) console.log('  ·', h.label, '|', h.sample);
}
