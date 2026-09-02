// CalendarSync: descarga ICS, identifica exámenes por keywords, los asigna a notas.
// Las notas se vinculan por subject (case-insensitive). Si no hay nota coincidente, propone crear.

import { App, Notice, requestUrl, TFile } from "obsidian";
import { CalendarEvent, ExamMatch, MNexusFrontmatter, MNexusSettings } from "../types";
import { IcsParser } from "./ics";
import { FrontmatterManager } from "../metadata/frontmatter";
import { Logger } from "../utils/logger";

export class CalendarSync {
  private parser = new IcsParser();
  private fm: FrontmatterManager;
  private cached: { events: CalendarEvent[]; fetchedAt: number } | null = null;
  private static CACHE_TTL = 60 * 60 * 1000; // 1h

  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger
  ) {
    this.fm = new FrontmatterManager(app);
  }

  /** Sincroniza todos los calendarios configurados. */
  async syncAll(): Promise<ExamMatch[]> {
    const allEvents: CalendarEvent[] = [];
    for (const url of this.settings.calendarIcsUrls ?? []) {
      try {
        const events = await this.fetch(url);
        allEvents.push(...events);
        this.log.info(`Calendario ${url}: ${events.length} eventos.`);
      } catch (e) {
        this.log.warn(`Falló fetch de ${url}: ${(e as Error).message}`);
      }
    }
    if (this.settings.calendarLocalFile) {
      try {
        const file = this.app.vault.getAbstractFileByPath(this.settings.calendarLocalFile);
        if (file instanceof TFile) {
          const text = await this.app.vault.read(file);
          allEvents.push(...this.parser.parse(text));
        }
      } catch (e) {
        this.log.warn(`Falló lectura de ${this.settings.calendarLocalFile}: ${(e as Error).message}`);
      }
    }
    this.cached = { events: allEvents, fetchedAt: Date.now() };
    const matches = this.identifyExams(allEvents);
    await this.applyToNotes(matches);
    return matches;
  }

  /** Fuerza refetch ignorando caché. */
  async refresh(): Promise<ExamMatch[]> {
    this.cached = null;
    return this.syncAll();
  }

  /** Devuelve los matches sin aplicar (dry run). */
  async preview(): Promise<ExamMatch[]> {
    const events = await this.getAllEvents();
    return this.identifyExams(events);
  }

  // ─── Fetch ────────────────────────────────────────────────────────────

  private async fetch(url: string): Promise<CalendarEvent[]> {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const res = await requestUrl({ url, method: "GET", throw: false });
      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
      }
      return this.parser.parse(res.text);
    }
    if (url.startsWith("webcal://")) {
      // webcal es https disfrazado
      return this.fetch("https://" + url.slice("webcal://".length));
    }
    // Path local
    const file = this.app.vault.getAbstractFileByPath(url);
    if (file instanceof TFile) {
      return this.parser.parse(await this.app.vault.read(file));
    }
    throw new Error(`No se pudo resolver origen: ${url}`);
  }

  private async getAllEvents(): Promise<CalendarEvent[]> {
    if (this.cached && Date.now() - this.cached.fetchedAt < CalendarSync.CACHE_TTL) {
      return this.cached.events;
    }
    await this.syncAll();
    return this.cached?.events ?? [];
  }

  // ─── Identificación ───────────────────────────────────────────────────

  /** Filtra eventos que parecen exámenes según keywords. */
  identifyExams(events: CalendarEvent[]): ExamMatch[] {
    const kws = (this.settings.calendarKeywords ?? []).map((k) => k.toLowerCase());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out: ExamMatch[] = [];
    for (const ev of events) {
      if (ev.start < today) continue; // solo futuros
      const text = `${ev.summary} ${ev.description ?? ""}`.toLowerCase();
      if (!kws.some((k) => text.includes(k))) continue;
      const subject = this.inferSubject(ev);
      out.push({
        event: ev,
        subject,
        date: ev.start.toISOString(),
        confidence: this.confidence(ev, kws),
      });
    }
    out.sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
    return out;
  }

  private inferSubject(ev: CalendarEvent): string {
    const text = `${ev.summary} ${ev.description ?? ""}`;
    // Quitar keywords de examen para aislar el nombre
    const kws = this.settings.calendarKeywords ?? [];
    let subject = ev.summary;
    for (const k of kws) {
      const re = new RegExp(`\\b${k}\\b`, "gi");
      subject = subject.replace(re, "").trim();
    }
    // Quitar paréntesis típicos: "(Final)", "[Parcial]"
    subject = subject.replace(/[\(\[][^\)\]]*[\)\]]/g, "").trim();
    // Quitar prefijos de fecha
    subject = subject.replace(/^\d+[\-\/]\d+[\-\/]\d+\s*/, "").trim();
    return subject || text.slice(0, 60);
  }

  private confidence(ev: CalendarEvent, kws: string[]): "high" | "medium" | "low" {
    const text = `${ev.summary} ${ev.description ?? ""}`.toLowerCase();
    const exact = kws.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
    if (exact.length >= 2) return "high";
    if (exact.length === 1) return "medium";
    return "low";
  }

  // ─── Aplicación a notas ───────────────────────────────────────────────

  private async applyToNotes(matches: ExamMatch[]): Promise<void> {
    const notes = this.app.vault.getMarkdownFiles();
    const noteBySubject = this.indexNotesBySubject(notes);
    let updated = 0;
    for (const m of matches) {
      const norm = m.subject.toLowerCase().trim();
      const target = noteBySubject.get(norm) ?? this.fuzzyMatch(m.subject, noteBySubject);
      if (!target) {
        this.log.info(`Examen '${m.event.summary}' sin nota destino (subject='${m.subject}').`);
        continue;
      }
      await this.assign(target, m);
      updated++;
    }
    if (updated > 0) new Notice(`M-NEXUS: ${updated} exámenes asignados a notas.`);
  }

  private indexNotesBySubject(notes: TFile[]): Map<string, TFile> {
    const m = new Map<string, TFile>();
    for (const n of notes) {
      const fm = this.app.metadataCache.getFileCache(n)?.frontmatter;
      const subj = (fm?.subject as string) ?? n.basename;
      m.set(subj.toLowerCase().trim(), n);
    }
    return m;
  }

  private fuzzyMatch(subject: string, index: Map<string, TFile>): TFile | undefined {
    const norm = subject.toLowerCase();
    for (const [key, file] of index.entries()) {
      if (norm.includes(key) || key.includes(norm)) return file;
    }
    return undefined;
  }

  private async assign(file: TFile, match: ExamMatch): Promise<void> {
    const date = match.event.start.toISOString().slice(0, 10);
    const patch: Partial<MNexusFrontmatter> = {
      exam_date: date,
      exam_source: "calendar",
      calendar_event_id: match.event.uid,
      priority_level: match.confidence === "high" ? "High" : match.confidence === "medium" ? "Medium" : "Low",
    };
    if (!match.event.description && match.event.location) {
      // nada
    }
    await this.fm.merge(file, patch);
    this.log.info(`Asignado ${match.event.summary} → ${file.basename} (${date}, conf=${match.confidence}).`);
  }
}
