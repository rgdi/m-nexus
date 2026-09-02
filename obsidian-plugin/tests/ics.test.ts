import { describe, it, expect } from "vitest";
import { IcsParser } from "../src/calendar/ics";

describe("ICS parser", () => {
  const parser = new IcsParser();

  const sampleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:ex-001@test
SUMMARY:Examen Cardiología
DTSTART:20261201T100000
DTEND:20261201T120000
LOCATION:Aula 12
DESCRIPTION:Traer DNI
END:VEVENT
BEGIN:VEVENT
UID:ex-002@test
SUMMARY:Clase normal
DTSTART:20261115T090000
END:VEVENT
BEGIN:VEVENT
UID:ex-003@test
SUMMARY:Parcial Anatomía
DTSTART:20261120T160000Z
END:VEVENT
END:VCALENDAR`;

  it("parsea 3 eventos", () => {
    const events = parser.parse(sampleIcs);
    expect(events.length).toBe(3);
  });

  it("extrae UID, summary, location", () => {
    const events = parser.parse(sampleIcs);
    expect(events[0].uid).toBe("ex-001@test");
    expect(events[0].summary).toBe("Examen Cardiología");
    expect(events[0].location).toBe("Aula 12");
  });

  it("parsea fechas con hora local (sin Z)", () => {
    const events = parser.parse(sampleIcs);
    // 2026-12-01T10:00:00 hora local
    const d = events[0].start;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // diciembre (0-indexed)
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(10);
  });

  it("parsea fechas UTC (con Z)", () => {
    const events = parser.parse(sampleIcs);
    // 2026-11-20T16:00:00Z
    const d = events[2].start;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(10); // noviembre
    expect(d.getUTCDate()).toBe(20);
  });

  it("maneja ICS vacío sin fallar", () => {
    const events = parser.parse("BEGIN:VCALENDAR\nEND:VCALENDAR");
    expect(events.length).toBe(0);
  });

  it("ignora eventos sin DTSTART", () => {
    const broken = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:bad@test
SUMMARY:Sin fecha
END:VEVENT
END:VCALENDAR`;
    const events = parser.parse(broken);
    expect(events.length).toBe(0);
  });

  it("parsea fechas solo día (YYYYMMDD)", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:all-day@test
SUMMARY:Examen todo el día
DTSTART;VALUE=DATE:20261201
END:VEVENT
END:VCALENDAR`;
    const events = parser.parse(ics);
    expect(events.length).toBe(1);
    // Mide al menos el año/mes/día
    expect(events[0].start.getFullYear()).toBe(2026);
  });

  it("deshace el line folding (RFC 5545)", () => {
    const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:fold@test
SUMMARY:Línea muy larga que
  continúa aquí
DTSTART:20261201T100000
END:VEVENT
END:VCALENDAR`;
    const events = parser.parse(folded);
    expect(events[0].summary).toContain("continúa aquí");
    expect(events[0].summary).not.toMatch(/continúa\n  /);
  });
});
