/* ============================================================
 * widgets/ocr_recognize.js — OCR + handwriting recognition UI (v2.32.0).
 *
 *   - Drag/drop image OR pick PDF page screenshot
 *   - Calls /api/v1/ocr/recognize (Tesseract → Vision LLM fallback)
 *   - Optional handwritten-region detection
 *   - Result panel with confidence badge + region list
 *   - "Save as atomic card" button → calls /recognize-highlight
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

export function openOcrRecognize(opts = {}) {
  const onCard = opts.onCard ?? (() => {});
  const host = opts.host ?? document.body;
  const modal = document.createElement("div");
  modal.className = "ocr-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Reconocer texto de una imagen o página");
  modal.innerHTML = `
    <div class="ocr-modal-card">
      <header class="ocr-header">
        <h2>🔍 OCR + Handwriting</h2>
        <button class="ocr-close" type="button" aria-label="Cerrar">×</button>
      </header>

      <section class="ocr-input-section">
        <div class="ocr-drop" data-drop role="region" aria-label="Zona de drop">
          <p>Arrastra una imagen aquí o</p>
          <input type="file" accept="image/*" data-file hidden>
          <button class="ocr-btn-primary" data-pick type="button">📁 Elegir imagen</button>
          <p class="ocr-small">PNG, JPG. Tesseract + Vision LLM fallback.</p>
        </div>
        <div class="ocr-options">
          <label>
            <span>Idiomas:</span>
            <select data-langs>
              <option value="spa+eng">Español + Inglés</option>
              <option value="spa">Solo Español</option>
              <option value="eng">Solo Inglés</option>
              <option value="lat">Latín</option>
            </select>
          </label>
          <label>
            <input type="checkbox" data-detect-hw>
            <span>Detectar regiones manuscritas</span>
          </label>
          <label>
            <span>Min confidence:</span>
            <input type="range" min="0.3" max="0.95" step="0.05" value="0.65" data-conf>
            <output data-conf-out>0.65</output>
          </label>
        </div>
      </section>

      <section class="ocr-result-section" data-result hidden>
        <h3>Resultado</h3>
        <div class="ocr-meta" data-meta></div>
        <pre class="ocr-text" data-text></pre>
        <details class="ocr-regions" data-regions-details hidden>
          <summary>Regiones detectadas (<span data-region-count>0</span>)</summary>
          <ol class="ocr-region-list" data-region-list></ol>
        </details>
        <details class="ocr-hw" data-hw-details hidden>
          <summary>Regiones manuscritas (<span data-hw-count>0</span>)</summary>
          <ol class="ocr-hw-list" data-hw-list></ol>
        </details>
        <div class="ocr-actions">
          <button data-action="save-card" type="button" class="ocr-btn-primary">💾 Guardar como flashcard</button>
          <button data-action="copy" type="button">📋 Copiar texto</button>
        </div>
      </section>
    </div>
  `;
  host.appendChild(modal);

  const drop = modal.querySelector("[data-drop]");
  const fileInput = modal.querySelector("[data-file]");
  const pickBtn = modal.querySelector("[data-pick]");
  const langs = modal.querySelector("[data-langs]");
  const detectHw = modal.querySelector("[data-detect-hw]");
  const confInput = modal.querySelector("[data-conf]");
  const confOut = modal.querySelector("[data-conf-out]");
  const resultSection = modal.querySelector("[data-result]");
  const metaEl = modal.querySelector("[data-meta]");
  const textEl = modal.querySelector("[data-text]");
  const regionList = modal.querySelector("[data-region-list]");
  const regionCount = modal.querySelector("[data-region-count]");
  const regionsDetails = modal.querySelector("[data-regions-details]");
  const hwList = modal.querySelector("[data-hw-list]");
  const hwCount = modal.querySelector("[data-hw-count]");
  const hwDetails = modal.querySelector("[data-hw-details]");

  confInput.addEventListener("input", () => { confOut.textContent = confInput.value; });

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
  });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("ocr-drop--active"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("ocr-drop--active"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("ocr-drop--active");
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });

  modal.querySelector(".ocr-close").addEventListener("click", () => modal.remove());

  let lastResult = null;
  async function handleFile(file) {
    drop.classList.add("ocr-loading");
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const r = await fetch(`${BASE}/api/v1/ocr/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: b64,
          languages: langs.value,
          minConfidence: parseFloat(confInput.value),
          detectHandwriting: detectHw.checked,
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      lastResult = data;
      renderResult(data);
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    } finally {
      drop.classList.remove("ocr-loading");
    }
  }

  function renderResult(data) {
    const ocr = data.ocr;
    if (!ocr) return;
    resultSection.hidden = false;
    metaEl.innerHTML = `
      <span class="ocr-badge ocr-badge--${ocr.strategy}">${ocr.strategy}</span>
      <span>Confianza: <strong>${(ocr.confidence * 100).toFixed(0)}%</strong></span>
      <span>${ocr.durationMs}ms</span>
      ${ocr.cached ? '<span class="ocr-badge">📦 cached</span>' : ''}
    `;
    textEl.textContent = ocr.text || "(sin texto detectado)";

    if (ocr.regions && ocr.regions.length > 0) {
      regionsDetails.hidden = false;
      regionCount.textContent = String(ocr.regions.length);
      regionList.innerHTML = ocr.regions.slice(0, 30).map((r) => `
        <li>
          <code>${escapeHtml(r.text)}</code>
          <small>conf ${(r.confidence * 100).toFixed(0)}% · ${r.type} · [${r.bbox.x},${r.bbox.y},${r.bbox.w},${r.bbox.h}]</small>
        </li>
      `).join("");
    } else {
      regionsDetails.hidden = true;
    }

    if (data.handwrittenRegions && data.handwrittenRegions.length > 0) {
      hwDetails.hidden = false;
      hwCount.textContent = String(data.handwrittenRegions.length);
      hwList.innerHTML = data.handwrittenRegions.map((r) => `
        <li>
          <small>[${r.x},${r.y},${r.w},${r.h}] · conf ${(r.confidence * 100).toFixed(0)}%</small>
        </li>
      `).join("");
    } else {
      hwDetails.hidden = true;
    }
  }

  modal.querySelector('[data-action="copy"]').addEventListener("click", () => {
    if (lastResult?.ocr?.text) {
      navigator.clipboard.writeText(lastResult.ocr.text);
      showToast("📋 Texto copiado");
    }
  });

  modal.querySelector('[data-action="save-card"]').addEventListener("click", async () => {
    if (!lastResult?.ocr?.text) return;
    const text = lastResult.ocr.text;
    const front = `📝 Texto OCR\n\n¿Qué dice este fragmento?`;
    const back = text;
    onCard({ front, back, cardType: "basic", source: "ocr" });
    showToast(`💾 Card guardada: ${text.slice(0, 40)}...`);
    modal.remove();
  });

  return { modal, close: () => modal.remove() };
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".ocr-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "ocr-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("ocr-toast--error", isError);
  t.textContent = msg;
  t.classList.add("ocr-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("ocr-toast--show"), 2500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
