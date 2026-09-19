/* ============================================================
 * screens/notes.js — notebook con canvas stylus-first.
 * v1.4.0 — splash + top toolbar (undo/redo/bg/hide)
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { makeModal } from "../widgets/modal.js";
// v2.6.0: top_toolbar.js no longer used — replaced by bottom toolbar
// (see .notebook-toolbar-bottom). The droplet (background toggle), undo/redo,
// and hide buttons are now in the consolidated bottom panel.
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
  const folders = await dataSource.folders.list();
  const activeTag = getActiveTag();
  // v1.9.1: expose notes for tags_cloud
  window.__mnexusNoteList = async () => await dataSource.notes.list();
  const filtered = activeTag ? notes.filter((n) => extractTags(n.body).includes(activeTag)) : notes;
  // v2.3.0-B: tree sidebar layout (single source of nav in Notes)
  root.innerHTML = `
    <div class="screen notes-with-sidebar">
      <aside class="notes-tree" id="notes-tree">
        <div class="tree-actions">
          <button class="btn icon" id="new-folder" title="${i18n.t("notes.newFolder")}" aria-label="${i18n.t("notes.newFolder")}">📁+</button>
          <button class="btn primary small" id="new-note">${i18n.t("notes.new")}</button>
        </div>
        <div id="tree-root"></div>
      </aside>
      <main class="notes-content">
        <header class="screen-header">
          <h1 class="h-title">${i18n.t("dock.notes")}</h1>
          <div class="spacer"></div>
          <input class="input" id="search" placeholder="${i18n.t("notes.search")}" style="max-width:240px" />
        </header>
        <div id="tags-cloud" class="tags-bar"></div>
        <div class="book-grid" id="grid"><div class="empty"><div class="em-title">${i18n.t("common.loading")}</div></div></div>
      </main>
    </div>
  `;

  // Render the tree (folders + notes, recursive)
  const renderTree = () => {
    const treeEl = root.querySelector("#tree-root");
    const treeHtml = (parentId, depth) => {
      const childrenFolders = folders.filter(f => f.parentId === parentId);
      const childrenNotes = filtered.filter(n => (n.folderId ?? null) === parentId);
      if (childrenFolders.length === 0 && childrenNotes.length === 0 && depth > 0) return "";
      let html = "";
      for (const f of childrenFolders) {
        html += `<div class="tree-folder" data-id="${f.id}" data-depth="${depth}">
          <div class="folder-row">
            <span class="folder-icon">${f.icon === "folder" ? "📁" : f.icon}</span>
            <span class="folder-name">${escapeHtml(f.name)}</span>
            <button class="add-to-folder" data-folder="${f.id}" title="+ nota">+</button>
          </div>
          <div class="folder-children">${treeHtml(f.id, depth + 1)}</div>
        </div>`;
      }
      for (const n of childrenNotes) {
        html += `<div class="tree-note" data-id="${n.id}" data-depth="${depth}" data-title="${escapeHtml(n.title)}">
          <span class="note-bullet">·</span>
          <span class="note-name">${escapeHtml(n.title)}</span>
        </div>`;
      }
      return html;
    };
    treeEl.innerHTML = treeHtml(null, 0);
    // Wire events
    treeEl.querySelectorAll(".tree-note").forEach((el) => {
      el.addEventListener("click", () => { state.selectedId = el.dataset.id; state.page = 0; renderNotes(root); });
    });
    treeEl.querySelectorAll(".add-to-folder").forEach((b) => {
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const n = await dataSource.notes.create({ title: i18n.t("notes.untitled"), folderId: b.dataset.folder });
        state.selectedId = n.id;
        renderNotes(root);
      });
    });
  };
  renderTree();

  // Tags cloud
  await renderTagsCloud(root.querySelector("#tags-cloud"));
  document.addEventListener("tags:change", async () => {
    if (location.hash.startsWith("#/notes")) renderNotes(root);
  });

  // Wire actions
  root.querySelector("#new-note").addEventListener("click", async () => {
    const n = await dataSource.notes.create({ title: i18n.t("notes.untitled"), body: "" });
    state.selectedId = n.id;
    state.page = 0;
    renderNotes(root);
  });
  root.querySelector("#new-folder").addEventListener("click", async () => {
    const name = prompt(i18n.t("notes.folderName") || "Folder name");
    if (!name) return;
    await dataSource.folders.create({ name });
    renderNotes(root);
  });
  root.querySelector("#search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    root.querySelectorAll(".tree-note").forEach((c) => {
      const title = c.dataset.title.toLowerCase();
      const folder = c.closest(".tree-folder");
      const match = title.includes(q);
      c.style.display = match ? "" : "none";
      // Show parent folder if any child matches
      if (folder && q) {
        folder.style.display = folder.querySelectorAll(".tree-note:not([style*='none'])").length > 0 ? "" : "none";
      }
    });
  });

  // Grid in main area (for visual continuity)
  if (filtered.length === 0) {
    const emptyMsg = `<div class="empty"><div class="em-title">${i18n.t("notes.noNotes")}</div><div>${i18n.t("notes.createFirst")}</div></div>`;
    root.querySelector("#grid").innerHTML = emptyMsg;
  } else {
    // Show "All notes" count in main area, but most nav is via tree
    root.querySelector("#grid").innerHTML = `
      <div class="empty">
        <div class="em-title">${filtered.length} ${filtered.length === 1 ? "note" : "notes"}</div>
        <div>${i18n.t("notes.selectFromTree") || "Select from sidebar →"}</div>
      </div>
    `;
  }
}

async function renderNotebook(root, id) {
  const note = await dataSource.notes.get(id);
  if (!note) { state.selectedId = null; return renderNotesList(root); }

  const pages = note.pages && note.pages.length > 0 ? note.pages : [{ strokes: [], placeholders: [] }];
  if (state.page >= pages.length) state.page = pages.length - 1;
  const page = pages[state.page] || pages[0];

  // v2.4.0: Adaptive editor — tablet/desktop (≥720px) gets canvas + AI side panel,
  // mobile/portrait (<720px) gets Google Docs-like text-only editor.
  if (window.innerWidth >= 720) {
    root.innerHTML = renderNotebookWideHTML(note, pages);
  } else {
    root.innerHTML = renderNotebookNarrowHTML(note);
    // Auto-save body for narrow layout (text-based editing)
    setTimeout(() => {
      const ta = root.querySelector("#body");
      if (!ta) return;
      let timer = null;
      ta.addEventListener("input", (e) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          await dataSource.notes.update(id, { body: e.target.value });
          // Notify AI context refresh so the AI screen reflects new body
          setAIScreenContext({ note: { ...note, body: e.target.value }, subject: note.subject });
        }, 600);
      });
    }, 0);
    // Wire narrow-only handlers
    wireNarrow(root, id, note);
    // v2.12.0: narrow layout now also mounts a canvas so mobile users can
    // draw with finger/stylus. The textarea is hidden but stays for text
    // editing if needed. We mirror strokes → body so saves still work.
    setupCanvas(root, id, state.page, pages[state.page]?.strokes || [], pages);
    root._note = note;
    return;
  }

  // === Wide layout (canvas + AI side panel) ===
  // v2.6.0: 5 side tabs — Notes | Cards | Media (3D/images) | All notes list | AI
  const sideContent = root.querySelector("#side-content");
  const switchSide = async (tab) => {
    root.querySelectorAll(".side-tab").forEach(t => t.classList.toggle("active", t.dataset.side === tab));
    if (tab === "notes") {
      sideContent.innerHTML = renderNotesSideHTML(note);
    } else if (tab === "cards") {
      sideContent.innerHTML = renderCardsSideHTML(note);
      wireCardsSide(sideContent, note);
    } else if (tab === "media") {
      sideContent.innerHTML = renderMediaSideHTML(note);
      wireMediaSide(sideContent, note);
    } else if (tab === "list") {
      sideContent.innerHTML = renderNotesListSideHTML(note);
      wireNotesListSide(sideContent, note, id);
    } else if (tab === "ai") {
      sideContent.innerHTML = renderAISideHTML(note);
      wireAISide(sideContent, note);
    }
  };
  root.querySelectorAll(".side-tab").forEach((b) => {
    b.addEventListener("click", () => switchSide(b.dataset.side));
  });
  switchSide("notes");

  // v2.5.0: draggable splitter for side panel
  setupSplitter(root);
  setupToolbarToggle(root);

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

  // v2.6.0: open AI side panel from bottom toolbar
  root.querySelector("#open-ai-side")?.addEventListener("click", () => {
    const panel = root.querySelector("#side-panel");
    const aiTab = root.querySelector('.side-tab[data-side="ai"]');
    if (panel) panel.classList.remove("collapsed");
    if (aiTab) aiTab.click();
  });

  // v2.6.0: search button — focus search box in side panel
  root.querySelector("#search-btn")?.addEventListener("click", () => {
    const searchBox = root.querySelector(".search-box, input[type=search]");
    if (searchBox) { searchBox.focus(); }
  });

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

  // v2.6.0: top toolbar removed — tools consolidated into bottom toolbar
  // (.notebook-toolbar-bottom). Was: mountTopToolbar() from top_toolbar.js

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
  const html = `<div class="sheet">
    <div class="sheet-header"><h3>📝 ${i18n.t("notes.ai.summarize")}</h3>
      <button class="btn icon" data-close>${svgIcon("close", 16)}</button></div>
    <div style="margin-top: var(--s-4); line-height: 1.6">${escapeHtml(summary)}</div>
    <div class="muted small" style="margin-top: var(--s-4)">${i18n.t("notes.ai.stubNote")}</div>
    <div class="row gap-2" style="margin-top: var(--s-5)"><button class="btn primary" data-close>${i18n.t("common.close")}</button></div>
  </div>`;
  const { scrim, close } = makeModal(html);
  document.body.appendChild(scrim);
  // keep `close` referenced so tree-shaker doesn't remove it
  void close;
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
  if (act === "undo" || act === "redo") {
    document.dispatchEvent(new CustomEvent(`canvas:${act}`));
    return;
  }
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
    // v2.13.0: pressure + tilt + pointerType for stylus-aware drawing.
    // Mouse events report pressure=0.5 (Safari) or 1.0 default. Pen events
    // report 0..1 with tilt. Touch reports 0 or 1.
    const p = e.pressure !== undefined ? e.pressure : 0.5;
    const tilt = e.tiltX !== undefined ? e.tiltX : 0;
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      p,
      tilt,
      pt: e.pointerType || "mouse",
    };
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
    const last = currentStroke.points[currentStroke.points.length - 1];
    const next = getPos(e);
    // v2.13.0: pressure-sensitive line width.
    // Pen: pressure 0..1 → size × (0.5..1.5). Mouse: default pressure 0.5 → size × 1.
    // Touch: usually 1 (no pressure) → size × 1, but we treat it as full width.
    const baseSize = currentStroke.size;
    const p = (next.pt === "pen" && next.p > 0) ? next.p : 1.0;
    const segmentSize = Math.max(0.5, baseSize * (0.5 + p));
    // v2.14.0: tilt-based opacity. Pen tilt 0..90° → alpha 1..0.5.
    // When stylus is tilted, strokes appear lighter (like real ink shading).
    // Only applies for pen input; mouse/touch keep alpha 1.
    let segAlpha = currentStroke.alpha;
    if (next.pt === "pen" && next.tilt !== undefined) {
      const tiltNorm = Math.min(1, Math.abs(next.tilt) / 90);
      segAlpha = currentStroke.alpha * (1 - tiltNorm * 0.5);
    }
    currentStroke.points.push(next);
    redraw();
    ctx.beginPath();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = segAlpha;
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = segmentSize;
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
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
      // v2.13.0: offline handwriting OCR — debounced per-stroke, sends the
      // completed stroke to /api/v1/handwriting/recognize and appends the
      // recognized text to the note body. Throttled to avoid spamming the
      // backend while the user is actively drawing.
      if (currentStroke.points.length > 8) {
        scheduleOCR(currentStroke);
      }
    }
    currentStroke = null;
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onUp);

  // v2.13.0: palm rejection — install capture-phase listener that ignores
  // palm contacts (wide touch area on touchscreen).
  installPalmRejection(canvas);

  // v2.13.0: OCR scheduling — debounced so we don't spam the backend while
  // the user is drawing. After 800ms of inactivity, send all strokes since
  // the last OCR run and append recognized text.
  let ocrTimer = null;
  let ocrPending = [];
  function scheduleOCR(stroke) {
    ocrPending.push(stroke);
    if (ocrTimer) clearTimeout(ocrTimer);
    ocrTimer = setTimeout(runOCR, 800);
  }
  async function runOCR() {
    const batch = ocrPending.splice(0);
    if (batch.length === 0) return;
    // Flatten strokes for backend (x,y,t)
    const flat = [];
    for (const s of batch) {
      for (const p of s.points) {
        flat.push({ x: p.x, y: p.y, t: Date.now() + (s.t || 0) });
      }
    }
    if (flat.length < 5) return;
    try {
      const r = await fetch("http://localhost:4100/api/v1/handwriting/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokes: flat }),
      });
      if (!r.ok) return;
      const data = await r.json();
      const text = (data?.text || "").trim();
      if (!text || text.length < 2) return;
      // v2.14.0: confidence threshold (skip low-confidence OCR to avoid noise)
      const confidence = typeof data.confidence === "number" ? data.confidence : 0.5;
      if (confidence < 0.3) return;
      // Append to note body (debounced save)
      const note = root._note || (await dataSource.notes.get(noteId));
      const current = note.body || "";
      const next = (current ? current + " " : "") + text;
      await dataSource.notes.update(noteId, { body: next });
      root._note = { ...note, body: next };
      setAIScreenContext({ note: { ...note, body: next }, subject: note.subject });
      // v2.14.0: visual feedback — show transient toast with recognized text
      try {
        const { showOcrToast } = await import("../widgets/ocrToast.js");
        showOcrToast(text, confidence, data.source || "tesseract");
      } catch { /* toast module optional */ }
    } catch (e) {
      // OCR unavailable (offline, no backend) — silently skip
    }
  }

  const ro = new ResizeObserver(fit);
  ro.observe(wrap);
  fit();
}

