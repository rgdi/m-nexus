/* ============================================================
 * screens/notes.js — notebook con canvas stylus-first.
 * v1.4.0 — splash + top toolbar (undo/redo/bg/hide)
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { mountTopToolbar } from "../widgets/top_toolbar.js";
import { openAudioRecorder } from "../widgets/audio_recorder.js";
import { openStudySession } from "../widgets/study_session.js";
import { downloadNoteAsPDF } from "../widgets/pdf_export.js";
import { openClozeTest } from "../widgets/cloze_test.js";
import { extractTags, renderTagsCloud, injectTagsInline, getActiveTag } from "../widgets/tags_cloud.js";
import { renderAttachmentsGrid, addAttachment } from "../widgets/file_attachments.js";
import { mountAITutor, setAIContext } from "../widgets/ai_tutor.js";
import { mountFlashcardSlash } from "../widgets/flashcard_slash.js";
import { icon as svgIcon } from "../widgets/icons.js";

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

// v1.6.3: escuchar evento global para abrir nota por id (desde cross-verify)
document.addEventListener("notes:open", (e) => {
  const id = e.detail?.id;
  if (id) {
    state.selectedId = id;
    state.page = 0;
  }
});

export async function renderNotes(root) {
  // v1.6.2: si el hash trae ?id=X, abrir esa nota directamente
  // v1.6.3: usar también window.__mnexusNoteState (del cross-verify)
  const shared = window.__mnexusNoteState ?? {};
  const q = window.__mnexusHashQuery?.() ?? null;
  if (q && q.id) {
    state.selectedId = q.id;
    state.page = 0;
    shared.selectedId = q.id;
    shared.page = 0;
  } else if (shared.selectedId && !state.selectedId) {
    state.selectedId = shared.selectedId;
    state.page = shared.page ?? 0;
  }
  if (!state.selectedId) return renderNotesList(root);
  // v1.6.3: si la nota no está en localStorage, intentar cargarla del backend
  const cached = await dataSource.notes.get(state.selectedId).catch(() => null);
  if (!cached) {
    try {
      const r = await fetch(`http://localhost:4100/api/v1/notes/${state.selectedId}`);
      if (r.ok) {
        const note = await r.json();
        // cachear en localStorage para próximas veces
        const all = (await dataSource.notes.list().catch(() => [])) || [];
        if (!all.find((n) => n.id === note.id)) {
          all.push(note);
          localStorage.setItem("notes", JSON.stringify(all));
        }
      }
    } catch {}
  }
  await renderNotebook(root, state.selectedId);
}

async function renderNotesList(root) {
  const notes = await dataSource.notes.list();
  const activeTag = getActiveTag();
  // v1.9.1: expose notes for tags_cloud
  window.__mnexusNoteList = async () => await dataSource.notes.list();
  const filtered = activeTag ? notes.filter((n) => extractTags(n.body).includes(activeTag)) : notes;
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
      <div id="tags-cloud" class="tags-bar"></div>
      <div class="book-grid" id="grid"><div class="empty"><div class="em-title">${i18n.t("common.loading")}</div></div></div>
    </div>
  `;
  // render tags cloud
  await renderTagsCloud(root.querySelector("#tags-cloud"));
  // wire tags:change listener for live updates
  document.addEventListener("tags:change", async () => {
    if (location.hash.startsWith("#/notes")) renderNotes(root);
  });
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
  if (filtered.length === 0) {
    const emptyMsg = activeTag
      ? `<div class="empty"><div class="em-title">${i18n.t("notes.noNotesWithTag", { tag: activeTag })}</div><div>${i18n.t("notes.tryOtherTag")}</div></div>`
      : `<div class="empty"><div class="em-title">${i18n.t("notes.noNotes")}</div><div>${i18n.t("notes.createFirst")}</div></div>`;
    root.querySelector("#grid").innerHTML = emptyMsg;
    return;
  }
  root.querySelector("#grid").innerHTML = filtered.map(n => `
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
        <button class="btn icon" id="back">${svgIcon("back", 18)}</button>
        <h1 class="h-title" id="title" contenteditable="true" spellcheck="false">${escapeHtml(note.title)}</h1>
        <div class="spacer"></div>
        <div class="pages-nav">
          <button class="icon-btn" id="prev">${svgIcon("back", 16)}</button>
          <span class="lbl">${i18n.t("notes.page", { current: state.page + 1, total: pages.length })}</span>
          <button class="icon-btn" id="next" style="transform: scaleX(-1)">${svgIcon("back", 16)}</button>
          <button class="icon-btn" id="add-page">${svgIcon("plus", 16)}</button>
        </div>
      </header>

      <div class="row gap-2" style="margin-bottom: var(--s-3)">
        <button class="btn primary" id="overview-btn">${i18n.t("notes.intelligentOverview")}</button>
        <div class="ai-menu" id="ai-menu">
          <button class="btn ai-toggle" id="ai-toggle" aria-expanded="false" aria-haspopup="menu">
            ${svgIcon("sparkles", 16)} AI
            <span class="caret">▾</span>
          </button>
          <div class="ai-menu-panel" id="ai-menu-panel" hidden>
            <button class="ai-item" data-act="extract">
              ${svgIcon("flashcard", 16)} ${i18n.t("notes.extractFlashcards")}
            </button>
            <button class="ai-item" data-act="cloze">
              ${svgIcon("wand", 16)} ${i18n.t("notes.ai.cloze")}
            </button>
            <button class="ai-item" data-act="define">
              ${svgIcon("bulb", 16)} ${i18n.t("notes.ai.define")}
            </button>
          </div>
        </div>
        <button class="btn icon" id="search-btn" aria-label="${i18n.t("common.search")}">${svgIcon("search", 18)}</button>
        <button class="btn icon" id="export-pdf" title="PDF">${svgIcon("text", 18)}</button>
      </div>

      <div class="notebook" id="canvas-wrap" style="height: calc(100vh - 320px); min-height: 480px">
        <div class="notebook-toolbar">
          <button class="tool-btn" data-tool="pen" title="${i18n.t("notes.tool.pen")}">${svgIcon("pen", 18)}</button>
          <button class="tool-btn" data-tool="highlighter" title="${i18n.t("notes.tool.highlighter")}">${svgIcon("highlighter", 18)}</button>
          <button class="tool-btn" data-tool="eraser" title="${i18n.t("notes.tool.eraser")}">${svgIcon("eraser", 18)}</button>
          <button class="tool-btn" data-tool="select" title="${i18n.t("notes.tool.select")}">${svgIcon("select", 18)}</button>
        </div>

        <div class="notebook-side">
          <button class="tool-btn" data-act="voice" title="${i18n.t("notes.tool.voice")}">${svgIcon("voice", 18)}</button>
          <button class="tool-btn" data-act="image" title="${i18n.t("notes.tool.image")}">${svgIcon("image", 18)}</button>
          <button class="tool-btn" data-act="link" title="${i18n.t("notes.tool.link")}">${svgIcon("link", 18)}</button>
          <button class="tool-btn" data-act="table" title="${i18n.t("notes.tool.table")}">${svgIcon("table", 18)}</button>
        </div>

        <div class="pencil-drawer">
          <button class="pencil add" id="add-pencil">+</button>
          ${state.pencils.map(p => `
            <button class="pencil" data-pencil="${p.id}" style="background:${p.color}"></button>
          `).join("")}
          <button class="pencil trash" data-act="trash" title="Delete pencil">🗑</button>
        </div>

        <button class="fab fab-cards" id="new-card-btn" title="${i18n.t("notes.newFlashcard")}">${svgIcon("flashcard", 22, { color: "white", fill: "rgba(255,255,255,0.15)" })}</button>

        <canvas id="canvas"></canvas>
      </div>
    </div>
  `;

  // v2.3.0: hide secondary FAB when AI tutor panel is open (avoid double FABs)
  const cardsFab = root.querySelector("#new-card-btn");
  if (cardsFab) {
    const obs = new MutationObserver(() => {
      cardsFab.style.display = document.body.classList.contains("ai-chat-open") ? "none" : "";
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

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

  // v1.7.3: export PDF
  root.querySelector("#export-pdf").addEventListener("click", () => downloadNoteAsPDF(note));

  // v1.6.1: AI submenú
  setupAIMenu(root, id, note);

  // v2.0.2: AI tutor context — el tutor sabe qué nota estás viendo
  setAIContext({ note, subject: note.subject });
  // v2.0.3: /flashcards slash command popup en el text-layer
  mountFlashcardSlash(root, id, note);

  // v2.0.1: attachments bar (image/pdf/glb con preview + occlusion)
  const attBar = document.createElement("div");
  attBar.id = "attachments-bar";
  attBar.style.cssText = "padding: var(--s-3) var(--s-5) 0;";
  // Insert before text-layer
  const canvasWrap = root.querySelector("#canvas-wrap");
  if (canvasWrap) canvasWrap.parentElement.insertBefore(attBar, canvasWrap);
  renderAttachmentsGrid(attBar, id, () => renderNotebook(root, id));
  // Attach button
  const attachBtn = document.createElement("button");
  attachBtn.className = "attach-btn";
  attachBtn.textContent = "📎 Attach file (image, pdf, .glb)";
  attachBtn.style.cssText = "margin: var(--s-2) var(--s-5);";
  attBar.parentElement.insertBefore(attachBtn, attBar.nextSibling);
  attachBtn.addEventListener("click", async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*,application/pdf,.glb";
    inp.multiple = true;
    inp.onchange = async () => {
      for (const f of inp.files) {
        await addAttachment(id, f);
      }
      renderAttachmentsGrid(attBar, id, () => renderNotebook(root, id));
    };
    inp.click();
  });

  // v1.5.1: FAB abre panel de flashcards (locales primero, luego refresh backend)
  root.querySelector("#new-card-btn")?.addEventListener("click", async () => {
    // siempre abrir panel; si la nota tiene inline {{c1::...}}, intentar extraer
    const re = /\{\{c1::([^}]+?)\}\}/g;
    const hasInline = [...((note.body || "").matchAll(re))].length > 0;
    let justCreated = { created: [], skipped: 0 };
    if (hasInline) {
      try {
        const r = await fetch(`http://localhost:4100/api/v1/notes/${id}/extract-flashcards`, { method: "POST" });
        if (r.ok) justCreated = await r.json();
      } catch {}
    }
    await showFlashcardsPanel(id, justCreated);
  });

  // v1.3.1: definition popup on long-press / double-tap (model feature)
  root._note = note;
  setupDefinitionPopup(root);

  // v1.4.0: top toolbar (undo/redo/bg/hide) — solo en notebook
  mountTopToolbar();

  setupCanvas(root, id, state.page, page.strokes, pages);

  // v1.6.2: si la URL trae ?rec=X&t=N, monta mini-audio-player con seek
  const q = window.__mnexusHashQuery?.();
  if (q && q.rec && q.t !== undefined) {
    mountMiniAudioPlayer(root, q.rec, parseInt(q.t, 10), q.ref || null, note);
  } else if (q && q.ref) {
    // v1.6.3: solo book ref highlight
    highlightBookRef(root, q.ref);
  }
}

/* ============================================================
 * v1.6.1 — AI submenú (v1.8.1: closure robusta via setTimeout cleanup)
 * ============================================================ */
