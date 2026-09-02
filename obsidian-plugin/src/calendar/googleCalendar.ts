// Google Calendar API client + sync.
//
// Lista eventos en un rango de fechas, los mapea a ExamMatch, y aplica al vault.
// El bidirectional sync es opcional (más complejo; de momento es read-only).

import { App, Notice, requestUrl } from "obsidian";
import { CalendarEvent, GoogleAuthState, MNexusSettings } from "../types";
import { GoogleAuth } from "./googleAuth";
import { FrontmatterManager } from "../metadata/frontmatter";
import { Logger } from "../utils/logger";

export class GoogleCalendarClient {
  private authState: GoogleAuthState | null = null;

  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private auth: GoogleAuth
  ) {}

  isAuthorized(): boolean {
    return Boolean(this.authState && this.authState.expiresAt > Date.now());
  }

  setAuthState(state: GoogleAuthState) {
    this.authState = state;
  }

  async ensureAuth(): Promise<GoogleAuthState> {
    if (this.isAuthorized() && this.authState) return this.authState!;
    if (this.authState?.refreshToken) {
      this.authState = await this.auth.refresh(this.authState);
      return this.authState!;
    }
    this.authState = await this.auth.authorize();
    return this.authState!;
  }

  /** Lista eventos entre [timeMin, timeMax] (ISO strings). */
  async listEvents(timeMin: string, timeMax: string, maxResults = 250): Promise<CalendarEvent[]> {
    const auth = await this.ensureAuth();
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    const res = await requestUrl({
      url: url.toString(),
      method: "GET",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      throw: false,
    });
    if (res.status === 401 && auth.refreshToken) {
      // Token expirado; refrescar y reintentar
      this.authState = await this.auth.refresh(auth);
      return this.listEvents(timeMin, timeMax, maxResults);
    }
    if (res.status !== 200) {
      throw new Error(`Google Calendar list: ${res.status} ${res.text.slice(0, 500)}`);
    }
    const json = res.json as { items: GoogleEvent[] };
    return (json.items ?? []).map(this.toEvent).filter((e): e is CalendarEvent => Boolean(e));
  }

  /** Convierte un evento de la API en CalendarEvent interno. */
  private toEvent = (g: GoogleEvent): CalendarEvent | null => {
    const start = g.start?.dateTime ?? g.start?.date;
    const end = g.end?.dateTime ?? g.end?.date;
    if (!start) return null;
    return {
      uid: g.id ?? `gcal-${g.iCalUID ?? Date.now()}`,
      summary: g.summary ?? "(sin título)",
      description: g.description,
      start: new Date(start),
      end: end ? new Date(end) : undefined,
      location: g.location,
      raw: { htmlLink: g.htmlLink ?? "" },
    };
  };
}

interface GoogleEvent {
  id?: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
}

/** Sync que combina ICS + Google Calendar y aplica al vault. */
export class GoogleCalendarSync {
  private fm: FrontmatterManager;
  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private client: GoogleCalendarClient
  ) {
    this.fm = new FrontmatterManager(app);
  }

  /** Sincroniza los próximos N días. */
  async sync(daysAhead = 180): Promise<{ events: CalendarEvent[]; matched: number }> {
    if (!this.client.isAuthorized()) {
      new Notice("M-NEXUS: no has autorizado Google Calendar todavía. Ve a Ajustes → M-NEXUS → Google Calendar.");
      return { events: [], matched: 0 };
    }
    const now = new Date();
    const max = new Date(now.getTime() + daysAhead * 86400000);
    const events = await this.client.listEvents(now.toISOString(), max.toISOString());
    this.log.info(`Google Calendar: ${events.length} eventos en ${daysAhead} días.`);

    // Filtrar por keywords
    const kws = (this.settings.calendarKeywords ?? []).map((k) => k.toLowerCase());
    const examEvents = events.filter((e) => {
      const t = `${e.summary} ${e.description ?? ""}`.toLowerCase();
      return kws.some((k) => t.includes(k));
    });

    // Asignar a notas
    const notes = this.app.vault.getMarkdownFiles();
    const noteBySubject = this.indexBySubject(notes);
    let matched = 0;
    for (const ev of examEvents) {
      const subject = this.inferSubject(ev);
      const target = noteBySubject.get(subject.toLowerCase().trim()) ?? this.fuzzy(subject, noteBySubject);
      if (!target) continue;
      await this.fm.merge(target, {
        exam_date: ev.start.toISOString().slice(0, 10),
        exam_source: "calendar",
        calendar_event_id: ev.uid,
        priority_level: this.isHardKeyword(kws, ev) ? "High" : "Medium",
      });
      matched++;
    }
    if (matched > 0) new Notice(`M-NEXUS: ${matched} exámenes de Google Calendar asignados.`);
    return { events: examEvents, matched };
  }

  private inferSubject(ev: CalendarEvent): string {
    let s = ev.summary;
    for (const k of this.settings.calendarKeywords ?? []) {
      s = s.replace(new RegExp(`\\b${k}\\b`, "gi"), "").trim();
    }
    s = s.replace(/[\(\[][^\)\]]*[\)\]]/g, "").trim();
    return s || ev.summary;
  }

  private isHardKeyword(kws: string[], ev: CalendarEvent): boolean {
    const t = `${ev.summary} ${ev.description ?? ""}`.toLowerCase();
    return ["examen", "final", "parcial"].some((k) => t.includes(k) && kws.includes(k));
  }

  private indexBySubject(notes: import("obsidian").TFile[]): Map<string, import("obsidian").TFile> {
    const m = new Map<string, import("obsidian").TFile>();
    for (const n of notes) {
      const fm = this.app.metadataCache.getFileCache(n)?.frontmatter;
      const subj = (fm?.subject as string) ?? n.basename;
      m.set(subj.toLowerCase().trim(), n);
    }
    return m;
  }

  private fuzzy(subject: string, index: Map<string, import("obsidian").TFile>): import("obsidian").TFile | undefined {
    const n = subject.toLowerCase();
    for (const [k, v] of index) if (n.includes(k) || k.includes(n)) return v;
    return undefined;
  }
}
