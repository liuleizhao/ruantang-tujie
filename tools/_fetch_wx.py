#!/usr/bin/env python3
"""抓取微信「小乔软糖」图解文章图片。"""
import re
import ssl
import urllib.request
from pathlib import Path

URL = "https://mp.weixin.qq.com/s/Qb08Et0gUUzkWzc1waaHfg"
OUT = Path("docs/corpus/softcandy/_img/xiaoqiao-ruantang")
OUT.mkdir(parents=True, exist_ok=True)

ctx = ssl.create_default_context()
req = urllib.request.Request(
    URL,
    headers={
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 "
            "MicroMessenger/8.0.0"
        ),
        "Accept": "text/html",
    },
)
raw = urllib.request.urlopen(req, context=ctx, timeout=30).read()
html = raw.decode("utf-8", "replace")
(OUT / "_page.html").write_bytes(raw)
print("html bytes", len(raw))

# 多种图片属性
patterns = [
    r'data-src="(https://mmbiz[^"]+)"',
    r'data-src=\\x22(https://mmbiz[^"\\]+)',
    r'src="(https://mmbiz\.qpic\.cn/[^"]+)"',
    r'"(https://mmbiz\.qpic\.cn/mmbiz_jpg/[^"]+)"',
    r'"(https://mmbiz\.qpic\.cn/sz_mmbiz_jpg/[^"]+)"',
    r'"(https://mmbiz\.qpic\.cn/mmbiz_png/[^"]+)"',
]
found = []
for p in patterns:
    for u in re.findall(p, html):
        u = u.replace("\\x26", "&").replace("&amp;", "&")
        if u not in found:
            found.append(u)
print("unique imgs", len(found))
for i, u in enumerate(found[:30]):
    print(i, u[:110])

for i, u in enumerate(found):
    dl = u
    # prefer full size
    dl = re.sub(r"/\d+\?", "/0?", dl)
    if "wx_fmt=" not in dl:
        dl += ("&" if "?" in dl else "?") + "wx_fmt=jpeg"
    path = OUT / f"{i+1:02d}.jpg"
    try:
        r = urllib.request.Request(
            dl, headers={"User-Agent": "Mozilla/5.0", "Referer": URL}
        )
        data = urllib.request.urlopen(r, context=ctx, timeout=40).read()
        if len(data) < 1000:
            print("skip tiny", path.name, len(data))
            continue
        path.write_bytes(data)
        print("OK", path.name, len(data))
    except Exception as e:
        print("FAIL", i, e)

# 抽文本
texts = re.findall(r"<p[^>]*>(.*?)</p>", html, re.S | re.I)
plain = []
for t in texts:
    s = re.sub(r"<[^>]+>", "", t)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .strip()
    )
    if s and s not in plain:
        plain.append(s)
(OUT / "text.txt").write_text("\n".join(plain), encoding="utf-8")
print("text lines", len(plain))
for line in plain[:40]:
    print("-", line[:120])
