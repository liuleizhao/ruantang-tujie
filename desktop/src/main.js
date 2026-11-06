const { invoke } = window.__TAURI__.core;

const CHART_PLACEHOLDER = "/*__GUMMY_CHART__*/null";
const ENGINE_PLACEHOLDER = "/*__GUMMY_ENGINE__*/";

let toyspec = null;
let lastHtmlRel = null;

const $ = (sel) => document.querySelector(sel);

function log(msg, kind = "") {
  const el = $("#log");
  el.textContent = msg;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function getEngine() {
  const E = window.GummyEngine;
  if (!E || typeof E.buildChart !== "function") {
    throw new Error("引擎未加载：请确认 vendor/gummy-engine.js 存在");
  }
  return E;
}

function safeJsonForScript(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/<\/(script)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--");
}

function renderPalette() {
  const box = $("#palette-editor");
  box.innerHTML = "";
  if (!toyspec?.palette?.length) {
    box.innerHTML = "<p class='hint'>尚未加载底模。</p>";
    return;
  }
  toyspec.palette.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "swatch";
    row.innerHTML = `
      <input type="color" data-idx="${idx}" value="${c.hex || "#cccccc"}" aria-label="色块" />
      <input type="text" data-idx="${idx}" data-field="name" value="${c.name || ""}" placeholder="线色名" />
      <input type="text" data-idx="${idx}" data-field="hex" value="${c.hex || ""}" placeholder="#RRGGBB" />
      <input type="text" data-idx="${idx}" data-field="role" value="${c.role || ""}" placeholder="role" />
    `;
    box.appendChild(row);
  });

  box.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const i = Number(input.dataset.idx);
      const field = input.dataset.field;
      if (input.type === "color") {
        toyspec.palette[i].hex = input.value.toUpperCase();
        const hexInput = box.querySelector(`input[data-idx="${i}"][data-field="hex"]`);
        if (hexInput) hexInput.value = toyspec.palette[i].hex;
      } else if (field === "hex") {
        let v = input.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          v = v.toUpperCase();
          toyspec.palette[i].hex = v;
          const colorInput = box.querySelector(`input[type="color"][data-idx="${i}"]`);
          if (colorInput) colorInput.value = v;
        }
      } else if (field) {
        toyspec.palette[i][field] = input.value.trim();
      }
    });
  });
}

async function loadPreset() {
  const res = await fetch("vendor/softcandy-chibi.toyspec.json");
  if (!res.ok) throw new Error("无法加载软糖体底模");
  toyspec = await res.json();
  $("#height-cm").value = toyspec.heightCm || 14;
  if (!$("#char-name").value.trim()) {
    $("#char-name").value = toyspec.name || "试做角色";
  }
  renderPalette();
  log("已加载软糖体底模。可改角色名、高度与配色，然后生成。", "ok");
}

async function refreshCharacters() {
  const list = await invoke("list_characters");
  const box = $("#char-list");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = "<span class='hint'>characters/ 下还没有角色目录</span>";
    return;
  }
  list.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = `${c.name}${c.hasToyspec ? "" : "（无 toyspec）"}`;
    btn.addEventListener("click", async () => {
      $("#char-name").value = c.name;
      if (!c.hasToyspec) {
        log(`角色「${c.name}」没有 toyspec.json，请先加载底模再生成。`);
        return;
      }
      const text = await invoke("read_workspace_file", {
        relPath: `characters/${c.name}/toyspec.json`,
      });
      toyspec = JSON.parse(text);
      $("#height-cm").value = toyspec.heightCm || 14;
      renderPalette();
      lastHtmlRel = c.hasGummy ? `characters/${c.name}/gummy.html` : null;
      $("#btn-open").disabled = !lastHtmlRel;
      log(`已加载 characters/${c.name}/toyspec.json`, "ok");
    });
    box.appendChild(btn);
  });
}

function applyFormToSpec() {
  if (!toyspec) throw new Error("请先加载底模或已有角色");
  const name = $("#char-name").value.trim();
  if (!name) throw new Error("请填写角色名");
  const height = Number($("#height-cm").value);
  if (!(height >= 8 && height <= 30)) throw new Error("高度请落在 8–30 cm");
  toyspec.name = name;
  toyspec.heightCm = height;
  delete toyspec._meta;
  return name;
}

