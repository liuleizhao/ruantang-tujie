/**
 * 从交付 HTML 抽内联引擎，在 Node 里实跑，验证页面不会白屏且数字自洽。
 * 用法：node scripts/verify-html.mjs [characters/<角色>/gummy.html]
 */
import fs from "node:fs";
import vm from "node:vm";

const file = process.argv[2] || "characters/绿发少女/gummy.html";
if (!fs.existsSync(file)) {
  console.error(`✗ 找不到 HTML：${file}\n用法：node scripts/verify-html.mjs [characters/<角色>/gummy.html]`);
  process.exit(2);
}
const html = fs.readFileSync(file, "utf8");
const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.error("✗ 未找到内联脚本"); process.exit(1); }
const src = m[1];

const engineEnd = src.indexOf("/* ---------- 交互");
const body = src.slice(0, engineEnd);
const renderStart = src.indexOf("function esc(s)");
const engineSrc = src.slice(0, renderStart);
const renderSrc = src.slice(renderStart, engineEnd);

function stubEl() {
  return {
    innerHTML: "", textContent: "", style: {},
    classList: { add(){}, remove(){}, contains(){ return false; } },
    addEventListener(){}, closest(){ return null; }, getAttribute(){ return null; },
  };
}
const sandbox = {
  console, Math, JSON, Object, Array, String, Number, Date,
  document: {
    getElementById: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(){},
  },
  localStorage: { getItem: () => null, setItem(){} },
  confirm: () => false,
  window: { print(){} },
  globalThis: null,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(
    engineSrc +
    "\n;globalThis.__R=RESULT;globalThis.__Y=YARN;globalThis.__P=PARTS;" +
    "globalThis.__chart=chartSVG;globalThis.__notation=notation;globalThis.__OPS=OPS;" +
    renderSrc + "\n;globalThis.__renderParts=renderParts;globalThis.__renderVerify=renderVerify;",
    sandbox
  );
} catch (e) {
  console.error("✗ 脚本执行失败（页面会白屏）：", e.message);
  console.error(e.stack);
  process.exit(1);
}

const R = sandbox.__R, Y = sandbox.__Y, P = sandbox.__P, OPS = sandbox.__OPS;
const chartSVG = sandbox.__chart, notation = sandbox.__notation;

const pad = (s, n) => String(s).padEnd(n, " ");
let fail = [];

console.log("=".repeat(96));
console.log("一、逐圈校验表");
console.log("=".repeat(96));
for (const part of P) {
  const po = R.byId[part.id];
  console.log(`\n【${part.name}】${part.color} ×${part.mult} — ${po.n} 圈`);
  console.log("  " + pad("圈", 5) + pad("记法", 32) + pad("消耗", 7) + pad("产出", 7) + pad("增量", 7) + "结论");
  for (let i = 0; i < po.n; i++) {
    const rd = po.rows[i];
    let txt = (rd.prefix || "") + notation(part.rounds[i]);
    if (rd.decor.length) txt += ` ⟡${rd.decor[0].count}×${rd.decor[0].kind}`;
    if (rd.loop === "blo") txt += "〔内半针〕";
    const d = rd.sout - rd.sin;
    const okMark = rd.ok ? "✓" : "✗ " + rd.errors.join(";");
    if (!rd.ok) fail.push(...rd.errors.map(e => part.name + ": " + e));
    console.log("  " + pad("R" + rd.r, 5) + pad(txt, 32) + pad(rd.sin, 7) + pad(rd.sout, 7) +
      pad((d > 0 ? "+" : "") + d, 7) + okMark);
  }
  console.log(`  → 末圈 ${po.final} ｜ 单件 ${po.stitches} 针 ｜ ×${part.mult} = ${po.stitches * part.mult}`);
}

/* 独立复核 */
const CC = {}; for (const k in OPS) CC[k] = [OPS[k].c, OPS[k].p];
let rounds = 0, stitches = 0; const indep = [];
for (const part of P) {
  let prev = null;
  part.rounds.forEach((spec, i) => {
    rounds++;
    const seq = [];
    for (let t = 0; t < spec.times; t++)
      for (const [s, n] of spec.unit) for (let k = 0; k < n; k++) seq.push(s);
    let c = 0, p = 0;
    for (const s of seq) { c += CC[s][0]; p += CC[s][1]; }
    const magic = spec.kind === "magic";
    const sin = magic ? 0 : spec.sin, sout = p;
    if (!magic) {
      if (i > 0 && sin !== prev) indep.push(`${part.name} R${i + 1} 衔接：${sin} ≠ ${prev}`);
      if (c !== sin) indep.push(`${part.name} R${i + 1} 环内：Σ${c} ≠ ${sin}`);
      const n = x => seq.filter(y => y === x).length;
      const rhs = (n("V") + 2 * n("W") + n("CH")) - (n("A") + 2 * n("M") + n("SL") + n("K"));
      if (sout - sin !== rhs) indep.push(`${part.name} R${i + 1} 增减：${sout - sin} ≠ ${rhs}`);
    }
    if (sout < 6 || sout > 200) indep.push(`${part.name} R${i + 1} 越界 ${sout}`);
    prev = sout;
  });
  stitches += prev * part.mult;
}
for (const part of P) {
  if (!part.attach) continue;
  const at = part.attach, r = R.byId[at.part].rows[at.round - 1];
  if (r.sout !== at.stitches) indep.push(`${part.name} 接针 ${at.stitches} ≠ ${r.sout}`);
  if (r.loop === "both") indep.push(`${part.name} 接在没留半针的圈`);
}

