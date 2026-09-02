// StatusBar: barra compacta al final del panel del plugin que muestra
// el estado de cada subsistema en tiempo real. Refresca cada 30s.

import { DashboardData } from "../plugin-api";

export function renderStatusBar(parent: HTMLElement, data: DashboardData): HTMLElement {
  const bar = parent.createDiv({ cls: "mnexus-statusbar" });
  bar.style.cssText = "margin-top:12px;padding:8px;background:var(--background-secondary);border-radius:6px;font-size:0.75em;display:flex;flex-wrap:wrap;gap:8px;";
  const item = (label: string, ok: boolean, hint: string) => {
    const span = bar.createSpan({ cls: "mnexus-status-item" });
    span.title = hint;
    span.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;background:${ok ? "rgba(63,185,80,0.1)" : "rgba(248,81,73,0.1)"};color:${ok ? "var(--text-success, #3fb950)" : "var(--text-error, #f85149)"};cursor:help;`;
    span.textContent = `${ok ? "✔" : "✖"} ${label}`;
    return span;
  };
  item("Whisper", data.whisperInstalled, "Transcripción local");
  item("LLM", data.llmStatus.configured, `${data.llmStatus.provider}${data.llmStatus.model ? " · " + data.llmStatus.model : ""}`);
  item("RAG", data.ragChunks > 0, `${data.ragChunks} chunks indexados`);
  item("ICS", data.calendarEnabled, "Calendar ICS sync");
  item("Google", data.googleCalendarAuthorized, "Google Calendar OAuth");
  if (data.syncStatus) {
    const synced = !data.syncStatus.error;
    item("Sync", synced, data.syncStatus.error ?? `Último: ${data.syncStatus.lastSync ? new Date(data.syncStatus.lastSync).toLocaleString() : "nunca"}`);
  }
  return bar;
}