async function buildHtml(chart, engineSource, templateHtml) {
  const E = getEngine();
  if (typeof E.resolveReference === "function") {
    chart.reference = E.resolveReference(chart, chart.reference || null);
  }
  let html = templateHtml;
  if (!html.includes(CHART_PLACEHOLDER) || !html.includes(ENGINE_PLACEHOLDER)) {
    throw new Error("模板缺少占位符，无法注入");
  }
  html = html.replace(CHART_PLACEHOLDER, safeJsonForScript(chart));
  html = html.replace(ENGINE_PLACEHOLDER, `\n${engineSource}\n`);
  return html;
}

async function generate() {
  const E = getEngine();
  const name = applyFormToSpec();
  log("正在计算针数…");

  const chart = E.buildChart(toyspec);
  const validation = chart.validation || E.validateChart(chart);
  const identity = typeof E.assessIdentity === "function" ? E.assessIdentity(toyspec) : null;

  if (!validation.ok) {
    const errs = (validation.errors || []).slice(0, 12).join("\n");
    log(`校验未通过，未保存交付页：\n${errs}`, "err");
    await invoke("ensure_character_dir", { name });
    await invoke("write_workspace_file", {
      relPath: `characters/${name}/toyspec.json`,
      contents: JSON.stringify(toyspec, null, 2),
    });
    await invoke("write_workspace_file", {
      relPath: `characters/${name}/chart.json`,
      contents: JSON.stringify(chart, null, 2),
    });
    return;
  }

  const [templateHtml, engineSource] = await Promise.all([
    fetch("vendor/gummy-atelier.html").then((r) => r.text()),
    fetch("vendor/gummy-engine.js").then((r) => r.text()),
  ]);
  const html = await buildHtml(chart, engineSource, templateHtml);

  await invoke("ensure_character_dir", { name });
  await invoke("write_workspace_file", {
    relPath: `characters/${name}/toyspec.json`,
    contents: JSON.stringify(toyspec, null, 2),
  });
  await invoke("write_workspace_file", {
    relPath: `characters/${name}/chart.json`,
    contents: JSON.stringify(chart, null, 2),
  });
  await invoke("write_workspace_file", {
    relPath: `characters/${name}/gummy.html`,
    contents: html,
  });

  lastHtmlRel = `characters/${name}/gummy.html`;
  $("#btn-open").disabled = false;
  await refreshCharacters();

  const s = validation.summary || {};
  const idLine = identity
    ? `还原度 ${identity.score}/100 ${identity.ok ? "✓" : "✗"}`
    : "";
  log(
    [
      `✓ 已保存到 characters/${name}/`,
      `部件 ${s.parts ?? "?"} · 圈 ${s.rounds ?? "?"} · 总针 ${s.totalStitches ?? "?"}`,
      idLine,
      `打开：${lastHtmlRel}`,
    ]
      .filter(Boolean)
      .join("\n"),
    "ok",
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const root = await invoke("workspace_root");
    $("#workspace-meta").textContent = `仓库：${root}`;
  } catch (err) {
    $("#workspace-meta").textContent = `仓库定位失败：${err}`;
  }

  $("#btn-load-preset").addEventListener("click", async () => {
    try {
      await loadPreset();
    } catch (err) {
      log(String(err), "err");
    }
  });
  $("#btn-refresh-chars").addEventListener("click", async () => {
    try {
      await refreshCharacters();
    } catch (err) {
      log(String(err), "err");
    }
  });
  $("#btn-generate").addEventListener("click", async () => {
    try {
      await generate();
    } catch (err) {
      log(String(err), "err");
    }
  });
  $("#btn-open").addEventListener("click", async () => {
    if (!lastHtmlRel) return;
    try {
      await invoke("open_path", { absOrRel: lastHtmlRel });
    } catch (err) {
      log(String(err), "err");
    }
  });

  try {
    await loadPreset();
    await refreshCharacters();
  } catch (err) {
    log(String(err), "err");
  }
});