console.log("\n" + "=".repeat(96));
console.log("二、独立复核");
console.log("=".repeat(96));
console.log(`圈数 ${rounds}（引擎 ${R.summary.rounds}）｜ 总针数 ${stitches}（引擎 ${R.summary.totalStitches}）`);
console.log(`装饰针迹 ${R.summary.decorCount} ｜ 留针圈 ${R.summary.reservedLoops}`);
console.log(`引擎：${R.ok ? "✓ 通过" : "✗ 未通过"} ｜ 复核：${indep.length ? "✗ " + indep.length + " 处" : "✓ 通过"}`);
indep.forEach(e => console.log("  · " + e));
R.errors.forEach(e => console.log("  引擎 · " + e));
R.warnings.forEach(e => console.log("  警告 · " + e));

console.log("\n" + "=".repeat(96));
console.log("三、SVG 符号图");
console.log("=".repeat(96));
let svgOk = true;
for (const part of P) {
  const po = R.byId[part.id];
  let svg;
  try { svg = chartSVG(part, po); }
  catch (e) { svgOk = false; console.log(`  ✗ ${part.name}: ${e.message}`); continue; }
  const rings = (svg.match(/class="ring"/g) || []).length;
  const paths = (svg.match(/<path /g) || []).length;
  const circles = (svg.match(/<circle r="2\.6"/g) || []).length;
  const syms = po.rows.reduce((s, r) => s + r.seq.filter(x => OPS[x].p > 0).length, 0);
  const ok = rings === po.n && (paths + circles) === syms;
  if (!ok) svgOk = false;
  console.log(`  ${ok ? "✓" : "✗"} ${part.name}: ${rings}/${po.n} 圈 · 符号 ${paths + circles}（应 ${syms}）· 长度 ${svg.length}B`);
}

console.log("\n" + "=".repeat(96));
console.log("四、自包含 / 功能");
console.log("=".repeat(96));
let selfOk = true;
const noExternal = [
  [/<link[^>]+href=/i, "外部样式表"], [/<script[^>]+src=/i, "外部脚本"],
  [/<img[^>]+src=/i, "<img>外链"], [/https?:\/\//i, "http(s)外链"],
  [/@import/i, "@import"], [/url\(\s*['"]?(?!data:)/i, "非data url()"],
];
for (const [re, label] of noExternal) {
  const hit = re.test(html);
  if (hit) { selfOk = false; console.log(`  ✗ 存在${label}`); } else console.log(`  ✓ 无${label}`);
}
const musts = [
  [/@media print/, "@media print"], [/localStorage/, "localStorage"],
  [/class="pchk"/, "勾选框"], [/data-part="/, "圈标记"], [/window\.print\(\)/, "打印按钮"],
];
for (const [re, label] of musts) {
  const hit = re.test(html);
  if (!hit) selfOk = false;
  console.log(`  ${hit ? "✓" : "✗"} ${label}`);
}
console.log(`  ✓ 内嵌 SVG ${(html.match(/<svg /g) || []).length} ｜ <style> ${(html.match(/<style>/g) || []).length} ｜ <script> ${(html.match(/<script>/g) || []).length}`);

console.log("\n" + "=".repeat(96));
console.log("五、用线量");
console.log("=".repeat(96));
Y.perColor.forEach(c => console.log(`  ${c.id} ${pad(c.name, 8)} ${pad(c.stitches, 6)} 针 ${pad(c.meters, 6)} m ${c.grams} g`));
console.log(`  合计 ${Y.totalStitches} 针 → ${Y.meters} m / ${Y.grams} g；含 25% 损耗 ${Y.bufMeters} m / ${Y.bufGrams} g`);

const ok = R.ok && indep.length === 0 && svgOk && selfOk && fail.length === 0;
console.log("\n" + "=".repeat(96));
console.log(`总结论：${ok ? "✓ 全部通过" : "✗ 存在问题"}`);
console.log("=".repeat(96));
if (!ok) process.exitCode = 1;
