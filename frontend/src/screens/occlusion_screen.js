/* ============================================================
 * occlusion_screen.js — Image occlusion UI (v2.9.0).
 *
 * Lets user upload an image, draw masks, save + queue for approval.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";
import { openImageOcclusionEditor, openImageOcclusionFromFile } from "../widgets/image_occlusion.js";

export async function renderOcclusionScreen(root) {
  root.innerHTML = `
    <div class="screen occlusion-screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="Back">←</button>
        <h1 class="h-title">${i18n.t("occlusion.title") || "Image Occlusion"}</h1>
        <span class="h-sub">${i18n.t("occlusion.subtitle") || "Mask anatomy structures and study them"}</span>
      </header>

      <div class="card occlusion-upload">
        <h2>${i18n.t("occlusion.newCard") || "Create new occlusion card"}</h2>
        <div class="sim-row">
          <label>${i18n.t("occlusion.topic") || "Topic"}</label>
          <input class="input" id="topic" placeholder="humerus" value="general" />
        </div>
        <div class="occlusion-source">
          <label class="occlusion-source-option">
            <input type="radio" name="src" value="upload" checked />
            <span>${i18n.t("occlusion.upload") || "Upload image"}</span>
          </label>
          <label class="occlusion-source-option">
            <input type="radio" name="src" value="url" />
            <span>${i18n.t("occlusion.url") || "Use URL"}</span>
          </label>
        </div>
        <input class="input" id="src-url" type="url" placeholder="https://..." style="display:none;" />
        <input class="input" type="file" id="src-file" accept="image/*" />
        <button class="btn primary" id="start">${i18n.t("occlusion.start") || "Start editing →"}</button>
      </div>

      <div class="card">
        <h2>${i18n.t("occlusion.existing") || "Existing occlusion cards"}</h2>
        <div id="occ-list"></div>
      </div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());

  // Toggle source inputs
  root.querySelectorAll('input[name="src"]').forEach((r) => {
    r.addEventListener("change", () => {
      const isUrl = root.querySelector('input[name="src"]:checked').value === "url";
      root.querySelector("#src-url").style.display = isUrl ? "" : "none";
      root.querySelector("#src-file").style.display = isUrl ? "none" : "";
    });
  });

  // Start editing
  root.querySelector("#start").addEventListener("click", async () => {
    const topic = root.querySelector("#topic").value.trim() || "general";
    const isUrl = root.querySelector('input[name="src"]:checked').value === "url";
    if (isUrl) {
      const url = root.querySelector("#src-url").value.trim();
      if (!url) {
        alert(i18n.t("occlusion.urlRequired") || "Image URL required");
        return;
      }
      await openImageOcclusionEditor({ imageUrl: url, topicId: topic });
    } else {
      const file = root.querySelector("#src-file").files[0];
      if (!file) {
        alert(i18n.t("occlusion.fileRequired") || "Pick an image first");
        return;
      }
      await openImageOcclusionFromFile(file, { topicId: topic });
    }
    await loadList();
  });

  await loadList();
  async function loadList() {
    const list = root.querySelector("#occ-list");
    list.innerHTML = `<div class="muted">${i18n.t("common.loading") || "Loading…"}</div>`;
    try {
      const r = await api.occlusion.listCards();
      const cards = r.cards || [];
      if (cards.length === 0) {
        list.innerHTML = `<div class="muted">${i18n.t("occlusion.none") || "No occlusion cards yet."}</div>`;
        return;
      }
      list.innerHTML = cards.map((c) => `
        <div class="occ-row">
          <div class="occ-row-info">
            <strong>${escapeHtml(c.topicId)}</strong>
            <span class="muted">${c.masks.length} mask${c.masks.length === 1 ? "" : "s"}</span>
          </div>
          <div class="occ-row-actions">
            <button class="btn small" data-act="preview" data-id="${escapeHtml(c.id)}">${i18n.t("common.preview") || "Preview"}</button>
          </div>
        </div>
      `).join("");
      list.querySelectorAll('[data-act="preview"]').forEach((btn) => {
        btn.addEventListener("click", () => previewCard(cards.find((c) => c.id === btn.dataset.id)));
      });
    } catch (e) {
      list.innerHTML = `<div class="muted">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function previewCard(card) {
    const src = card.imageUrl || card.imageBase64;
    if (!src) return;
    // Hide all masks → user must recall what's underneath
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:260;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px;";
    const labels = card.masks.map((m) => escapeHtml(m.label || "?")).join(" · ");
    overlay.innerHTML = `
      <div style="position:relative;display:inline-block;">
        <img src="${escapeHtml(src)}" style="max-width:80vw;max-height:70vh;display:block;" />
        ${card.masks.map((m) => `<div style="position:absolute;left:${m.x * 100}%;top:${m.y * 100}%;width:${m.width * 100}%;height:${m.height * 100}%;background:#ef4444;border-radius:4px;cursor:pointer;" data-mask="${escapeHtml(m.label || '')}" title="Click to reveal"></div>`).join("")}
      </div>
      <div style="color:white;font-size:14px;">${labels}</div>
      <button class="btn primary" id="occ-close">Close</button>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll("[data-mask]").forEach((el) => {
      el.addEventListener("click", () => {
        el.style.background = "rgba(34,197,94,0.5)";
        el.style.border = "2px solid #22c55e";
        el.textContent = el.dataset.mask;
        el.style.color = "white";
        el.style.fontWeight = "bold";
        el.style.padding = "4px";
      });
    });
    overlay.querySelector("#occ-close").addEventListener("click", () => overlay.remove());
  }
}
