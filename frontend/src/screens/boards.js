/* screens/boards.js — Multi-board SR screen. */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

export async function renderBoardsScreen(host) {
  host.innerHTML = `
    <section class="screen boards-screen">
      <header class="screen-header">
        <h1>📚 Multi-board Spaced Repetition</h1>
        <p class="screen-subtitle">Decks paralelos con diagnósticos cruzados.</p>
        <div class="boards-actions">
          <button class="primary" data-action="create" type="button">＋ Nuevo board</button>
          <button data-action="diagnose" type="button">🔍 Diagnosticar cross-board</button>
        </div>
      </header>

      <div class="boards-list" data-list role="region" aria-label="Boards"></div>

      <section class="boards-recommendations" data-recs hidden>
        <h2>📌 Recomendaciones cross-board</h2>
        <ul data-recs-list></ul>
      </section>
    </section>
  `;

  const list = host.querySelector("[data-list]");
  const recs = host.querySelector("[data-recs]");
  const recsList = host.querySelector("[data-recs-list]");

  host.querySelector('[data-action="create"]').addEventListener("click", () => {
    const name = prompt("Nombre del board:");
    if (!name) return;
    const subject = prompt("Subject (e.g. anatomy, math, biology):") || "general";
    const color = pickRandomColor();
    createBoard({ name, subject, color });
  });

  host.querySelector('[data-action="diagnose"]').addEventListener("click", diagnose);

  async function refresh() {
    try {
      const r = await fetch(`${BASE}/api/v1/boards`);
      const j = await r.json();
      const boards = j.boards ?? [];
      renderBoards(boards);
      return boards;
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
      return [];
    }
  }

  function renderBoards(boards) {
    list.innerHTML = "";
    if (boards.length === 0) {
      list.innerHTML = `<p class="boards-empty">No hay boards todavía. Crea el primero.</p>`;
      return;
    }
    for (const b of boards) {
      const card = document.createElement("article");
      card.className = "board-card";
      card.style.setProperty("--board-color", b.color);
      card.dataset.boardId = b.id;
      card.innerHTML = `
        <header class="board-card-header">
          <span class="board-icon">${escapeHtml(b.icon || "📚")}</span>
          <div>
            <h3>${escapeHtml(b.name)}</h3>
            <p class="board-subject">${escapeHtml(b.subject)}</p>
          </div>
          <button class="board-delete" data-action="delete" type="button" aria-label="Eliminar board">🗑</button>
        </header>
        <p class="board-meta">ID: <code>${escapeHtml(b.id)}</code></p>
        <p class="board-meta">Creado: ${formatDate(b.createdAt)}</p>
      `;
      card.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar el board "${b.name}"?`)) return;
        await fetch(`${BASE}/api/v1/boards/${encodeURIComponent(b.id)}`, { method: "DELETE" });
        refresh();
      });
      list.appendChild(card);
    }
  }

  async function createBoard(payload) {
    try {
      const r = await fetch(`${BASE}/api/v1/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      refresh();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  }

  async function diagnose() {
    try {
      showToast("🔍 Escaneando cross-board…");
      const r = await fetch(`${BASE}/api/v1/boards/diagnose`, { method: "POST" });
      const j = await r.json();
      const dupes = j.stats.duplicatePairs;
      const complements = j.stats.complementPairs;
      showToast(`✅ ${dupes} duplicados · ${complements} complements`);
      const recsR = await fetch(`${BASE}/api/v1/boards/recommendations`);
      const recsJ = await recsR.json();
      const recsData = recsJ.recommendations ?? [];
      if (recsData.length > 0) {
        recs.hidden = false;
        recsList.innerHTML = "";
        for (const rec of recsData) {
          const li = document.createElement("li");
          li.className = "rec-item";
          li.innerHTML = `
            <strong>${escapeHtml(rec.fromBoard.icon)} ${escapeHtml(rec.fromBoard.name)} → ${escapeHtml(rec.toBoard.icon)} ${escapeHtml(rec.toBoard.name)}</strong>
            <p>${escapeHtml(rec.reason)}</p>
          `;
          recsList.appendChild(li);
        }
      } else {
        recs.hidden = true;
      }
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  }

  await refresh();
}

const COLORS = ["#667eea", "#764ba2", "#f093fb", "#4facfe", "#43e97b", "#fa709a", "#fee140"];
function pickRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".notif-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "notif-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("notif-toast--error", isError);
  t.textContent = msg;
  t.classList.add("notif-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("notif-toast--show"), 2500);
}
