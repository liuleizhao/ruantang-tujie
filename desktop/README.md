# 软糖图解 · Tauri 桌面端

本地 GUI：**不调用任何 AI**。改底模配色/尺寸 → 引擎算针 → 保存到 `characters/<角色>/`。

## 前置

1. **Node.js**（已具备）
2. **Rust**（`rustup`，MSVC 工具链）
3. **Visual Studio Build Tools**（Desktop development with C++）
4. **WebView2**（Win10/11 通常已有）

## 启动

在仓库根或本目录：

```powershell
cd desktop
npm install
npm run dev
```

首次会编译 Rust，可能要几分钟。

## 用法

1. 自动/手动「加载软糖体底模」
2. 填角色名、高度，改配色
3. 「生成图解并保存」→ 写出 `toyspec.json` / `chart.json` / `gummy.html`
4. 「打开 gummy.html」用系统浏览器查看

也可点已有角色芯片，读回 `characters/<角色>/toyspec.json` 再改。

## 说明

- 引擎与模板由 `npm run sync-vendor` 从仓库同步到 `src/vendor/`（`dev`/`build` 前自动跑）
- 仓库根通过 `desktop/src-tauri` 上溯定位；也可设环境变量 `GUMMY_ROOT`
- 打包：`npm run build` → NSIS 安装包（需本机工具链齐全）
