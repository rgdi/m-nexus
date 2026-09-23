/* screens/v232.js — Combined v2.32 features screen. */

import { openOcrRecognize } from "../widgets/ocr_recognize.js";
import { mountMultiBoard } from "../widgets/multi_board.js";
import { mountSmartNotifications } from "../widgets/smart_notifications.js";

export async function renderV232Screen(host) {
  host.innerHTML = `
    <section class="screen v232-screen">
      <header class="screen-header">
        <h1>🆕 v2.32.0 — Features</h1>
        <p class="screen-subtitle">OCR/Handwriting · Multi-board SR · Smart Notifications.</p>
      </header>

      <div class="v232-actions">
        <button class="v232-btn-primary" data-action="open-ocr" type="button">
          🔍 Abrir OCR + Handwriting
        </button>
      </div>

      <div class="v232-ocr-host" data-ocr-host></div>
      <div class="v232-mb-host" data-mb-host></div>
      <div class="v232-sn-host" data-sn-host></div>
    </section>
  `;

  const ocrHost = host.querySelector("[data-ocr-host]");
  const mbHost = host.querySelector("[data-mb-host]");
  const snHost = host.querySelector("[data-sn-host]");

  host.querySelector('[data-action="open-ocr"]').addEventListener("click", () => {
    openOcrRecognize({ host: ocrHost });
  });

  mountMultiBoard(mbHost);
  const snHandle = mountSmartNotifications(snHost);
  // Demo cards for the notifications widget
  snHandle.setCards([
    { id: "c1", stability: 2, difficulty: 5, state: "review", lastReview: 1700000000000, due: 1700100000000 },
    { id: "c2", stability: 50, difficulty: 3, state: "review", lastReview: 1700000000000, due: 1701000000000 },
    { id: "c3", stability: 0.5, difficulty: 8, state: "learning", lastReview: 1700000000000, due: 1700003600000 },
    { id: "c4", stability: 1, difficulty: 9, state: "relearning", lastReview: 1700000000000, due: 1700000000000 },
    { id: "c5", stability: 5, difficulty: 5, state: "review", lastReview: 1700000000000, due: 1700100000000 },
  ]);
}