function setupAIMenu(root, noteId, note) {
  const toggle = root.querySelector("#ai-toggle");
  const panel = root.querySelector("#ai-menu-panel");
  if (!toggle || !panel) return;
  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("open", open);
  });
  // close on outside click — defer setup so the initial toggle click
  // doesn't immediately close the menu.
  const handler = (e) => {
    if (!document.contains(toggle) || !document.contains(panel)) {
      // DOM was re-rendered, detach stale handler
      document.removeEventListener("click", handler);
      return;
    }
    if (toggle.contains(e.target) || panel.contains(e.target)) return;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("open");
  };
  setTimeout(() => document.addEventListener("click", handler), 150);
  panel.querySelectorAll(".ai-item").forEach((b) => {
    b.addEventListener("click", async () => {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.classList.remove("open");
      const act = b.dataset.act;
      if (act === "extract") await extractFlashcardsFromNote(noteId);
      else if (act === "cloze") openClozeTest(note);
      else if (act === "summarize") await aiSummarize(note);
      else if (act === "define") openDefinitionPopupFromText(note);
      else if (act === "quiz") await aiQuizFromNote(noteId);
    });
  });
}

async function aiSummarize(note) {
  const text = (note.body || "").slice(0, 4000);
  // v1.6.1: stub local — primeras 3 frases del body como resumen
  const sents = text.split(/[\.\n]+/).map((s) => s.trim()).filter((s) => s.length > 10).slice(0, 3);
  const summary = sents.join(". ") || "(empty)";
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet">
    <div class="sheet-header"><h3>📝 ${i18n.t("notes.ai.summarize")}</h3>
      <button class="btn icon" data-act="close">${svgIcon("close", 16)}</button></div>
    <div style="margin-top: var(--s-4); line-height: 1.6">${escapeHtml(summary)}</div>
    <div class="muted small" style="margin-top: var(--s-4)">${i18n.t("notes.ai.stubNote")}</div>
    <div class="row gap-2" style="margin-top: var(--s-5)"><button class="btn primary" data-act="close">${i18n.t("common.close")}</button></div>
  </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.dataset.act === "close") scrim.remove(); });
}

