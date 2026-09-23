/* screens/v232.js — Insights screen (KG + Multi-board + FSRS dashboard).
 *
 * v2.32.0 — Consolidates Knowledge Graph + Multi-Board diagnostics
 * + FSRS-7 dashboard under a single "Insights" screen. Smart
 * Notifications widget lives globally (bell) and OCR is available
 * in pdf_viewer + notes screen.
 */

import { mountKgGraph } from "../widgets/kg_graph.js";
import { mountMultiBoard } from "../widgets/multi_board.js";
import { mountFsrsDashboard } from "../widgets/fsrs_dashboard.js";

export async function renderV232Screen(host) {
  host.innerHTML = `
    <section class="screen insights-screen">
      <header class="screen-header">
        <h1>💡 Insights</h1>
        <p class="screen-subtitle">Knowledge Graph · Multi-board · FSRS Dashboard.</p>
      </header>

      <nav class="insights-tabs" role="tablist" aria-label="Insights views">
        <button class="insights-tab" data-tab="kg" role="tab" aria-selected="true">
          🕸️ Graph
        </button>
        <button class="insights-tab" data-tab="mb" role="tab" aria-selected="false">
          📚 Multi-board
        </button>
        <button class="insights-tab" data-tab="fsrs" role="tab" aria-selected="false">
          📈 FSRS
        </button>
      </nav>

      <div class="insights-panels">
        <section class="insights-panel" data-panel="kg" role="tabpanel">
          <div class="kg-host" data-kg-host></div>
        </section>
        <section class="insights-panel" data-panel="mb" role="tabpanel" hidden>
          <div class="mb-host" data-mb-host></div>
        </section>
        <section class="insights-panel" data-panel="fsrs" role="tabpanel" hidden>
          <div class="fsrs-host" data-fsrs-host></div>
        </section>
      </div>
    </section>
  `;

  const kgHost = host.querySelector("[data-kg-host]");
  const mbHost = host.querySelector("[data-mb-host]");
  const fsrsHost = host.querySelector("[data-fsrs-host]");
  const tabs = host.querySelectorAll(".insights-tab");
  const panels = host.querySelectorAll(".insights-panel");

  // Mount all (they fetch data lazily on first paint)
  mountKgGraph(kgHost);
  mountMultiBoard(mbHost);
  // FSRS dashboard expects { fetchCards } option; default to empty list.
  mountFsrsDashboard(fsrsHost, { fetchCards: async () => [] });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === target)));
      panels.forEach((p) => p.hidden = p.dataset.panel !== target);
    });
  });
}
