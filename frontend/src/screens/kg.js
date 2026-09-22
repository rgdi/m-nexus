/* screens/kg.js — Knowledge Graph screen. */

import { mountKgGraph } from "../widgets/kg_graph.js";

export async function renderKgScreen(host) {
  host.innerHTML = `
    <section class="screen kg-screen">
      <div class="kg-host" data-kg-host></div>
    </section>
  `;
  const inner = host.querySelector("[data-kg-host]");
  mountKgGraph(inner);
}
