/* ============================================================
 * approvals.js — AI generation approval queue (v2.8.0).
 *
 * Shows pending AI-suggested cards (clozes, flashcards, occlusions,
 * image occlusion masks). User must approve each before they become
 * real study material. Prevents hallucinated content polluting the deck.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";

export async function renderApprovals(root) {
  root.innerHTML = `
    <div class="screen approvals-screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="Back">←</button>
        <h1 class="h-title">${i18n.t("approvals.title") || "AI approvals"}</h1>
        <span class="h-sub">${i18n.t("approvals.subtitle") || "Review and approve AI-suggested cards"}</span>
      </header>
      <div id="approvals-list"></div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());

  const list = root.querySelector("#approvals-list");
  list.innerHTML = `<div class="muted">${i18n.t("common.loading") || "Loading…"}</div>`;

  try {
    const r = await api.study.pendingCandidates();
    const items = r.candidates || [];
    if (items.length === 0) {
      list.innerHTML = `<div class="empty"><div class="em-title">${i18n.t("approvals.empty") || "No pending candidates"}</div><p class="muted">${i18n.t("approvals.emptySub") || "Generate flashcards with AI to see suggestions here."}</p></div>`;
      return;
    }
    list.innerHTML = items.map((c) => `
      <div class="approval-card" data-id="${escapeHtml(c.id)}">
        <div class="approval-card-header">
          <span class="approval-kind">${escapeHtml(c.kind)}</span>
          <span class="approval-confidence">${(c.confidence * 100).toFixed(0)}% conf</span>
        </div>
        <div class="approval-front">${escapeHtml(c.preview)}</div>
        <div class="approval-back muted">${escapeHtml(c.answer)}</div>
        <div class="approval-actions">
          <button class="btn primary small" data-act="approve">${i18n.t("approvals.approve") || "Approve"}</button>
          <button class="btn small" data-act="reject">${i18n.t("approvals.reject") || "Reject"}</button>
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".approval-card").forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-act="approve"]').addEventListener("click", () => decide(id, "approved", card));
      card.querySelector('[data-act="reject"]').addEventListener("click", () => decide(id, "rejected", card));
    });
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="em-title">Error</div><pre>${escapeHtml(e.message)}</pre></div>`;
  }
}

async function decide(id, status, cardEl) {
  try {
    await api.study.decideCandidate(id, status);
    cardEl.classList.add("fading");
    setTimeout(() => {
      cardEl.style.transform = "translateX(-20px)";
      cardEl.style.opacity = "0";
      setTimeout(() => cardEl.remove(), 300);
    }, 100);
  } catch (e) {
    alert("Error: " + e.message);
  }
}
