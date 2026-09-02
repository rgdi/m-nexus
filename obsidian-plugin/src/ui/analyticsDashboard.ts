// AnalyticsDashboard: vista HTML+SVG con todas las métricas.
// Renderiza heatmap, gauge de predicción, forecast de carga y tabla por materia.

import { App, ItemView, WorkspaceLeaf } from "obsidian";
import { computeGlobalMetrics, snapshotFromCard, FSRSCardSnapshot } from "../analytics/metrics";
import { predictAll, PredictionOutput } from "../analytics/prediction";
import { buildHeatmap, heatmapColor, ActivityEvent, HeatmapDay } from "../analytics/heatmap";
import { forecastLoad, Forecast } from "../analytics/loadForecast";
import { ExamMatch, FlashcardDraft } from "../types";
import { Logger } from "../utils/logger";

export const VIEW_TYPE_ANALYTICS = "mnexus-analytics";

interface DashboardData {
  cards: FSRSCardSnapshot[];
  exams: ExamMatch[];
  activity: ActivityEvent[];
  dailyCap: number;
}

export class AnalyticsDashboardView extends ItemView {
  private log: Logger;
  private getData: () => Promise<DashboardData>;

  constructor(leaf: WorkspaceLeaf, log: Logger, getData: () => Promise<DashboardData>) {
    super(leaf);
    this.log = log;
    this.getData = getData;
  }

  getViewType() {
    return VIEW_TYPE_ANALYTICS;
  }
  getDisplayText() {
    return "M-NEXUS Analytics";
  }
  getIcon() {
    return "trending-up";
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    this.containerEl.empty();
  }

  async render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-analytics-root");

    const data = await this.getData();
    const metrics = computeGlobalMetrics(data.cards);
    const predictions = predictAll(metrics.bySubject, data.exams, data.dailyCap);
    const heatmap = buildHeatmap(data.activity, 365);
    const forecast = forecastLoad(data.cards, { daysAhead: 30, dailyCap: data.dailyCap });

    // ─── Header ───────────────────────────────────────────────────
    const header = root.createDiv({ cls: "mnexus-analytics-header" });
    header.createEl("h2", { text: "📊 Analytics M-NEXUS" });
    const summary = header.createDiv({ cls: "mnexus-analytics-summary" });
    summary.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 16px;";
    summary.appendChild(this.summaryCard("Total tarjetas", String(metrics.total), "🃏"));
    summary.appendChild(this.summaryCard("Mastery global", `${Math.round(metrics.globalMastery * 100)}%`, "🎯"));
    summary.appendChild(this.summaryCard("Retención 30d", `${Math.round(metrics.globalRetention30d * 100)}%`, "🧠"));
    summary.appendChild(this.summaryCard("Repasos vencidos", String(metrics.overdue), "⚠"));
    summary.appendChild(this.summaryCard("Streak actual", `${heatmap.streak} días`, "🔥"));
    summary.appendChild(this.summaryCard("Activos 30d", `${heatmap.activeLast30}/30`, "📆"));

    // ─── Predicción de aprobación ──────────────────────────────────
    root.createEl("h3", { text: "🎯 Predicción de aprobación" });
    if (predictions.length === 0) {
      root.createEl("p", { text: "Sin datos. Genera flashcards y/o añade fechas de examen.", cls: "mnexus-label" });
    } else {
      const grid = root.createDiv({ cls: "mnexus-predictions-grid" });
      grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:8px 0;";
      for (const p of predictions) {
        grid.appendChild(this.renderPredictionCard(p));
      }
    }

    // ─── Forecast ─────────────────────────────────────────────────
    root.createEl("h3", { text: "📈 Carga de repasos (próximos 30 días)" });
    root.appendChild(this.renderForecast(forecast, data.dailyCap));

    // ─── Heatmap ──────────────────────────────────────────────────
    root.createEl("h3", { text: "🔥 Mapa de actividad (último año)" });
    root.appendChild(this.renderHeatmap(heatmap));