function openDefinitionPopupFromText(note) {
  // re-uso de setupDefinitionPopup pero el modal se ve con palabras del body
  const wrap = document.createElement("div");
  wrap.className = "def-list scrim";
  const words = (note.body || "").match(/[A-Za-zÀ-ÿ]{3,}/g) || [];
  const unique = [...new Set(words)].slice(0, 12);
  wrap.innerHTML = `<div class="sheet">
    <div class="sheet-header"><h3>💡 ${i18n.t("notes.ai.define")}</h3>
      <button class="btn icon" data-act="close">${svgIcon("close", 16)}</button></div>
    <div class="muted small">${i18n.t("notes.ai.defineSubtitle")}</div>
    <div class="def-words">${unique.map((w) => `<button class="def-word">${escapeHtml(w)}</button>`).join("")}</div>
    <div class="row gap-2" style="margin-top: var(--s-5)"><button class="btn" data-act="close">${i18n.t("common.close")}</button></div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.dataset.act === "close") wrap.remove(); });
}

async function aiQuizFromNote(noteId) {
  // v1.6.1: genera 5 preguntas a partir de las flashcards existentes
  const r = await fetch(`http://localhost:4100/api/v1/flashcards/filter?noteId=${noteId}`);
  const all = r.ok ? await r.json() : { cards: [] };
  const cards = all.cards || [];
  if (cards.length === 0) {
    alert(i18n.t("notes.ai.noFlashcardsYet"));
    return;
  }
  const pick = cards.slice(0, 5);
  // Show modal with sequential questions
  let i = 0, correct = 0;
  const askOne = () => {
    if (i >= pick.length) {
      alert(`${i18n.t("notes.ai.quizDone")}: ${correct}/${pick.length}`);
      return;
    }
    const c = pick[i++];
    const ans = prompt(`${i18n.t("notes.ai.quizQ")} ${i}/${pick.length}\n\n${c.front}`);
    if (ans && ans.trim().toLowerCase() === c.back.toLowerCase()) {
      correct++;
      alert(`✓ ${i18n.t("notes.ai.quizCorrect")}`);
    } else {
      alert(`✗ ${i18n.t("notes.ai.quizIncorrect")}: ${c.back}`);
    }
    askOne();
  };
  askOne();
}