/**
 * v2.13.0: install palm-rejection capture-phase listeners.
 * Returns the cleanup function for testing.
 */
function installPalmRejection(canvas) {
  // Lazy-load to avoid bundling on desktop-only clients
  return import("../widgets/palmRejection.js").then(({ isPalmContact }) => {
    const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
    const handler = (e) => {
      if (isPalmContact(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    for (const t of types) {
      canvas.addEventListener(t, handler, { capture: true });
    }
    return () => {
      for (const t of types) {
        canvas.removeEventListener(t, handler, { capture: true });
      }
    };
  });
}

function openOverviewModal(note) {
  const body = (note.body || "").slice(0, 800);
  const html = `
    <div class="sheet">
      <div class="sheet-header">
        <h3>${i18n.t("notes.overviewTitle")}</h3>
        <button class="btn icon" data-close>✕</button>
      </div>
      <div class="muted small">${i18n.t("notes.overviewSubtitle", { n: note.pages?.length ?? 1 })}</div>
      <div style="margin-top: var(--s-4); white-space: pre-wrap; font-size: var(--fs-md); line-height: 1.6">
${escapeHtml(body) || i18n.t("notes.overviewEmpty")}
      </div>
      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn primary" data-close>${i18n.t("common.close")}</button>
      </div>
    </div>
  `;
  const { scrim, close } = makeModal(html);
  document.body.appendChild(scrim);
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

/* ============================================================
 * v2.4.0 — Adaptive editor layouts
 * ============================================================ */
function renderNotebookWideHTML(note, pages) {
  return `
    <div class="screen notebook-wide" data-layout="wide">
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

      <div class="notebook-workspace">
        <main class="notebook-main" id="notebook-main">
          <div class="notebook" id="canvas-wrap">
            <div class="pencil-drawer">
              <button class="pencil add" id="add-pencil">+</button>
              ${state.pencils.map(p => `<button class="pencil" data-pencil="${p.id}" style="background:${p.color}"></button>`).join("")}
              <button class="pencil trash" data-act="trash" title="Delete pencil">🗑</button>
            </div>
            <canvas id="canvas"></canvas>
            <!-- v2.6.0: single consolidated bottom toolbar (replaces 3 floating toolbars) -->
            <div class="notebook-toolbar-bottom">
              <button class="tool-btn" data-act="undo" title="${i18n.t("notes.tool.undo")}" aria-label="${i18n.t("notes.tool.undo")}">${svgIcon("undo", 18)}</button>
              <button class="tool-btn" data-act="redo" title="${i18n.t("notes.tool.redo")}" aria-label="${i18n.t("notes.tool.redo")}">${svgIcon("redo", 18)}</button>
              <span class="tool-sep"></span>
              <button class="tool-btn" data-tool="pen" title="${i18n.t("notes.tool.pen")}" aria-label="${i18n.t("notes.tool.pen")}">${svgIcon("pen", 18)}</button>
              <button class="tool-btn" data-tool="highlighter" title="${i18n.t("notes.tool.highlighter")}" aria-label="${i18n.t("notes.tool.highlighter")}">${svgIcon("highlighter", 18)}</button>
              <button class="tool-btn" data-tool="eraser" title="${i18n.t("notes.tool.eraser")}" aria-label="${i18n.t("notes.tool.eraser")}">${svgIcon("eraser", 18)}</button>
              <button class="tool-btn" data-tool="select" title="${i18n.t("notes.tool.select")}" aria-label="${i18n.t("notes.tool.select")}">${svgIcon("select", 18)}</button>
              <span class="tool-sep"></span>
              <button class="tool-btn" data-act="voice" title="${i18n.t("notes.tool.voice")}" aria-label="${i18n.t("notes.tool.voice")}">${svgIcon("voice", 18)}</button>
              <button class="tool-btn" data-act="image" title="${i18n.t("notes.tool.image")}" aria-label="${i18n.t("notes.tool.image")}">${svgIcon("image", 18)}</button>
              <button class="tool-btn" data-act="link" title="${i18n.t("notes.tool.link")}" aria-label="${i18n.t("notes.tool.link")}">${svgIcon("link", 18)}</button>
              <button class="tool-btn" data-act="table" title="${i18n.t("notes.tool.table")}" aria-label="${i18n.t("notes.tool.table")}">${svgIcon("table", 18)}</button>
              <span class="tool-sep"></span>
              <button class="tool-btn" id="overview-btn" title="${i18n.t("notes.intelligentOverview")}" aria-label="${i18n.t("notes.intelligentOverview")}">${svgIcon("eye", 18)}</button>
              <button class="tool-btn" id="search-btn" title="${i18n.t("common.search")}" aria-label="${i18n.t("common.search")}">${svgIcon("search", 18)}</button>
              <button class="tool-btn" id="open-ai-side" title="${i18n.t("ai.open") || "AI"}" aria-label="${i18n.t("ai.open") || "AI"}">✦</button>
              <button class="tool-btn" id="new-card-btn" title="${i18n.t("notes.newFlashcard")}" aria-label="${i18n.t("notes.newFlashcard")}">${svgIcon("flashcard", 18)}</button>
              <button class="tool-btn" id="export-pdf" title="PDF" aria-label="PDF">${svgIcon("text", 18)}</button>
            </div>
          </div>
        </main>
        <button class="notebook-toolbar-toggle" id="toolbar-toggle" aria-label="Toggle tools">✏️</button>

        <div class="notebook-splitter" id="notebook-splitter" title="${i18n.t("notes.resize") || "Drag to resize"}"></div>

        <aside class="notebook-side-panel" id="side-panel">
          <button class="side-collapse-btn" id="side-collapse" aria-label="Toggle panel">${i18n.t("notes.collapse") || "Hide"}</button>
          <div class="side-tabs">
            <button class="side-tab active" data-side="notes">📝 ${i18n.t("notes.body") || "Note"}</button>
            <button class="side-tab" data-side="cards">🎴 ${i18n.t("notes.cards") || "Cards"}</button>
            <button class="side-tab" data-side="media">📎 ${i18n.t("notes.media") || "Media"}</button>
            <button class="side-tab" data-side="list">📚 ${i18n.t("notes.list") || "All"}</button>
            <button class="side-tab" data-side="ai">✦ AI</button>
          </div>
          <div class="side-content" id="side-content"></div>
        </aside>
      </div>
    </div>
  `;
}

function renderNotebookNarrowHTML(note) {
  return `
    <div class="screen notebook-narrow" data-layout="narrow">
      <header class="screen-header">
        <button class="btn icon" id="back">${svgIcon("back", 18)}</button>
        <h1 class="h-title" id="title" contenteditable="true" spellcheck="false">${escapeHtml(note.title)}</h1>
        <div class="spacer"></div>
        <div class="pages-nav">
          <button class="icon-btn" id="prev">${svgIcon("back", 16)}</button>
          <span class="lbl">${i18n.t("notes.page", { current: state.page + 1, total: "1" })}</span>
          <button class="icon-btn" id="next" style="transform: scaleX(-1)">${svgIcon("back", 16)}</button>
        </div>
      </header>

      <div class="narrow-doc">
        <div class="canvas-wrap" id="canvas-wrap">
          <canvas id="canvas"></canvas>
        </div>
        <textarea class="doc-textarea" id="body" placeholder="Write your note…" style="display:none;">${escapeHtml(note.body || "")}</textarea>
        <div class="narrow-actions">
          <button class="btn" id="open-ai">✦ ${i18n.t("ai.open") || "Open AI"}</button>
          <button class="btn" id="export-pdf">📄 PDF</button>
        </div>
      </div>
      <div class="notebook-toolbar-bottom" id="notebook-toolbar-bottom">
        <button class="tool-btn" data-tool="pen" title="${i18n.t("notes.tool.pen")}" aria-label="${i18n.t("notes.tool.pen")}">${svgIcon("pen", 18)}</button>
        <button class="tool-btn" data-tool="highlighter" title="${i18n.t("notes.tool.highlighter")}" aria-label="${i18n.t("notes.tool.highlighter")}">${svgIcon("highlighter", 18)}</button>
        <button class="tool-btn" data-tool="eraser" title="${i18n.t("notes.tool.eraser")}" aria-label="${i18n.t("notes.tool.eraser")}">${svgIcon("eraser", 18)}</button>
        <span class="tool-sep"></span>
        <button class="tool-btn" id="open-ai-side" title="${i18n.t("ai.open") || "AI"}" aria-label="AI">✦</button>
        <button class="tool-btn" id="export-pdf-mobile" title="PDF" aria-label="PDF">${svgIcon("text", 18)}</button>
        <button class="tool-btn" id="new-card-btn-mobile" title="${i18n.t("notes.newFlashcard")}" aria-label="${i18n.t("notes.newFlashcard")}">${svgIcon("flashcard", 18)}</button>
        <button class="tool-btn" id="search-btn-mobile" title="${i18n.t("common.search")}" aria-label="${i18n.t("common.search")}">${svgIcon("search", 18)}</button>
        <button class="tool-btn" id="overview-btn-mobile" title="${i18n.t("notes.intelligentOverview")}" aria-label="${i18n.t("notes.intelligentOverview")}">${svgIcon("eye", 18)}</button>
      </div>
      <button class="notebook-toolbar-toggle" id="toolbar-toggle" aria-label="Toggle tools">✏️</button>
    </div>
  `;
}

function wireNarrow(root, id, note) {
  root.querySelector("#back").addEventListener("click", () => { state.selectedId = null; state.page = 0; renderNotes(root); });
  root.querySelector("#prev").addEventListener("click", () => {
    if (state.page > 0) { state.page--; renderNotes(root); }
  });
  root.querySelector("#next").addEventListener("click", () => {
    if (state.page < 1) { state.page = 1; renderNotes(root); } // no-op for narrow (single body)
  });
  const titleEl = root.querySelector("#title");
  if (titleEl) {
    titleEl.addEventListener("blur", async () => {
      await dataSource.notes.update(id, { title: titleEl.textContent.trim() || i18n.t("notes.untitled") });
    });
  }
  root.querySelector("#open-ai").addEventListener("click", () => {
    setAIScreenContext({ note, subject: note.subject });
    location.hash = "#/ai";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  root.querySelector("#export-pdf").addEventListener("click", () => downloadNoteAsPDF(note));

  // v2.11.0: mobile toolbar buttons (mirror the wide layout actions)
  const mirror = (srcId, fn) => {
    const el = root.querySelector(srcId);
    if (el) el.addEventListener("click", fn);
  };
  mirror("#open-ai-side", () => root.querySelector("#open-ai")?.click());
  mirror("#export-pdf-mobile", () => root.querySelector("#export-pdf")?.click());
  mirror("#new-card-btn-mobile", () => {
    // Trigger the existing flashcard slash flow (or open side panel)
    location.hash = "#/notes?topic=" + encodeURIComponent(note.subject || "general");
  });
  mirror("#search-btn-mobile", () => {
    const ta = root.querySelector("#body");
    if (ta) { ta.focus(); ta.select(); }
  });
  mirror("#overview-btn-mobile", () => {
    setAIScreenContext({ note, subject: note.subject });
    location.hash = "#/ai";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/* ============================================================
 * v2.4.0 — Side panel content (for tablet notebook view)
 * ============================================================ */
function renderNotesSideHTML(note) {
  return `
    <div class="side-notes-panel">
      <div class="muted small">Subject: ${escapeHtml(note.subject || "—")}</div>
      <pre class="side-note-body">${escapeHtml(note.body || "(empty)")}</pre>
    </div>
  `;
}

/**
 * renderCardsSideHTML — flashcards tied to this note.
 * Shows existing cards + "Add card" form (front/back).
 * Exported for tests (v2.6.0).
 */
export function renderCardsSideHTML(note, preloaded) {
  const cards = preloaded?.cards;
  let listInner;
  if (preloaded && Array.isArray(cards)) {
    if (cards.length === 0) {
      listInner = `<div class="muted small">${i18n.t("notes.noCards") || "No cards yet for this note."}</div>`;
    } else {
      listInner = cards.map(c => `
        <div class="card-row">
          <div class="card-row-text">
            <div class="card-row-front">${escapeHtml(c.front || c.text || "")}</div>
            <div class="card-row-back">${escapeHtml(c.back || "")}</div>
          </div>
          <span class="card-row-state" data-state="${escapeHtml(c.state || "new")}">${escapeHtml(c.state || "new")}</span>
        </div>
      `).join("");
    }
  } else {
    listInner = `<div class="muted small">${i18n.t("common.loading") || "Loading…"}</div>`;
  }
  return `
    <div class="side-cards-panel">
      <div class="muted small" style="margin-bottom: var(--s-2)">${i18n.t("notes.cardsOf", { title: escapeHtml(note.title) })}</div>
      <div id="cards-list" class="cards-list">${listInner}</div>
      <details class="card-add-form">
        <summary>+ ${i18n.t("notes.newCard") || "New card"}</summary>
        <div class="card-form-body">
          <input class="input small" id="card-front" placeholder="${i18n.t("notes.cardFront") || "Front (question)"}" />
          <textarea class="input small" id="card-back" rows="2" placeholder="${i18n.t("notes.cardBack") || "Back (answer)"}"></textarea>
          <button class="btn primary small" id="card-save">${i18n.t("common.save")}</button>
        </div>
      </details>
    </div>
  `;
}

async function wireCardsSide(root, note) {
  const list = root.querySelector("#cards-list");
  try {
    const data = await api.flashcards.filter(note.id);
    const cards = data.cards || data.flashcards || [];
    if (cards.length === 0) {
      list.innerHTML = `<div class="muted small">${i18n.t("notes.noCards") || "No cards yet for this note."}</div>`;
    } else {
      list.innerHTML = cards.map(c => `
        <div class="card-row">
          <div class="card-row-text">
            <div class="card-row-front">${escapeHtml(c.front || c.text || "")}</div>
            <div class="card-row-back">${escapeHtml(c.back || "")}</div>
          </div>
          <span class="card-row-state" data-state="${c.state || "new"}">${escapeHtml(c.state || "new")}</span>
        </div>
      `).join("");
    }
  } catch (e) {
    list.innerHTML = `<div class="muted small">${i18n.t("notes.cardsError") || "Error loading cards."}</div>`;
  }
  // Save handler
  const saveBtn = root.querySelector("#card-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const front = root.querySelector("#card-front").value.trim();
      const back = root.querySelector("#card-back").value.trim();
      if (!front) return;
      saveBtn.disabled = true;
      try {
        await api.flashcards.create({ front, back, sourceNoteId: note.id, subject: note.subject || "" });
        root.querySelector("#card-front").value = "";
        root.querySelector("#card-back").value = "";
        await wireCardsSide(root, note); // refresh list
      } catch (e) {
        alert("Error: " + (e.message || "could not save card"));
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

/**
 * renderMediaSideHTML — attachments (images/PDFs/3D models) of this note + other notes.
 * Lets the user quickly preview or switch context to another note's media.
 * Exported for tests (v2.6.0).
 */
export function renderMediaSideHTML(note, preloaded) {
  const atts = preloaded?.attachments;
  const others = preloaded?.otherNotes || [];
  let attsInner;
  if (Array.isArray(atts)) {
    if (atts.length === 0) {
      attsInner = `<div class="muted small">${i18n.t("notes.noAttachments") || "No attachments."} ${i18n.t("notes.useAttachBar") || "Use the attach bar."}</div>`;
    } else {
      attsInner = atts.map(a => `
        <div class="media-card" data-name="${escapeHtml(a.name)}" data-type="${escapeHtml(a.type)}">
          <div class="media-card-thumb">${a.type === "pdf" ? "📄" : a.type === "image" ? "🖼️" : "📎"}</div>
          <div class="media-card-title">${escapeHtml(a.name)}</div>
        </div>
      `).join("");
    }
  } else {
    attsInner = `<div class="muted small">${i18n.t("common.loading") || "Loading…"}</div>`;
  }
  const othersInner = others.length === 0
    ? `<div class="muted small">${i18n.t("notes.noOtherWithAttachments") || "No other notes have attachments yet."}</div>`
    : others.map(o => `
        <a class="media-other-note" href="#/notes?id=${escapeHtml(o.id)}">
          <span>📝</span>
          <span>${escapeHtml(o.title || "Untitled")}</span>
          <span class="notes-list-subject">${escapeHtml(o.subject || "")}</span>
        </a>
      `).join("");
  return `
    <div class="side-media-panel">
      <div class="muted small" style="margin-bottom: var(--s-2)">${i18n.t("notes.attachmentsOf", { title: escapeHtml(note.title) })}</div>
      <div id="media-list" class="media-grid">${attsInner}</div>
      <div class="muted small" style="margin-top: var(--s-4); margin-bottom: var(--s-2)">${i18n.t("notes.otherNotes") || "Other notes"}</div>
      <div id="media-other">${othersInner}</div>
    </div>
  `;
}

async function wireMediaSide(root, note) {
  const list = root.querySelector("#media-list");
  try {
    const raw = localStorage.getItem("mnexus.attachments.v1");
    const map = raw ? JSON.parse(raw) : {};
    const attachments = map[note.id] || [];
    if (attachments.length === 0) {
      list.innerHTML = `<div class="muted small">${i18n.t("notes.noAttachments") || "No attachments. Use the Attach bar to add images, PDFs, or 3D models."}</div>`;
    } else {
      list.innerHTML = attachments.map(a => {
        const icon = a.kind === "image" ? "🖼" : a.kind === "pdf" ? "📄" : a.kind === "glb" ? "🧊" : "📎";
        return `<div class="media-card" data-att-id="${a.id}" data-kind="${a.kind}">
          <div class="media-card-thumb">${icon}</div>
          <div class="media-card-title">${escapeHtml(a.title || a.kind)}</div>
        </div>`;
      }).join("");
      // Click to open attachment viewer
      list.querySelectorAll(".media-card").forEach((el) => {
        el.addEventListener("click", () => {
          const attId = el.dataset.attId;
          const att = attachments.find(a => a.id === attId);
          if (att) openAttachmentInPanel(att, root);
        });
      });
    }
  } catch (e) {
    list.innerHTML = `<div class="muted small">${i18n.t("notes.mediaError") || "Error loading attachments."}</div>`;
  }
  // List other notes with attachments (so user can switch context)
  const other = root.querySelector("#media-other");
  try {
    const allNotes = await dataSource.notes.list();
    const otherWithAtt = allNotes.filter(n => {
      if (n.id === note.id) return false;
      const att = (JSON.parse(localStorage.getItem("mnexus.attachments.v1") || "{}"))[n.id] || [];
      return att.length > 0;
    });
    if (otherWithAtt.length === 0) {
      other.innerHTML = `<div class="muted small">${i18n.t("notes.noOtherWithAttachments") || "No other notes have attachments yet."}</div>`;
    } else {
      other.innerHTML = otherWithAtt.slice(0, 5).map(n => `
        <a class="media-other-note" href="#/notes?id=${encodeURIComponent(n.id)}">
          <span class="media-other-icon">📎</span>
          <span class="media-other-title">${escapeHtml(n.title || "Untitled")}</span>
        </a>
      `).join("");
    }
  } catch {}
}

function openAttachmentInPanel(att, root) {
  const list = root.querySelector("#media-list");
  if (!list) return;
  const viewer = document.createElement("div");
  viewer.className = "media-viewer";
  if (att.kind === "image") {
    viewer.innerHTML = `<img src="${att.dataUrl}" alt="${escapeHtml(att.title || "")}" />`;
  } else if (att.kind === "pdf") {
    viewer.innerHTML = `<iframe src="${att.dataUrl}" title="${escapeHtml(att.title || "")}"></iframe>`;
  } else {
    viewer.innerHTML = `<div class="muted">Preview not available for ${att.kind}</div>`;
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "media-viewer-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => viewer.remove());
  viewer.appendChild(closeBtn);
  // Replace the list with the viewer temporarily
  list.replaceWith(viewer);
  // Restore button
  const back = document.createElement("button");
  back.className = "btn ghost small";
  back.textContent = "← Back to list";
  back.addEventListener("click", () => wireMediaSide(root, currentNote));
  viewer.appendChild(back);
}

/**
 * renderNotesListSideHTML — list of all notes. Click to switch context.
 * Exported for tests (v2.6.0).
 */
export function renderNotesListSideHTML(note, preloaded) {
  const all = preloaded?.notes;
  let resultsInner;
  if (Array.isArray(all)) {
    if (all.length === 0) {
      resultsInner = `<div class="muted small">${i18n.t("common.noResults") || "No notes found."}</div>`;
    } else {
      resultsInner = all.slice(0, 30).map(n => `
        <a class="notes-list-item ${n.id === (preloaded?.currentId || note.id) ? "active" : ""}" href="#/notes?id=${encodeURIComponent(n.id)}">
          <span>${escapeHtml(n.title || "Untitled")}</span>
          <span class="notes-list-subject">${escapeHtml(n.subject || "")}</span>
        </a>
      `).join("");
    }
  } else {
    resultsInner = `<div class="muted small">${i18n.t("common.loading") || "Loading…"}</div>`;
  }
  return `
    <div class="side-notes-list-panel">
      <div class="muted small" style="margin-bottom: var(--s-2)">${i18n.t("notes.allNotes") || "All notes"}</div>
      <input class="input small" id="notes-list-search" placeholder="${i18n.t("common.search")}" />
      <div id="notes-list-results" class="notes-list-results">${resultsInner}</div>
    </div>
  `;
}

async function wireNotesListSide(root, currentNote, currentId) {
  const results = root.querySelector("#notes-list-results");
  const search = root.querySelector("#notes-list-search");
  const renderList = async (filter = "") => {
    const all = await dataSource.notes.list();
    const f = filter.toLowerCase().trim();
    const filtered = f ? all.filter(n => (n.title || "").toLowerCase().includes(f)) : all;
    if (filtered.length === 0) {
      results.innerHTML = `<div class="muted small">${i18n.t("common.noResults") || "No notes found."}</div>`;
      return;
    }
    results.innerHTML = filtered.slice(0, 30).map(n => `
      <a class="notes-list-item ${n.id === currentId ? "active" : ""}" href="#/notes?id=${encodeURIComponent(n.id)}">
        <span class="notes-list-title">${escapeHtml(n.title || "Untitled")}</span>
        ${n.subject ? `<span class="notes-list-subject">${escapeHtml(n.subject)}</span>` : ""}
      </a>
    `).join("");
  };
  renderList();
  if (search) {
    search.addEventListener("input", () => renderList(search.value));
  }
}

function renderAISideHTML(note) {
  return `
    <div class="side-ai-mini">
      <div class="ctx-line">
        <span class="ctx-label">Note:</span>
        <span class="ctx-value">${escapeHtml(note.title)}</span>
      </div>
      <div class="ai-quick-actions mini">
        <button class="ai-action-card small" data-act="clozes">
          <span class="ai-action-icon">✨</span>
          <span class="ai-action-label">${i18n.t("ai.action.clozes") || "Generate Clozes"}</span>
        </button>
        <button class="ai-action-card small" data-act="summarize">
          <span class="ai-action-icon">📝</span>
          <span class="ai-action-label">${i18n.t("ai.action.summarize") || "Summarize"}</span>
        </button>
        <button class="ai-action-card small" data-act="flashcards">
          <span class="ai-action-icon">🎴</span>
          <span class="ai-action-label">${i18n.t("ai.action.flashcards") || "Make Cards"}</span>
        </button>
      </div>
      <button class="btn primary full-width" id="open-full-ai">${i18n.t("ai.openFull") || "Open full AI"}</button>
    </div>
  `;
}

function wireAISide(root, note) {
  let message = "";
  const show = (text) => {
    message = text;
    let box = root.querySelector("#side-ai-result");
    if (!box) {
      box = document.createElement("div");
      box.id = "side-ai-result";
      box.className = "side-ai-result";
      root.appendChild(box);
    }
    box.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
  };
  root.querySelectorAll(".ai-action-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "flashcards") {
        try {
          const r = await fetch(`${api.base}/notes/${note.id}/extract-flashcards`, { method: "POST" });
          if (r.ok) {
            const data = await r.json();
            show(`Extracted ${data.created.length} flashcard(s).`);
          } else {
            show("Backend unavailable.");
          }
        } catch { show("Offline."); }
      } else if (act === "clozes") {
        show(`Generate cloze cards from:\n\n${(note.body || "").slice(0, 200)}…`);
      } else if (act === "summarize") {
        show(`Summary of "${note.title}":\n\n3 main points:\n1. Definition\n2. Mechanism\n3. Application`);
      }
    });
  });
  root.querySelector("#open-full-ai").addEventListener("click", () => {
    setAIScreenContext({ note, subject: note.subject });
    location.hash = "#/ai";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/* ============================================================
 * v2.5.0 — Draggable panel splitter (resizes side-panel width).
 * Persists size in localStorage["mnexus.sidepanel.width"] = px.
 * Persists collapsed state in ["mnexus.sidepanel.collapsed"] = "1".
 * ============================================================ */
/**
 * v2.11.0: mobile toolbar toggle — show/hide the bottom toolbar with a
 * single FAB. Saves space on small screens.
 */
function setupToolbarToggle(root) {
  const btn = root.querySelector("#toolbar-toggle");
  const toolbar = root.querySelector(".notebook-toolbar-bottom");
  if (!btn || !toolbar) return;
  // Only enable on mobile
  if (window.innerWidth >= 720) {
    toolbar.classList.remove("collapsed-by-toggle");
    btn.classList.add("hidden");
    return;
  }
  const saved = localStorage.getItem("mnexus.toolbar.visible") !== "0";
  if (!saved) toolbar.classList.add("collapsed-by-toggle");
  const update = () => {
    const visible = !toolbar.classList.contains("collapsed-by-toggle");
    btn.classList.toggle("hidden", visible);
    btn.textContent = visible ? "✏️" : "✕";
    btn.title = visible ? "Hide tools" : "Show tools";
  };
  update();
  btn.addEventListener("click", () => {
    toolbar.classList.toggle("collapsed-by-toggle");
    const visible = !toolbar.classList.contains("collapsed-by-toggle");
    localStorage.setItem("mnexus.toolbar.visible", visible ? "1" : "0");
    update();
  });
}

function setupSplitter(root) {
  const splitter = root.querySelector("#notebook-splitter");
  const panel = root.querySelector("#side-panel");
  const collapseBtn = root.querySelector("#side-collapse");
  if (!splitter || !panel) return;

  // Restore saved width
  const savedWidth = parseInt(localStorage.getItem("mnexus.sidepanel.width") || "", 10);
  if (savedWidth >= 240 && savedWidth <= 600) {
    panel.style.flex = `0 0 ${savedWidth}px`;
  }
  // Restore collapsed
  if (localStorage.getItem("mnexus.sidepanel.collapsed") === "1") {
    panel.classList.add("collapsed");
  }

  // v2.11.0: first-use hint — pulse the splitter briefly so user notices it
  const hintShown = localStorage.getItem("mnexus.sidepanel.hint-shown") === "1";
  if (!hintShown) {
    splitter.classList.add("hint-pulse");
    setTimeout(() => {
      splitter.classList.remove("hint-pulse");
      localStorage.setItem("mnexus.sidepanel.hint-shown", "1");
    }, 4000);
  }

  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    let newWidth = startWidth - dx; // dragging left → panel grows
    newWidth = Math.max(240, Math.min(600, newWidth));
    panel.style.flex = `0 0 ${newWidth}px`;
    panel.classList.remove("collapsed");
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const finalWidth = panel.getBoundingClientRect().width;
    localStorage.setItem("mnexus.sidepanel.width", String(Math.round(finalWidth)));
    localStorage.setItem("mnexus.sidepanel.collapsed", "0");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  splitter.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    splitter.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });

  // Touch support
  splitter.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    dragging = true;
    startX = touch.clientX;
    startWidth = panel.getBoundingClientRect().width;
    splitter.classList.add("dragging");
    const onTouchMove = (ev) => {
      if (!dragging) return;
      const t = ev.touches[0];
      const dx = t.clientX - startX;
      let newWidth = startWidth - dx;
      newWidth = Math.max(240, Math.min(600, newWidth));
      panel.style.flex = `0 0 ${newWidth}px`;
      panel.classList.remove("collapsed");
    };
    const onTouchEnd = () => {
      dragging = false;
      splitter.classList.remove("dragging");
      const finalWidth = panel.getBoundingClientRect().width;
      localStorage.setItem("mnexus.sidepanel.width", String(Math.round(finalWidth)));
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Collapse button toggles
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      const wasCollapsed = panel.classList.toggle("collapsed");
      localStorage.setItem("mnexus.sidepanel.collapsed", wasCollapsed ? "1" : "0");
      if (wasCollapsed) {
        collapseBtn.textContent = i18n.t("notes.expand") || "Show";
      } else {
        collapseBtn.textContent = i18n.t("notes.collapse") || "Hide";
      }
    });
    // Sync button label
    if (panel.classList.contains("collapsed")) {
      collapseBtn.textContent = i18n.t("notes.expand") || "Show";
    }
  }
}
