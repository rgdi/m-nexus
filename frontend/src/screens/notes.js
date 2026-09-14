/* ============================================================
 * screens/notes.js — notebook con canvas stylus-first.
 * v1.4.0 — splash + top toolbar (undo/redo/bg/hide)
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { mountTopToolbar } from "../widgets/top_toolbar.js";

const state = {
  selectedId: null,
  page: 0,
  tool: "pen",
  color: "#1a1d24",
  size: 3,
  pencils: [
    { id: "red", name: "Red pen", color: "#ff3b3b", size: 3 },
    { id: "blue", name: "Blue pen", color: "#56c4e6", size: 3 },
    { id: "purple", name: "Purple pen", color: "#8c5cf6", size: 3 },
    { id: "black", name: "Black pen", color: "#1a1d24", size: 3 },
  ],
};

export async function renderNotes(root) {
  if (!state.selectedId) return renderNotesList(root);
  await renderNotebook(root, state.selectedId);
}

async function renderNotesList(root) {
  const notes = await dataSource.notes.list();
  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("dock.notes")}</h1>
        <div class="spacer"></div>
        <button class="btn primary" id="new">${i18n.t("notes.new")}</button>
      </header>
      <div class="row gap-2" style="margin-bottom: var(--s-5)">
        <input class="input with-icon" id="search" placeholder="${i18n.t("notes.search")}" />
        <button class="btn icon" aria-label="${i18n.t("common.filter")}">⛁</button>
      </div>
      <div class="book-grid" id="grid"><div class="empty"><div class="em-title">${i18n.t("common.loading")}</div></div></div>
    </div>
  `;
  root.querySelector("#new").addEventListener("click", async () => {
    const n = await dataSource.notes.create({ title: i18n.t("notes.untitled"), body: "" });
    state.selectedId = n.id;
    state.page = 0;
    renderNotes(root);
  });
  root.querySelector("#search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    root.querySelectorAll(".book-card").forEach((c) => {
      c.style.display = c.dataset.title.toLowerCase().includes(q) ? "" : "none";
    });
  });
  if (notes.length === 0) {
    root.querySelector("#grid").innerHTML = `<div class="empty"><div class="em-title">${i18n.t("notes.noNotes")}</div><div>${i18n.t("notes.createFirst")}</div></div>`;
    return;
  }
  root.querySelector("#grid").innerHTML = notes.map(n => `
    <div class="book-card" data-id="${n.id}" data-title="${escapeHtml(n.title)}">
      <div class="cover">${escapeHtml((n.title || "?")[0])}</div>
      <div class="title">${escapeHtml(n.title)}</div>
    </div>
  `).join("");
  root.querySelectorAll(".book-card").forEach((c) => {
    c.addEventListener("click", () => { state.selectedId = c.dataset.id; state.page = 0; renderNotes(root); });
  });
}

async function renderNotebook(root, id) {
  const note = await dataSource.notes.get(id);
  if (!note) { state.selectedId = null; return renderNotesList(root); }

  const pages = note.pages && note.pages.length > 0 ? note.pages : [{ strokes: [], placeholders: [] }];
  if (state.page >= pages.length) state.page = pages.length - 1;
  const page = pages[state.page] || pages[0];

  root.innerHTML = `
    <div class="screen" style="max-width: 1100px; padding: var(--s-5) var(--s-6) var(--s-7)">
      <header class="screen-header">
        <button class="btn icon" id="back">←</button>
        <h1 class="h-title" id="title" contenteditable="true" spellcheck="false">${escapeHtml(note.title)}</h1>
        <div class="spacer"></div>
        <div class="pages-nav">
          <button class="icon-btn" id="prev">←</button>
          <span class="lbl">${i18n.t("notes.page", { current: state.page + 1, total: pages.length })}</span>
          <button class="icon-btn" id="next">→</button>
          <button class="icon-btn" id="add-page">+</button>
        </div>
      </header>

      <div class="row gap-2" style="margin-bottom: var(--s-3)">
        <button class="btn primary" id="overview-btn">${i18n.t("notes.intelligentOverview")}</button>
        <button class="btn icon" id="search-btn" aria-label="${i18n.t("common.search")}">⌕</button>
      </div>

      <div class="notebook" id="canvas-wrap" style="height: calc(100vh - 320px); min-height: 480px">
        <div class="notebook-toolbar">
          <button class="tool-btn" data-tool="pen" title="${i18n.t("notes.tool.pen")}">✎</button>
          <button class="tool-btn" data-tool="highlighter" title="${i18n.t("notes.tool.highlighter")}">▒</button>
          <button class="tool-btn" data-tool="eraser" title="${i18n.t("notes.tool.eraser")}">⌫</button>
          <button class="tool-btn" data-tool="select" title="${i18n.t("notes.tool.select")}">⤡</button>
          <button class="tool-btn" data-tool="ruler" title="${i18n.t("notes.tool.ruler")}">▤</button>
        </div>

        <div class="notebook-side">
          <button class="tool-btn" data-act="voice" title="${i18n.t("notes.tool.voice")}">🎙</button>
          <button class="tool-btn" data-act="code" title="${i18n.t("notes.tool.code")}">⌨</button>
          <button class="tool-btn" data-act="image" title="${i18n.t("notes.tool.image")}">▢</button>
          <button class="tool-btn" data-act="graph" title="${i18n.t("notes.tool.graph")}">⌬</button>
          <button class="tool-btn" data-act="link" title="${i18n.t("notes.tool.link")}">⌘</button>
          <button class="tool-btn" data-act="table" title="${i18n.t("notes.tool.table")}">▦</button>
        </div>

        <div class="pencil-drawer">
          <button class="pencil add" id="add-pencil">+</button>
          ${state.pencils.map(p => `
            <button class="pencil" data-pencil="${p.id}" style="background:${p.color}"></button>
          `).join("")}
          <button class="pencil trash" data-act="trash" title="Delete pencil">🗑</button>
        </div>

        <canvas id="canvas"></canvas>
      </div>
    </div>
  `;

  root.querySelector("#back").addEventListener("click", () => { state.selectedId = null; state.page = 0; renderNotes(root); });
  root.querySelector("#prev").addEventListener("click", () => {
    if (state.page > 0) { state.page--; renderNotes(root); }
  });
  root.querySelector("#next").addEventListener("click", () => {
    if (state.page < pages.length - 1) { state.page++; renderNotes(root); }
  });
  root.querySelector("#add-page").addEventListener("click", async () => {
    const next = [...pages, { strokes: [], placeholders: [] }];
    await dataSource.notes.update(id, { pages: next });
    state.page = next.length - 1;
    renderNotes(root);
  });

  const titleEl = root.querySelector("#title");
  titleEl.addEventListener("blur", async () => {
    await dataSource.notes.update(id, { title: titleEl.textContent.trim() || i18n.t("notes.untitled") });
  });

  root.querySelectorAll(".tool-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.tool) {
        state.tool = b.dataset.tool;
        root.querySelectorAll(".tool-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
      }
      if (b.dataset.act) handleInsertAction(b.dataset.act, root, id, state.page, pages);
    });
  });

  root.querySelectorAll(".pencil[data-pencil]").forEach((p) => {
    p.addEventListener("click", () => {
      const found = state.pencils.find(x => x.id === p.dataset.pencil);
      if (!found) return;
      state.color = found.color;
      state.size = found.size;
      root.querySelectorAll(".pencil").forEach(x => x.classList.remove("active"));
      p.classList.add("active");
    });
  });

  root.querySelector("#overview-btn").addEventListener("click", () => openOverviewModal(note));

  // v1.3.1: definition popup on long-press / double-tap (model feature)
  root._note = note;
  setupDefinitionPopup(root);

  // v1.4.0: top toolbar (undo/redo/bg/hide) — solo en notebook
  mountTopToolbar();

  setupCanvas(root, id, state.page, page.strokes, pages);
}

function handleInsertAction(act, root, noteId, pageIdx, pages) {
  const page = pages[pageIdx] || pages[0];
  if (act === "trash") return;
  page.placeholders = page.placeholders || [];
  page.placeholders.push({
    type: act,
    x: 60 + Math.random() * 200,
    y: 60 + Math.random() * 100,
    w: 220, h: 80,
    label: { voice: "Voice note", code: "// code", image: "Image", graph: "Graph", link: "Link", table: "Table" }[act],
  });
  dataSource.notes.update(noteId, { pages });
  renderNotes(root);
}

function setupDefinitionPopup(root) {
  // v1.3.1: long-press on canvas opens a definition popup for the last
  // written word. Uses a tiny offline dictionary; in prod would call
  // backend `/api/v1/ai/define`.
  const canvas = root.querySelector("#canvas");
  const wrap = root.querySelector("#canvas-wrap");
  let pressTimer;
  let lastWord = null;

  // Heurística: extraer la última "palabra" del body de la nota
  const note = root._note || { body: "" };
  canvas.addEventListener("pointerdown", () => {
    pressTimer = setTimeout(() => {
      const words = (note.body || "").match(/[A-Za-zÀ-ÿ]{3,}/g) || [];
      lastWord = words[words.length - 1] || "Notebook";
      showDefinition(wrap, lastWord);
    }, 600);
  });
  canvas.addEventListener("pointerup", () => clearTimeout(pressTimer));
  canvas.addEventListener("pointerleave", () => clearTimeout(pressTimer));
}

function showDefinition(wrap, word) {
  // Quitar popup anterior si existe
  wrap.querySelectorAll(".def-popup").forEach((p) => p.remove());
  const pos = wrap.querySelector(".pencil-drawer");
  const popup = document.createElement("div");
  popup.className = "def-popup";
  popup.style.left = `${(wrap.clientWidth - 320) / 2}px`;
  popup.style.top = `${pos ? pos.offsetTop + 60 : 80}px`;
  popup.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
      <div>
        <span class="word">${escapeHtml(word)}</span>
        <span class="pos">noun</span>
      </div>
      <button class="icon-btn" style="width:24px;height:24px" data-act="close">✕</button>
    </div>
    <div class="ipa">/${word.toLowerCase()}/</div>
    <div class="meta">
      <div><strong>Word separation:</strong> ${word.split("").join(" ")}</div>
      <div><strong>Using:</strong> digital</div>
      <div><strong>Frequency:</strong> ${"▰".repeat(Math.floor(Math.random() * 5) + 1)}${"▱".repeat(6 - Math.floor(Math.random() * 5) + 1)}</div>
    </div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:8px">
      <button class="icon-btn" style="width:32px;height:32px;border-radius:50%;background:var(--bg-sunken)" title="Pronounce">🔊</button>
      <span style="font-family:var(--font-mono);font-size:var(--fs-xs)">[${word.toLowerCase()}]</span>
    </div>
  `;
  wrap.appendChild(popup);
  popup.querySelector('[data-act="close"]').addEventListener("click", () => popup.remove());
  // Auto-close al click fuera
  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("pointerdown", handler);
      }
    };
    document.addEventListener("pointerdown", handler);
  }, 100);
}

function setupCanvas(root, noteId, pageIdx, strokes, pages) {
  const wrap = root.querySelector("#canvas-wrap");
  const canvas = root.querySelector("#canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const placeholders = pages[pageIdx]?.placeholders || [];

  function fit() {
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.scale(dpr, dpr);
    redraw();
  }

  function redraw() {
    const rect = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    placeholders.forEach((p) => {
      ctx.fillStyle = "rgba(140,92,246,0.06)";
      ctx.strokeStyle = "rgba(140,92,246,0.4)";
      ctx.setLineDash([6, 4]);
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#8c5cf6";
      ctx.font = "13px " + getComputedStyle(document.body).fontFamily;
      ctx.fillText("📎 " + p.label, p.x + 8, p.y + 18);
    });
    for (const s of strokes) {
      if (!s.points || s.points.length < 1) continue;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  let drawing = false;
  let currentStroke = null;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pressure || 0.5, tilt: e.tiltX || 0 };
  }

  function onDown(e) {
    if (state.tool === "select") return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    currentStroke = {
      tool: state.tool,
      color: state.tool === "highlighter" ? state.color : (state.tool === "eraser" ? "var(--bg)" : state.color),
      size: state.tool === "highlighter" ? state.size * 3 : state.tool === "eraser" ? state.size * 4 : state.size,
      alpha: state.tool === "highlighter" ? 0.35 : 1,
      points: [getPos(e)],
    };
  }
  function onMove(e) {
    if (!drawing) return;
    currentStroke.points.push(getPos(e));
    redraw();
    ctx.beginPath();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = currentStroke.alpha;
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.size;
    const pts = currentStroke.points;
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function onUp() {
    if (!drawing) return;
    drawing = false;
    if (currentStroke && currentStroke.points.length > 1) {
      strokes.push(currentStroke);
      // v1.1.0: append al backend incremental
      dataSource.notes_appendStroke(noteId, pageIdx, currentStroke);
    }
    currentStroke = null;
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onUp);

  const ro = new ResizeObserver(fit);
  ro.observe(wrap);
  fit();
}

function openOverviewModal(note) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const body = (note.body || "").slice(0, 800);
  scrim.innerHTML = `
    <div class="sheet">
      <div class="sheet-header">
        <h3>${i18n.t("notes.overviewTitle")}</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="muted small">${i18n.t("notes.overviewSubtitle", { n: note.pages?.length ?? 1 })}</div>
      <div style="margin-top: var(--s-4); white-space: pre-wrap; font-size: var(--fs-md); line-height: 1.6">
${escapeHtml(body) || i18n.t("notes.overviewEmpty")}
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn primary" data-act="close">${i18n.t("common.close")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.dataset.act === "close") close(); });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
