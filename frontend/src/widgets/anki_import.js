/* ============================================================
 * widgets/anki_import.js — Anki .apkg import wizard.
 *
 * v2.27.0 — wizard 3 pasos:
 *   1. File picker (drag-drop o click)
 *   2. Preview stats (cards por tipo, deck breakdown, FSRS history)
 *   3. Confirmar commit → persiste a flashcards.json
 *
 * También expone exportApkg que pide scope + descarga el .apkg.
 * ============================================================ */

import { makeModal } from "./modal.js";

const API = "/api/v1/anki";

export async function openAnkiImport(onDone = () => {}) {
  let selectedFile = null;
  let preview = null;

  const modal = makeModal({
    title: "Importar deck de Anki (.apkg)",
    body: `
      <div class="anki-wizard" role="region" aria-label="Wizard de importación">
        <ol class="anki-steps" role="tablist">
          <li class="anki-step" data-step="1">1. Archivo</li>
          <li class="anki-step" data-step="2">2. Vista previa</li>
          <li class="anki-step" data-step="3">3. Confirmar</li>
        </ol>

        <section class="anki-panel" data-panel="1">
          <div class="anki-drop" tabindex="0" role="button" aria-label="Subir archivo .apkg">
            <p class="anki-drop-title">Arrastra tu archivo aquí</p>
            <p class="anki-drop-sub">o haz click para seleccionarlo (.apkg)</p>
            <input type="file" accept=".apkg" hidden data-role="file-input"/>
          </div>
          <p class="muted small" data-role="filename">Sin archivo seleccionado.</p>
        </section>

        <section class="anki-panel" data-panel="2" hidden>
          <h4 class="muted small">Resumen del deck</h4>
          <div data-role="preview-stats"></div>
        </section>

        <section class="anki-panel" data-panel="3" hidden>
          <p>Vas a importar <strong data-role="commit-count">0</strong> tarjetas a M-NEXUS.</p>
          <p class="muted small">Se preserva el historial FSRS-6 (reps, lapses, interval).</p>
          <label class="checkbox-row">
            <input type="checkbox" data-role="include-history" checked/>
            Mantener progreso (FSRS state)
          </label>
        </section>

        <div class="anki-error" data-role="error" hidden></div>
      </div>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", value: false },
      { label: "Siguiente", kind: "primary", value: "next" },
    ],
  });
  document.body.appendChild(modal.root);

  const input = modal.root.querySelector('[data-role="file-input"]');
  const drop = modal.root.querySelector(".anki-drop");
  const fileNameEl = modal.root.querySelector('[data-role="filename"]');
  const errorEl = modal.root.querySelector('[data-role="error"]');
  const previewStatsEl = modal.root.querySelector('[data-role="preview-stats"]');
  const commitCountEl = modal.root.querySelector('[data-role="commit-count"]');

  function showPanel(n) {
    modal.root.querySelectorAll(".anki-panel").forEach((p) => (p.hidden = p.dataset.panel !== String(n)));
    modal.root.querySelectorAll(".anki-step").forEach((s) => s.classList.toggle("active", s.dataset.step === String(n)));
  }

  function setError(msg) {
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    } else {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    }
  }

  // File picker
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  input.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });

  function handleFile(f) {
    setError(null);
    if (!/\.apkg$/i.test(f.name)) {
      setError(`"${f.name}" no es .apkg. Selecciona un archivo .apkg.`);
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError(`Archivo demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB > 50 MB).`);
      return;
    }
    selectedFile = f;
    fileNameEl.textContent = `📦 ${f.name} · ${(f.size / 1024).toFixed(1)} KB`;
    showPanel(2);
    runPreview(f);
  }

  async function runPreview(f) {
    setError(null);
    previewStatsEl.innerHTML = `<p class="muted small">Analizando…</p>`;
    try {
      const fd = new FormData();
      fd.append("apkg", f);
      const r = await fetch(`${API}/import`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed");
      preview = d;
      renderPreviewStats(d);
    } catch (e) {
      setError(`No se pudo parsear: ${e.message}`);
      previewStatsEl.innerHTML = "";
    }
  }

  function renderPreviewStats(d) {
    const s = d.stats;
    const typesHtml = Object.entries(s.byType)
      .map(([k, v]) => `<span class="badge">${k}: ${v}</span>`)
      .join("");
    const decksHtml = Object.entries(s.byDeck)
      .map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong> <span class="muted small">(${v} tarjetas)</span></li>`)
      .join("");
    previewStatsEl.innerHTML = `
      <div class="anki-stat-row">
        <div class="anki-stat"><span class="num">${s.total}</span><span>Tarjetas</span></div>
        <div class="anki-stat"><span class="num">${s.withFsrsHistory}</span><span>Con progreso</span></div>
        <div class="anki-stat"><span class="num">${Object.keys(s.byDeck).length}</span><span>Mazos</span></div>
      </div>
      <p class="muted small">Tipos: ${typesHtml || "—"}</p>
      <details>
        <summary>Mazos encontrados</summary>
        <ul>${decksHtml}</ul>
      </details>
    `;
    commitCountEl.textContent = s.total;
  }

  // Listen to actions
  modal.root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "1") {
      modal.close(false);
    }
  });

  // Wait for the primary "Siguiente" action button.
  const initialActionLabel = modal.root.querySelector('[data-action="1"]');
  if (initialActionLabel) initialActionLabel.textContent = "Siguiente";

  // Hook the only "primary" action button via observer
  const observer = new MutationObserver(() => {});
  // Just resolve when modal closes with the chosen action value.
  modal.close = wrapClose(modal, async () => {
    const includeHistory = modal.root.querySelector('[data-role="include-history"]')?.checked ?? true;
    const stripHistory = !includeHistory;
    if (!preview) return;
    const cards = preview.cards.map((c) => {
      if (stripHistory) {
        return { ...c, fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 } };
      }
      return c;
    });
    const r = await fetch(`${API}/import/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error || "Commit failed");
    onDone(d);
  });
}

function wrapClose(modal, onCommit) {
  const orig = modal.close.bind(modal);
  return async function (value) {
    if (value === "next") {
      const panel1 = modal.root.querySelector('[data-panel="1"]');
      const panel2 = modal.root.querySelector('[data-panel="2"]');
      const panel3 = modal.root.querySelector('[data-panel="3"]');
      const visible = !panel1.hidden ? 1 : !panel2.hidden ? 2 : !panel3.hidden ? 3 : 3;
      if (visible === 2) {
        // Move to 3 only if preview is loaded.
        if (modal.root.querySelector('[data-role="preview-stats"]').innerHTML.includes("muted small")) {
          // no preview loaded yet — wait
          return;
        }
        modal.root.querySelectorAll(".anki-panel").forEach((p) => (p.hidden = p.dataset.panel !== "3"));
        modal.root.querySelectorAll(".anki-step").forEach((s) => s.classList.toggle("active", s.dataset.step === "3"));
        // Update button label
        const primaryBtn = modal.root.querySelector('[data-action="1"]');
        if (primaryBtn) primaryBtn.textContent = "Importar";
        modal._commitMode = true;
        return;
      }
      if (visible === 3) {
        // Commit.
        try {
          await onCommit();
          orig(true);
        } catch (e) {
          const err = modal.root.querySelector('[data-role="error"]');
          if (err) {
            err.hidden = false;
            err.textContent = `Commit falló: ${e.message}`;
          }
        }
        return;
      }
      return;
    }
    orig(value);
  };
}

/* ============================================================
 * Export wizard
 * ============================================================ */

export async function exportMnxToAnki() {
  const modal = makeModal({
    title: "Exportar a Anki (.apkg)",
    body: `
      <p>Elige el alcance (opcionalmente filtra por subject o tag):</p>
      <label class="anki-field">
        <span>Mazo (deck) a crear</span>
        <input class="input" data-role="deck" placeholder="M-NEXUS" value="M-NEXUS"/>
      </label>
      <label class="anki-field">
        <span>Filtrar por subject (opcional)</span>
        <input class="input" data-role="subject" placeholder="ej: anat"/>
      </label>
      <label class="anki-field">
        <span>Filtrar por tag (opcional)</span>
        <input class="input" data-role="tag" placeholder="ej: review"/>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" data-role="revlog" checked/>
        Incluir historial de repasos (revlog)
      </label>
      <p class="muted small">El archivo se descargará como .apkg y puedes importarlo de vuelta a Anki.</p>
    `,
    actions: [
      { label: "Cancelar", kind: "ghost", value: false },
      { label: "Exportar", kind: "primary", value: "export" },
    ],
  });
  document.body.appendChild(modal.root);
  return new Promise((resolve) => {
    modal.root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.textContent.trim() === "Exportar" || btn.textContent.trim() === "Cancelar") {
        if (btn.textContent.trim() === "Cancelar") {
          modal.close(false);
          resolve(null);
          return;
        }
        // Export
        try {
          const deck = modal.root.querySelector('[data-role="deck"]').value || "M-NEXUS";
          const subject = modal.root.querySelector('[data-role="subject"]').value || "";
          const tag = modal.root.querySelector('[data-role="tag"]').value || "";
          const revlog = modal.root.querySelector('[data-role="revlog"]').checked;
          const r = await fetch("/api/v1/anki/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deckName: deck,
              includeRevlog: revlog,
              scope: { subject: subject || undefined, tag: tag || undefined },
            }),
          });
          const d = await r.json();
          if (!r.ok) {
            const err = (modal.root.querySelector('[data-role="error"]') || (() => {
              const x = document.createElement("p"); x.className = "anki-error"; x.style.color = "var(--bad)";
              modal.root.querySelector('.modal-body').appendChild(x); return x;
            })());
            err.textContent = d?.error || "Falló la exportación";
            return;
          }
          // Trigger download
          const bin = atob(d.apkgBytesBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: "application/zip" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = d.filename;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          modal.close(true);
          resolve(d);
        } catch (e) {
          resolve({ error: e.message });
        }
      }
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
