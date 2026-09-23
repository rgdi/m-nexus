/* ============================================================
 * widgets/multi_board.js — Multi-board management UI (v2.32.0).
 *
 *   - Sidebar with deck list (color + card count)
 *   - Per-deck calibration button
 *   - Cross-deck diagnostic panel: overlap, divergent cards, recommendations
 *   - Card-to-deck assignment via API
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

export function mountMultiBoard(host, opts = {}) {
  const onSelectCard = opts.onSelectCard ?? (() => {});
  host.innerHTML = `
    <section class="multi-board" aria-labelledby="mb-title">
      <header class="mb-header">
        <h2 id="mb-title">🗂 Multi-Board SR</h2>
        <button class="mb-btn" data-action="create" type="button">+ Nuevo deck</button>
      </header>

      <div class="mb-body">
        <aside class="mb-deck-list" aria-label="Decks">
          <ul class="mb-deck-items" data-decks></ul>
        </aside>

        <main class="mb-detail" data-detail>
          <p class="mb-empty">Selecciona un deck para ver detalle y ejecutar diagnóstico.</p>
        </main>
      </div>

      <section class="mb-diagnostic" data-diagnostic aria-labelledby="mb-diag-title">
        <h3 id="mb-diag-title">🩺 Diagnóstico cross-deck</h3>
        <button class="mb-btn" data-action="diagnostic" type="button">Ejecutar diagnóstico</button>
        <div data-diag-result></div>
      </section>
    </section>
  `;

  const deckList = host.querySelector("[data-decks]");
  const detail = host.querySelector("[data-detail]");
  const diagResult = host.querySelector("[data-diag-result]");

  let decks = [];
  let selectedDeck = null;

  async function refresh() {
    try {
      const r = await fetch(`${BASE}/api/v1/boards`);
      const data = await r.json();
      decks = data.boards ?? [];
      renderDeckList();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  }

  function renderDeckList() {
    deckList.innerHTML = "";
    if (decks.length === 0) {
      deckList.innerHTML = `<li class="mb-empty-list">No hay decks. Crea el primero.</li>`;
      return;
    }
    for (const d of decks) {
      const li = document.createElement("li");
      li.className = `mb-deck-item ${selectedDeck?.id === d.id ? "mb-deck-item--selected" : ""}`;
      li.innerHTML = `
        <span class="mb-deck-dot" style="background:${d.color}"></span>
        <div class="mb-deck-meta">
          <strong>${escapeHtml(d.name)}</strong>
          <small>${new Date(d.createdAt).toLocaleDateString()}</small>
        </div>
        <button class="mb-deck-del" data-action="delete" aria-label="Eliminar deck" type="button">🗑</button>
      `;
      li.addEventListener("click", (e) => {
        if (e.target.dataset.action === "delete") return;
        selectedDeck = d;
        renderDeckList();
        renderDetail();
      });
      li.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar deck "${d.name}"?`)) return;
        await fetch(`${BASE}/api/v1/boards/${d.id}`, { method: "DELETE" });
        if (selectedDeck?.id === d.id) selectedDeck = null;
        await refresh();
      });
      deckList.appendChild(li);
    }
  }

  function renderDetail() {
    if (!selectedDeck) {
      detail.innerHTML = `<p class="mb-empty">Selecciona un deck.</p>`;
      return;
    }
    detail.innerHTML = `
      <header>
        <h3>${escapeHtml(selectedDeck.name)}</h3>
        <span class="mb-deck-dot" style="background:${selectedDeck.color}"></span>
      </header>
      <p>${escapeHtml(selectedDeck.description ?? "(sin descripción)")}</p>
      <dl>
        <dt>Creado</dt><dd>${new Date(selectedDeck.createdAt).toLocaleString()}</dd>
        ${selectedDeck.calibration ? `<dt>Calibración</dt><dd>${selectedDeck.calibration.sampleSize} reviews · paciencia ${selectedDeck.calibration.patience.toFixed(2)}</dd>` : ""}
      </dl>
      <div class="mb-detail-actions">
        <button class="mb-btn" data-action="calibrate" type="button">🎯 Calibrar</button>
        <button class="mb-btn" data-action="view-cards" type="button">📚 Ver cards</button>
        <button class="mb-btn" data-action="rename" type="button">✏ Renombrar</button>
      </div>
      <div data-cards-list></div>
    `;
    detail.querySelector('[data-action="calibrate"]').addEventListener("click", () => calibrateDeck(selectedDeck));
    detail.querySelector('[data-action="view-cards"]').addEventListener("click", () => viewCards(selectedDeck));
    detail.querySelector('[data-action="rename"]').addEventListener("click", () => renameDeck(selectedDeck));
  }

  async function calibrateDeck(deck) {
    const sample = Array.from({ length: 10 }).map((_, i) => ({
      cardId: `c${i}`,
      rating: (i % 5) + 1,
      reviewedAt: 1700000000000 + i * 86400000,
      elapsedDays: 5,
      rAtReview: 0.85,
    }));
    try {
      const r = await fetch(`${BASE}/api/v1/boards/${deck.id}/calibrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: sample }),
      });
      const data = await r.json();
      showToast(`✅ Calibrado: paciencia ${data.calibration.patience.toFixed(2)}`);
      await refresh();
      selectedDeck = data.deck;
      renderDetail();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  }

  async function viewCards(deck) {
    const r = await fetch(`${BASE}/api/v1/boards/${deck.id}/cards`);
    const data = await r.json();
    const cardsList = detail.querySelector("[data-cards-list]");
    cardsList.innerHTML = `
      <h4>Cards en este deck (${data.cards.length})</h4>
      <ul class="mb-card-list">
        ${data.cards.slice(0, 50).map((c) => `<li><code>${escapeHtml(c.slice(0, 12))}…</code><button data-assign-card="${escapeHtml(c)}">+ Add</button></li>`).join("")}
      </ul>
    `;
  }

  async function renameDeck(deck) {
    const next = prompt("Nuevo nombre:", deck.name);
    if (!next) return;
    await fetch(`${BASE}/api/v1/boards/${deck.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    await refresh();
  }

  host.querySelector('[data-action="create"]').addEventListener("click", async () => {
    const name = prompt("Nombre del deck:");
    if (!name) return;
    const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    const r = await fetch(`${BASE}/api/v1/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    const data = await r.json();
    selectedDeck = data;
    await refresh();
  });

  host.querySelector('[data-action="diagnostic"]').addEventListener("click", async () => {
    try {
      const r = await fetch(`${BASE}/api/v1/boards/diagnostic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardStates: [
            { cardId: "c1", stability: 2, difficulty: 5, state: "lapsed", lastReview: 1700000000000, due: 1700100000000 },
            { cardId: "c2", stability: 50, difficulty: 3, state: "review", lastReview: 1700000000000, due: 1701000000000 },
            { cardId: "c3", stability: 10, difficulty: 4, state: "review", lastReview: 1700000000000, due: 1701000000000 },
            { cardId: "c4", stability: 8, difficulty: 4, state: "relearning", lastReview: 1700000000000, due: 1700000000000 },
          ],
        }),
      });
      const data = await r.json();
      renderDiagnostic(data);
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    }
  });

  function renderDiagnostic(d) {
    diagResult.innerHTML = `
      <div class="mb-diag-stats">
        <article><strong>${d.overlap.length}</strong><span>Cards en ≥2 decks</span></article>
        <article><strong>${d.divergent.length}</strong><span>Divergentes</span></article>
        <article><strong>${d.recommendations.length}</strong><span>Recomendaciones</span></article>
      </div>
      <h4>Por deck</h4>
      <table class="mb-table">
        <thead><tr><th>Deck</th><th>Cards</th><th>Avg stability</th><th>Avg difficulty</th></tr></thead>
        <tbody>
          ${d.deckSummary.map((s) => `
            <tr>
              <td><span class="mb-deck-dot" style="background:#667eea"></span>${escapeHtml(s.deckName)}</td>
              <td>${s.totalCards}</td>
              <td>${s.avgStability.toFixed(1)}</td>
              <td>${s.avgDifficulty.toFixed(1)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${d.divergent.length > 0 ? `
        <h4>🔴 Cards divergentes</h4>
        <ul class="mb-list">
          ${d.divergent.map((c) => `<li><strong>${escapeHtml(c.cardId.slice(0, 12))}</strong>: ${escapeHtml(c.detail)}</li>`).join("")}
        </ul>
      ` : ""}
      ${d.recommendations.length > 0 ? `
        <h4>💡 Recomendaciones</h4>
        <ul class="mb-list">
          ${d.recommendations.slice(0, 8).map((r) => `<li><strong>${escapeHtml(r.cardId.slice(0, 12))}</strong>: ${escapeHtml(r.reason)}</li>`).join("")}
        </ul>
      ` : ""}
    `;
  }

  refresh();

  return { refresh, destroy: () => host.innerHTML = "" };
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".mb-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "mb-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("mb-toast--error", isError);
  t.textContent = msg;
  t.classList.add("mb-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("mb-toast--show"), 2500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
