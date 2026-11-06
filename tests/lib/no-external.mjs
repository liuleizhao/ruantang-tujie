// 无外链检测：区分「真实资源外链」与「SVG/XML 命名空间 URI」
// 为什么需要：`document.createElementNS('http://www.w3.org/2000/svg', ...)` 里的
// http://www.w3.org/2000/svg 是**命名空间标识符**，不是网络请求，不算外链。
// 交付要求的「零外链」= 页面离线打开时不发起任何网络请求。

const NAMESPACE_URIS = [
  'http://www.w3.org/2000/svg',
  'https://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/XML/1998/namespace',
];

/** 去掉命名空间 URI 与纯注释里的 URL 后，再扫描真实外链 */
export function findExternalRefs(html) {
  let text = String(html);

  // 1) 移除已知命名空间 URI（它们是标识符，不触发网络）
  for (const ns of NAMESPACE_URIS) {
    text = text.split(ns).join('__NS__');
    text = text.split(ns.replace('http:', 'https:')).join('__NS__');
  }

  const hits = [];
  // 2) 真实外链形态
  const patterns = [
    [/<script[^>]+src\s*=\s*["']?(?!data:)[^"'>\s]+/gi, '<script src> 外部脚本'],
    [/<link[^>]+href\s*=\s*["']?(?!data:)[^"'>\s]+/gi, '<link href> 外部样式/资源'],
    [/<img[^>]+src\s*=\s*["']?(?!data:)[^"'>\s]+/gi, '<img src> 外部图片'],
    [/\burl\(\s*(?!data:|#|__NS__)["']?https?:\/\//gi, 'CSS url() 外链'],
    [/@import\s+(?!url\(\s*["']?data:)/gi, 'CSS @import'],
    [/\bfetch\s*\(\s*["']https?:\/\//gi, 'fetch() 网络请求'],
    [/XMLHttpRequest/gi, 'XMLHttpRequest 网络请求'],
    [/\bsrc\s*=\s*["']https?:\/\//gi, 'src 指向 http(s)'],
    // 剩余的裸 http(s):// —— 排除命名空间占位符
    [/https?:\/\/(?!__NS__)/gi, '裸 http(s):// 链接'],
  ];

  for (const [re, label] of patterns) {
    const m = text.match(re);
    if (m) {
      for (const hit of m.slice(0, 3)) {
        hits.push({ label, sample: hit.trim().slice(0, 120) });
      }
    }
  }

  // 3) 协议相对 //cdn（排除注释中的 //)
  const cdn = text.match(/["'(]\s*\/\/[a-z0-9.-]+\.[a-z]{2,}/gi);
  if (cdn) hits.push({ label: '协议相对 //cdn 外链', sample: cdn[0] });

  // 去重
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.label}|${h.sample}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function assertNoExternal(assert, html, where) {
  const hits = findExternalRefs(html);
  assert.eq(hits.length, 0,
    `${where} 必须零外链（离线可用）\n  发现 ${hits.length} 处:\n` +
    hits.map((h) => `    · ${h.label}: ${h.sample}`).join('\n'));
}
