/**
 * tools/_selftest/render-check.mjs
 * 用最小 DOM 桩在 Node 里执行渲染后的 HTML，验证模板脚本能真正跑出内容。
 * 这不是正式测试（正式测试在 tests/），只是 Lead 验收用的独立证据。
 *
 * 用法：node tools/_selftest/render-check.mjs <rendered.html>
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2];
if (!file) { console.error('用法：node render-check.mjs <rendered.html>'); process.exit(2); }

const html = readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length < 3) {
  console.error('期望 3 个 <script> 块（引擎 / 数据 / 应用），实际 ' + scripts.length);
  process.exit(1);
}

/* ---------- 最小 DOM ---------- */
let created = [];
function mkEl(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeName: String(tag || 'div').toUpperCase(),
    children: [], attrs: {}, style: {}, _html: '', _text: '', _cls: '',
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    setAttributeNS(_ns, k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBBox() { return { x: 0, y: 0, width: 100, height: 100 }; }
  };
  Object.defineProperty(n, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); }
  });
  Object.defineProperty(n, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); }
  });
  Object.defineProperty(n, 'className', {
    get() { return this._cls; },
    set(v) { this._cls = String(v); }
  });
  created.push(n);
  return n;
}

const appEl = mkEl('div');
const byId = { app: appEl, title: mkEl('h1'), subtitle: mkEl('div') };

const documentStub = {
  getElementById(id) { return byId[id] || null; },
  createElement: mkEl,
  createElementNS: (ns, t) => mkEl(t),
  createTextNode: t => { const n = mkEl('text'); n._text = String(t); return n; },
  createDocumentFragment: () => mkEl('fragment'),
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  title: ''
};

const windowStub = {
  addEventListener() {},
  removeEventListener() {},
  print() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  GummyEngine: null,
  __GUMMY_CHART__: null
};

const localStorageStub = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const sandbox = {
  window: windowStub,
  document: documentStub,
  localStorage: localStorageStub,
  console,
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
  Image: function Image() { this.naturalWidth = 100; this.naturalHeight = 100; },
  setTimeout, clearTimeout,
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isFinite, isNaN
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const ctx = vm.createContext(sandbox);

/* ---------- 1. 引擎 ---------- */
const engineCtx = { module: { exports: {} }, exports: {}, window: windowStub, globalThis: windowStub, console };
vm.createContext(engineCtx);
vm.runInContext(scripts[0], engineCtx, { filename: 'engine.js' });
const E = engineCtx.module.exports;
if (!E || !E.VERSION) { console.error('FAIL: 引擎未导出'); process.exit(1); }
console.log('✓ 引擎加载  VERSION=' + E.VERSION + '  导出 ' + Object.keys(E).length + ' 项');
windowStub.GummyEngine = E;
sandbox.GummyEngine = E;

/* ---------- 2. 数据 ---------- */
vm.runInContext(scripts[1], ctx, { filename: 'data.js' });
const chart = windowStub.__GUMMY_CHART__;
if (!chart) { console.error('FAIL: chart 未注入'); process.exit(1); }
console.log('✓ 数据注入  《' + chart.name + '》 ' + chart.parts.length + ' 部件 ' +
  chart.validation.summary.rounds + ' 圈');

/* ---------- 3. 应用 ---------- */
let appErr = null;
try {
  vm.runInContext(scripts[2], ctx, { filename: 'app.js' });
} catch (e) {
  appErr = e;
}
if (appErr) {
  console.error('✗ 模板脚本抛错：' + appErr.message);
  console.error(String(appErr.stack).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('✓ 模板脚本执行无异常');

/* ---------- 4. 检查产物 ---------- */
const built = appEl.children;
console.log('✓ app 子节点 ' + built.length + ' 个');
const classes = built.map(c => (c.className || c.tagName || '').trim()).filter(Boolean);
console.log('  ' + classes.join(' | '));

// 关键内容是否真的出现在 innerHTML 里
const allHtml = created.map(n => n._html || '').join('\n');
const allText = created.map(n => n._text || '').join('\n');
const blob = allHtml + '\n' + allText;

const mustHave = [
  [chart.name, '作品名'],
  ['用线', '用线量章节'],
  ['符号图例', '符号图例'],
  ['逐圈图解', '逐圈图解'],
  ['自检结果', '自检结果'],
  ['参考图', '参考图对照']
];
let fail = 0;
for (const [needle, label] of mustHave) {
  const ok = blob.includes(needle) || (byId.title && String(byId.title._text || '').includes(needle));
  if (!ok) { console.error('✗ 缺少：' + label + '（"' + needle + '"）'); fail++; }
  else console.log('✓ 含 ' + label);
}

// 每一圈的记法是否都渲染出来了
let roundHits = 0;
for (const p of chart.parts) {
  for (const rd of p.rounds) {
    if (blob.includes('data-r="' + rd.r + '"') || blob.includes('R' + rd.r)) roundHits++;
  }
}
const totalRounds = chart.validation.summary.rounds;
console.log((roundHits >= totalRounds ? '✓ ' : '✗ ') + '圈号覆盖 ' + roundHits + '/' + totalRounds);
if (roundHits < totalRounds) fail++;

// SVG 是否生成
const svgCount = created.filter(n => n.tagName === 'SVG' || n.tagName === 'svg').length;
console.log((svgCount > 0 ? '✓ ' : '✗ ') + 'SVG 元素 ' + svgCount + ' 个（部件图 + 图例）');
if (!svgCount) fail++;

// 标题写入
console.log('  标题：' + (byId.title._text || '(未写入)'));

console.log('');
if (fail) { console.error('渲染检查失败：' + fail + ' 项'); process.exit(1); }
console.log('✓ 渲染检查全部通过');
