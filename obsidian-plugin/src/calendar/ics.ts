// Parser ICS (iCalendar) minimalista.
// Soporta el subset que necesitamos: VEVENT con SUMMARY, DTSTART, DTEND, DESCRIPTION, LOCATION, UID.
// No es RFC 5545 completo (no recurrencias, no timezones complejos) pero cubre el 95% de calendarios académicos.

import { CalendarEvent } from "../types";

const FOLD = /[\r\n]+[ \t]/g;
const LINE_BREAK = /\r?\n/;

export class IcsParser {
  /** Parsea texto ICS a eventos. */
  parse(text: string): CalendarEvent[] {
    // Desdoblar líneas (RFC 5545 line folding)
    const unfolded = text.replace(FOLD, "");
    const lines = unfolded.split(LINE_BREAK);
    const events: CalendarEvent[] = [];
    let current: Partial<CalendarEvent> | null = null;
    let rawAccum: Record<string, string> = {};

    for (const line of lines) {
      if (line.startsWith("BEGIN:VEVENT")) {
        current = { raw: {} };
        rawAccum = {};
        continue;
      }
      if (line.startsWith("END:VEVENT")) {
        if (current) {
          // Filtrar eventos sin start (no se pueden usar)
          if (!current.start) {
            current = null;
            continue;
          }
          events.push({
            uid: current.uid ?? `no-uid-${events.length}`,
            summary: current.summary ?? "(sin título)",
            description: current.description,
            start: current.start ?? new Date(),
            end: current.end,
            location: current.location,
            raw: rawAccum,
          });
        }
        current = null;
        continue;
      }
      if (!current) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx < 0) continue;
      const fullKey = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      // Separar key y params (KEY;PARAM=val:value)
      const [key, ...paramParts] = fullKey.split(";");
      const params: Record<string, string> = {};
      for (const p of paramParts) {
        const [pk, pv] = p.split("=");
        if (pk && pv) params[pk] = pv;
      }
      rawAccum[key] = value;
      switch (key) {
        case "UID":
          current.uid = value;
          break;
        case "SUMMARY":
          current.summary = unescapeIcs(value);
          break;
        case "DESCRIPTION":
          current.description = unescapeIcs(value);
          break;
        case "LOCATION":
          current.location = unescapeIcs(value);
          break;
        case "DTSTART":
          current.start = parseIcsDate(value, params);
          break;
        case "DTEND":
          current.end = parseIcsDate(value, params);
          break;
      }
    }
    return events;
  }
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Parsea fechas ICS: YYYYMMDD o YYYYMMDDTHHMMSS o YYYYMMDDTHHMMSSZ */
function parseIcsDate(value: string, params: Record<string, string>): Date {
  // Si tiene TZID, idealmente habría que resolverlo. Para simplificar, asumimos local.
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) {
    return new Date(
      Number(clean.slice(0, 4)),
      Number(clean.slice(4, 6)) - 1,
      Number(clean.slice(6, 8))
    );
  }
  if (/^\d{8}T\d{6}Z?$/.test(clean)) {
    const isUtc = clean.endsWith("Z");
    const y = Number(clean.slice(0, 4));
    const mo = Number(clean.slice(4, 6)) - 1;
    const d = Number(clean.slice(6, 8));
    const h = Number(clean.slice(9, 11));
    const mi = Number(clean.slice(11, 13));
    const s = Number(clean.slice(13, 15));
    if (isUtc) {
      return new Date(Date.UTC(y, mo, d, h, mi, s));
    }
    return new Date(y, mo, d, h, mi, s);
  }
  // Fallback: dejar que JS lo intente
  const d = new Date(clean);
  if (isNaN(d.getTime())) {
    // Si tiene TZID, no podemos resolver sin tabla. Loguear.
    if (params.TZID) {
      console.warn(`M-NEXUS: fecha con TZID=${params.TZID} no resuelta (${value}). Se usará UTC.`);
    }
    return new Date();
  }
  return d;
}