    // ─── Tabla por materia ────────────────────────────────────────
    root.createEl("h3", { text: "📚 Detalle por materia" });
    if (metrics.bySubject.length === 0) {
      root.createEl("p", { text: "Sin tarjetas.", cls: "mnexus-label" });
    } else {
      const table = root.createEl("table", { cls: "mnexus-table" });
      table.style.cssText = "width:100%;border-collapse:collapse;margin:8px 0;";
      const thead = table.createEl("thead");
      const trh = thead.createEl("tr");
      ["Materia", "Total", "Nuevas", "Aprendiendo", "Repaso", "Vencidas", "Estab. (d)", "Retención 30d", "Mastery"].forEach((h) => {
        const th = trh.createEl("th", { text: h });
        th.style.cssText = "text-align:left;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border);font-size:var(--font-ui-small);";
      });
      const tbody = table.createEl("tbody");
      for (const s of metrics.bySubject.sort((a, b) => b.total - a.total)) {
        const tr = tbody.createEl("tr");
        const cells = [
          s.subject,
          String(s.total),
          String(s.new),
          String(s.learning),
          String(s.review),
          String(s.lapsed),
          s.avgStability.toFixed(1),
          `${Math.round(s.retention30d * 100)}%`,
          `${Math.round(s.mastery * 100)}%`,
        ];
        for (const c of cells) {
          const td = tr.createEl("td", { text: c });
          td.style.cssText = "padding:4px 8px;border-bottom:1px solid var(--background-modifier-border);font-size:var(--font-ui-small);";
        }
      }
    }
  }

  // ─── Componentes ────────────────────────────────────────────────

  private summaryCard(label: string, value: string, icon: string): HTMLElement {
    const card = document.createElement("div");
    card.style.cssText = "flex:1;min-width:120px;padding:8px 12px;background:var(--background-secondary);border-radius:6px;";
    card.createEl("div", { text: `${icon} ${label}`, cls: "mnexus-label" });
    const v = card.createEl("div", { text: value });
    v.style.cssText = "font-size:1.5em;font-weight:600;";
    return card;
  }

  private renderPredictionCard(p: PredictionOutput): HTMLElement {
    const card = document.createElement("div");
    card.classList.add("mnexus-prediction-card");
    card.style.cssText = "padding:12px;border-radius:8px;background:var(--background-secondary);border-left:4px solid var(--text-muted);";
    const color = p.level === "critical" ? "var(--text-error)" :
                  p.level === "risky" ? "var(--text-warning)" :
                  p.level === "ok" ? "var(--text-accent)" :
                  p.level === "good" ? "var(--text-success)" : "var(--text-success)";
    card.style.borderLeftColor = color;
    const header = card.createDiv();
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    header.createEl("strong", { text: p.subject });
    const pct = header.createEl("span", { text: `${Math.round(p.probability * 100)}%` });
    pct.style.cssText = `font-size:1.4em;font-weight:700;color:${color};`;

    // Gauge SVG
    const gauge = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    gauge.setAttribute("width", "100%");
    gauge.setAttribute("height", "8");
    gauge.setAttribute("viewBox", "0 0 200 8");
    gauge.style.cssText = "display:block;margin:6px 0;";
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
    bg.setAttribute("x", "0"); bg.setAttribute("y", "3"); bg.setAttribute("width", "200"); bg.setAttribute("height", "2");
    bg.setAttribute("fill", "var(--background-modifier-border)");
    gauge.appendChild(bg);
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
    bar.setAttribute("x", "0"); bar.setAttribute("y", "3"); bar.setAttribute("height", "2");
    bar.setAttribute("width", String(200 * p.probability));
    bar.setAttribute("fill", color);
    gauge.appendChild(bar);
    card.appendChild(gauge);

    card.createEl("p", { text: `Días hasta examen: ${p.daysToExam}`, cls: "mnexus-label" });
    if (p.recommendations.length > 0) {
      const ul = card.createEl("ul");
      ul.style.cssText = "margin:4px 0;padding-left:18px;font-size:var(--font-ui-small);";
      for (const r of p.recommendations) ul.createEl("li", { text: r });
    }
    return card;
  }

  private renderForecast(forecast: Forecast, dailyCap: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "background:var(--background-secondary);padding:12px;border-radius:6px;";
    const info = wrap.createEl("p", {
      text: `Pico: ${forecast.peakLoad} tarjetas (${forecast.peakDate}) · Carga media: ${forecast.avgLoad.toFixed(0)}/día · Días saturados (>${dailyCap}): ${forecast.saturatedDays}`,
      cls: "mnexus-label",
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const W = 600;
    const H = 120;
    const PAD = 24;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(H));
    svg.style.cssText = "display:block;";
    const max = Math.max(dailyCap, forecast.peakLoad, 1);
    const barW = (W - PAD * 2) / forecast.days.length;
    // Cap line
    const capY = H - PAD - (dailyCap / max) * (H - PAD * 2);
    const capLine = document.createElementNS("http://www.w3.org/2000/svg", "line") as SVGLineElement;
    capLine.setAttribute("x1", String(PAD));
    capLine.setAttribute("y1", String(capY));
    capLine.setAttribute("x2", String(W - PAD));
    capLine.setAttribute("y2", String(capY));
    capLine.setAttribute("stroke", "var(--text-error)");
    capLine.setAttribute("stroke-dasharray", "3,3");
    capLine.setAttribute("stroke-width", "1");
    svg.appendChild(capLine);
    const capLabel = document.createElementNS("http://www.w3.org/2000/svg", "text") as SVGTextElement;
    capLabel.setAttribute("x", String(W - PAD));
    capLabel.setAttribute("y", String(capY - 4));
    capLabel.setAttribute("text-anchor", "end");
    capLabel.setAttribute("fill", "var(--text-error)");
    capLabel.setAttribute("font-size", "10");
    capLabel.textContent = `cap ${dailyCap}`;
    svg.appendChild(capLabel);
    // Bars
    forecast.days.forEach((d, i) => {
      const x = PAD + i * barW;
      const h = (d.count / max) * (H - PAD * 2);
      const y = H - PAD - h;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(Math.max(1, barW - 1)));
      rect.setAttribute("height", String(h));
      const color = d.loadRatio > 1 ? "var(--text-error)" : d.loadRatio > 0.8 ? "var(--text-warning)" : "var(--text-accent)";
      rect.setAttribute("fill", color);
      rect.setAttribute("opacity", "0.85");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title") as SVGTitleElement;
      title.textContent = `${d.date}: ${d.count} tarjetas (${Math.round(d.loadRatio * 100)}% del cap)`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    // Eje X: solo primer, mitad y último
    const labels = [0, Math.floor(forecast.days.length / 2), forecast.days.length - 1];
    for (const idx of labels) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text") as SVGTextElement;
      t.setAttribute("x", String(PAD + idx * barW + barW / 2));
      t.setAttribute("y", String(H - 4));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "9");
      t.setAttribute("fill", "var(--text-muted)");
      t.textContent = forecast.days[idx]?.date.slice(5) ?? "";
      svg.appendChild(t);
    }
    wrap.appendChild(svg);
    return wrap;
  }

  private renderHeatmap(heatmap: { days: HeatmapDay[] }): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "background:var(--background-secondary);padding:12px;border-radius:6px;overflow-x:auto;";
    // 53 columnas × 7 filas
    const cellSize = 11;
    const cellGap = 2;
    const cols = 53;
    const rows = 7;
    const W = cols * (cellSize + cellGap) + 20;
    const H = rows * (cellSize + cellGap) + 20;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    const today = new Date();
    // Alinear el final de la rejilla al día actual
    for (let i = 0; i < heatmap.days.length; i++) {
      const day = heatmap.days[i];
      const d = new Date(day.date);
      const daysAgo = Math.floor((today.getTime() - d.getTime()) / (24 * 3600 * 1000));
      const col = cols - 1 - Math.floor(daysAgo / 7);
      const row = d.getDay();
      const intensity = day.count / Math.max(1, heatmap.days[heatmap.days.length - 1].count || 1);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
      rect.setAttribute("x", String(col * (cellSize + cellGap) + 10));
      rect.setAttribute("y", String(row * (cellSize + cellGap) + 10));
      rect.setAttribute("width", String(cellSize));
      rect.setAttribute("height", String(cellSize));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", heatmapColor(intensity));
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title") as SVGTitleElement;
      title.textContent = `${day.date}: ${day.count} actividades`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }
    wrap.appendChild(svg);
    return wrap;
  }
}