function handleInsertAction(act, root, noteId, pageIdx, pages) {
  const page = pages[pageIdx] || pages[0];
  if (act === "trash") return;
  if (act === "voice") {
    // v1.5.4: recorder con auto-asignación de asignatura
    openAudioRecorder(root);
    return;
  }
  if (act === "graph") {
    // v1.5.3: inserta visor 3D en lugar de placeholder
    open3DInPage(root, noteId);
    return;
  }
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

/**
 * open3DInPage — añade un visor 3D al notebook con hotspots demo.
 * El visor vive en la página actual (no se serializa en pages porque es
 * pesado; se reconstruye al re-render si la nota tiene `body` con marcador
 * `:::3d hotspots=... :::`).
 */
async function open3DInPage(root, noteId) {
  const wrap = root.querySelector("#canvas-wrap");
  const viewer = document.createElement("div");
  viewer.className = "three-d-mount";
  viewer.style.cssText = "margin: var(--s-4) 0;";
  wrap.insertBefore(viewer, wrap.firstChild);
  // hotspots demo: etiquetas anatómicas (femur, tibia, rótula)
  const hotspots = [
    { id: "h1", x: 0, y: 1.2, z: 0, label: "📍 Cabeza femoral" },
    { id: "h2", x: 0.3, y: 0, z: 0, label: "📍 Trocánter mayor" },
    { id: "h3", x: 0, y: -1.2, z: 0, label: "📍 Cóndilo medial" },
  ];
  const { open3DViewer } = await import("../widgets/three_d_viewer.js");
  open3DViewer(viewer, hotspots, "bone");
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

/* ============================================================
 * v1.6.2 — mini-audio-player en el notebook (jump-to-minute estilo Apple Music)
 * ============================================================ */
async function mountMiniAudioPlayer(root, recId, startSec, bookRef, note) {
  // obtener metadata de la grabación
  const r = await fetch("http://localhost:4100/api/v1/recordings");
  const all = r.ok ? (await r.json()).recordings || [] : [];
  const rec = all.find((x) => x.id === recId);
  if (!rec) return;
  const dur = rec.durationSec || 60;
  const wrap = root.querySelector("#canvas-wrap");
  const player = document.createElement("div");
  player.className = "mini-audio";
  player.innerHTML = `
    <div class="ma-head">
      <span class="ma-icon">▶</span>
      <div class="ma-meta">
        <strong>${escapeHtml(rec.subjectName || rec.subject || "Recording")}</strong>
        <span class="ma-time" id="ma-current">${formatMmss(startSec * 1000)}</span>
        <span class="muted">/ ${formatMmss(dur * 1000)}</span>
      </div>
      ${bookRef ? `<span class="ma-ref">📖 @${escapeHtml(bookRef)}</span>` : ""}
      <button class="icon-btn ma-close" data-act="close" aria-label="Close">${svgIcon("close", 16)}</button>
    </div>
    <div class="ma-track" id="ma-track">
      <div class="ma-progress" id="ma-progress" style="left:${(startSec / dur) * 100}%"></div>
      <div class="ma-marker" style="left:${(startSec / dur) * 100}%" title="Start ${formatMmss(startSec * 1000)}"></div>
    </div>
    <div class="ma-actions">
      <button class="btn icon" id="ma-play">${svgIcon("play", 16)}</button>
      <button class="btn icon" id="ma-skip5">${svgIcon("skip", 16)}</button>
    </div>
    ${rec.transcript ? `<details class="ma-transcript"><summary>Transcript</summary><pre>${escapeHtml(rec.transcript)}</pre></details>` : ""}
  `;
  wrap.insertBefore(player, wrap.firstChild);

  // simulación de "currentTime" (no hay audio real, sólo UI de navegación)
  let cur = startSec;
  let timer = null;
  const curEl = player.querySelector("#ma-current");
  const progEl = player.querySelector("#ma-progress");

  function tick() {
    if (cur < dur) {
      cur += 1;
      curEl.textContent = formatMmss(cur * 1000);
      progEl.style.width = `${(cur / dur) * 100}%`;
    } else {
      stop();
    }
  }
  function play() {
    if (timer) return;
    timer = setInterval(tick, 1000);
    player.querySelector("#ma-play").innerHTML = svgIcon("pause", 16);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    player.querySelector("#ma-play").innerHTML = svgIcon("play", 16);
  }
  function close() {
    stop();
    player.remove();
  }

  player.querySelector("#ma-play").addEventListener("click", () => (timer ? stop() : play()));
  player.querySelector("#ma-skip5").addEventListener("click", () => { cur = Math.min(dur, cur + 30); tick(); });
  player.querySelector(".ma-close").addEventListener("click", close);
  // click en track → seek
  player.querySelector("#ma-track").addEventListener("click", (e) => {
    const tr = player.querySelector("#ma-track");
    const rect = tr.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    cur = Math.floor(dur * pct);
    curEl.textContent = formatMmss(cur * 1000);
    progEl.style.width = `${pct * 100}%`;
  });

  // highlight book ref si viene en query
  if (bookRef) highlightBookRef(root, bookRef);
}

function formatMmss(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ============================================================
 * v1.6.3 — highlight book ref en el text-layer
 * ============================================================ */
function highlightBookRef(root, ref) {
  const layer = root.querySelector(".text-layer");
  if (!layer) return;
  layer.querySelectorAll(".tl-bookref").forEach((el) => {
    if (el.dataset.bookref === ref) {
      el.classList.add("hl");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

function setupCanvas(root, noteId, pageIdx, strokes, pages) {
  const wrap = root.querySelector("#canvas-wrap");
  const canvas = root.querySelector("#canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const placeholders = pages[pageIdx]?.placeholders || [];
  const note = root._note || { body: "" };

  // v1.5.0: capa de texto (debajo del canvas). Soporta [[wikilinks]],
  // ==subrayado==, !!resaltado!!, ==flashcards== `{{c1::front::back}}`.
  // Render con divs absolutos, NO contenido del canvas (puede haber
  // dibujo encima).
  let textLayer = wrap.querySelector(".text-layer");
  if (!textLayer) {
    textLayer = document.createElement("div");
    textLayer.className = "text-layer";
    wrap.insertBefore(textLayer, canvas);
  }
  renderTextLayer(textLayer, note.body || "");

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

/* ============================================================
 * v1.5.1 — extracción de flashcards inline `{{c1::...::...}}`
 * Llama al backend y refresca el panel con las tarjetas creadas.
 * ============================================================ */
async function extractFlashcardsFromNote(noteId) {
  const r = await fetch(`http://localhost:4100/api/v1/notes/${noteId}/extract-flashcards`, { method: "POST" });
  if (!r.ok) { alert(`Error: ${r.status}`); return; }
  const data = await r.json();
  showFlashcardsPanel(noteId, data);
}

/* ============================================================
 * v1.5.1 — panel flotante con flashcards extraídas y editor manual
 * ============================================================ */
async function showFlashcardsPanel(noteId, justCreated) {
  document.querySelectorAll(".fc-panel").forEach((p) => p.remove());
  let cards = [];
  try {
    const r = await fetch(`http://localhost:4100/api/v1/flashcards/filter?noteId=${noteId}`);
    if (r.ok) {
      const all = await r.json();
      cards = all.cards || [];
    }
  } catch {}
  // fallback: extraer del body localmente para que el panel nunca esté vacío
  // cuando la nota tiene inline cards pero el backend no está conectado
  if (cards.length === 0) {
    try {
      const note = await dataSource.notes.get(noteId);
      const re = /\{\{c1::([^}]+?)\}\}/g;
      const matches = [...((note?.body || "").matchAll(re))];
      cards = matches.map((m, i) => {
        const inner = m[1];
        const [front, back] = inner.split("::").map((s) => s.trim());
        return {
          id: `local-${noteId}-${i}`,
          front: front || "card",
          back: back || "",
          subject: note.subject || "",
          tags: note.tags || [],
          sourceNoteId: noteId,
          sourceExcerpt: inner.slice(0, 80),
        };
      });
    } catch {}
  }
  const panel = document.createElement("div");
  panel.className = "fc-panel scrim";
  panel.innerHTML = `
    <div class="sheet">
      <div class="sheet-header">
        <h3>${i18n.t("notes.flashcardsTitle")}</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="muted small">${i18n.t("notes.flashcardsSubtitle", { created: justCreated?.created?.length ?? 0, skipped: justCreated?.skipped ?? 0, total: cards.length })}</div>
      <div class="fc-grid">
        ${cards.map((c) => `
          <div class="fc-card" data-id="${c.id}">
            <div class="fc-front">${escapeHtml(c.front)}</div>
            <div class="fc-back">${escapeHtml(c.back)}</div>
            <div class="fc-meta">${escapeHtml(c.subject || "—")} · ${(c.tags || []).map((t) => "#" + t).join(" ")}</div>
            <button class="btn small" data-act="edit" data-id="${c.id}">${i18n.t("common.edit")}</button>
            <button class="btn small danger" data-act="delete" data-id="${c.id}">${i18n.t("common.delete")}</button>
          </div>
        `).join("")}
        ${cards.length === 0 ? `<div class="empty"><div class="em-title">${i18n.t("notes.noFlashcards")}</div><div>${i18n.t("notes.flashcardHint")}</div></div>` : ""}
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn primary" id="study-cards">${svgIcon("flashcard", 16)} ${i18n.t("notes.study")}</button>
        <button class="btn primary" id="add-card">${i18n.t("notes.newFlashcard")}</button>
        <button class="btn" data-act="close">${i18n.t("common.close")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  const close = () => panel.remove();
  panel.addEventListener("click", (e) => {
    if (e.target === panel || e.target.dataset.act === "close") close();
    if (e.target.dataset.act === "edit") openCardEditor(noteId, cards.find((c) => c.id === e.target.dataset.id));
    if (e.target.dataset.act === "delete") deleteCard(noteId, e.target.dataset.id);
  });
  panel.querySelector("#add-card").addEventListener("click", () => openCardEditor(noteId, null));
  panel.querySelector("#study-cards").addEventListener("click", async () => {
    // v1.7.0: re-fetch latest cards before opening session
    const fresh = await fetch(`http://localhost:4100/api/v1/flashcards/filter?noteId=${noteId}`).then((r) => r.ok ? r.json() : { cards: [] });
    const list = fresh.cards || [];
    if (list.length === 0) { alert(i18n.t("notes.noFlashcards")); return; }
    close();
    openStudySession(list);
  });
}

async function deleteCard(noteId, id) {
  if (!id.startsWith("local-")) {
    try {
      await fetch(`http://localhost:4100/api/v1/flashcards/${id}`, { method: "DELETE" });
    } catch {}
  }
  showFlashcardsPanel(noteId, { created: [], skipped: 0 });
}

function openFlashcardEditor(noteId, note) {
  openCardEditor(noteId, null, note);
}

/* v1.5.1 — editor de flashcard individual (front/back + asignatura) */
async function openCardEditor(noteId, card, noteCtx) {
  document.querySelectorAll(".fc-editor").forEach((p) => p.remove());
  const subjects = await fetch("http://localhost:4100/api/v1/subjects").then((r) => r.json());
  const subjectOpts = (subjects.subjects || []).map((s) => `<option value="${escapeHtml(s.id)}" ${card?.subject === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
  const note = noteCtx || (await fetch(`http://localhost:4100/api/v1/notes/${noteId}`).then((r) => r.json()));
  const editor = document.createElement("div");
  editor.className = "fc-editor scrim";
  editor.innerHTML = `
    <div class="sheet">
      <div class="sheet-header">
        <h3>${card ? i18n.t("notes.editFlashcard") : i18n.t("notes.newFlashcard")}</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div class="muted small">${i18n.t("notes.flashcardSourceNote", { note: escapeHtml(note.title || noteId) })}</div>
      <div style="margin-top: var(--s-4); display: flex; flex-direction: column; gap: 12px">
        <label class="lbl">${i18n.t("notes.flashcardFront")}</label>
        <textarea class="input" id="fc-front" rows="3" placeholder="${i18n.t("notes.flashcardFrontPh")}">${escapeHtml(card?.front || "")}</textarea>
        <label class="lbl">${i18n.t("notes.flashcardBack")}</label>
        <textarea class="input" id="fc-back" rows="3" placeholder="${i18n.t("notes.flashcardBackPh")}">${escapeHtml(card?.back || "")}</textarea>
        <label class="lbl">${i18n.t("notes.flashcardSubject")}</label>
        <select class="input" id="fc-subject">
          <option value="">—</option>
          ${subjectOpts}
        </select>
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn primary" id="fc-save">${i18n.t("common.save")}</button>
        <button class="btn" data-act="close">${i18n.t("common.cancel")}</button>
      </div>
    </div>
  `;
  document.body.appendChild(editor);
  const close = () => editor.remove();
  editor.addEventListener("click", (e) => { if (e.target === editor || e.target.dataset.act === "close") close(); });
  editor.querySelector("#fc-save").addEventListener("click", async () => {
    const front = editor.querySelector("#fc-front").value.trim();
    const back = editor.querySelector("#fc-back").value.trim();
    const subject = editor.querySelector("#fc-subject").value;
    if (!front || !back) { alert(i18n.t("notes.flashcardRequired")); return; }
    const payload = {
      front, back, subject, tags: note.tags || [],
      sourceNoteId: noteId,
      sourceExcerpt: (front + "::" + back).slice(0, 80),
    };
    const url = card ? `http://localhost:4100/api/v1/flashcards/${card.id}` : `http://localhost:4100/api/v1/flashcards`;
    const method = card ? "PATCH" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) { alert(`Error: ${r.status}`); return; }
    close();
    showFlashcardsPanel(noteId, { created: [], skipped: 0 });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ============================================================
 * renderTextLayer — v1.5.0 Samsung Notes style
 *
 * Sintaxis soportada en `body`:
 *   ==texto==          → subrayado (yellow underline)
 *   !!texto!!          → resaltado (yellow highlighter bg)
 *   [[Nota]]           → wikilink a otra nota
 *   @libro/parte       → referencia a parte subrayada de libro
 *   {{c1::pregunta::respuesta}} → flashcard inline (se extrae)
 *
 * El texto va DEBAJO del canvas; los strokes quedan encima,
 * igual que en Samsung Notes: escribes con stylus encima del texto.
 * ============================================================ */
function renderTextLayer(layer, body) {
  if (!body || !body.trim()) {
    layer.innerHTML = `<div class="tl-hint">${i18n.t("notes.textHint")}</div>`;
    return;
  }
  // 1. escapar html
  let html = escapeHtml(body);
  // 2. subrayar ==x==
  html = html.replace(/==(.+?)==/g, '<span class="tl-underline">$1</span>');
  // 3. resaltar !!x!!
  html = html.replace(/!!(.+?)!!/g, '<span class="tl-highlight">$1</span>');
  // 4. wikilinks [[Nota]] (v1.5.5: buscan la nota por título, navega)
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, name) =>
    `<a class="tl-wikilink" data-wikilink="${escapeHtml(name)}" href="#/notes">${escapeHtml(name)}</a>`);
  // 5. refs a libros @libro/parte
  html = html.replace(/@([\wÀ-ÿ\/\-\.]+)/g, '<a class="tl-bookref" data-bookref="$1">📖 $1</a>');
  // 6. flashcards inline {{c1::pregunta::respuesta}}
  html = html.replace(/\{\{c1::([^}]+)\}\}/g, (_, inner) => {
    const [front, back] = inner.split("::");
    return `<span class="tl-flashcard" data-front="${escapeHtml(front || "")}" data-back="${escapeHtml(back || "")}">🎴 ${escapeHtml(front || "card")}</span>`;
  });
  // 7. párrafos por línea
  html = html.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
  layer.innerHTML = html;

  // v1.5.5: wikilink click → buscar nota por título y navegar
  layer.querySelectorAll(".tl-wikilink").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const target = a.dataset.wikilink;
      const all = await dataSource.notes.list();
      const found = all.find((n) => (n.title || "").toLowerCase() === target.toLowerCase()) || all[0];
      if (found) {
        state.selectedId = found.id;
        state.page = 0;
        location.hash = "#/notes";
        // Trigger re-render of notes screen
        const app = document.getElementById("app");
        if (app) {
          const ev = new HashChangeEvent("hashchange");
          window.dispatchEvent(ev);
        }
      }
    });
  });
}
