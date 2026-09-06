// StructuredNotes: el corazón del "Notion-style" de M-NEXUS.
//
// v0.33: un vault M-NEXUS se convierte en una "database" con
// propiedades tipadas (similar a Notion). Cada nota es una "row"
// con su frontmatter extendido.
//
// Tipos de propiedades soportados:
//   - text:      string libre
//   - number:    número
//   - boolean:   true/false
//   - date:      ISO 8601 string
//   - select:    un valor de un set predefinido
//   - multi:     array de valores de un set
//   - url:       URL validada
//   - email:     email
//   - relation:  referencia a otra nota (por path)
//   - formula:   computada (sum, count, today, etc.)
//
// Vistas: cada database puede tener N vistas (table, kanban, calendar, gallery)
// con filtros, sorts y agrupación por campo.
//
// Storage: SQLite en el backend (idempotente con el plugin que
// tiene su propia DB local). El plugin es la fuente de verdad;
// el backend es la fuente de verdad compartida entre devices.

import { createHash, randomUUID } from "node:crypto";

export type PropertyType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "multi"
  | "url"
  | "email"
  | "relation"
  | "formula";

export interface PropertySchema {
  name: string;
  type: PropertyType;
  /** Para select/multi: lista de opciones permitidas. */
  options?: string[];
  /** Para formula: expresión simple (sum, count, today, concat, etc). */
  formula?: string;
  /** Para relation: nombre del target database. */
  relationTarget?: string;
  /** Default value si el campo no se proporciona. */
  default?: unknown;
  /** Si es true, el campo es obligatorio. */
  required?: boolean;
}

export interface DatabaseSchema {
  id: string;
  vaultId: string;
  name: string;
  /** Carpeta M-NEXUS donde viven las notas (ej: "_M-NEXUS/Flashcards/Approved"). */
  folder: string;
  properties: PropertySchema[];
  /** Display: qué propiedad usar como "title" en las vistas. */
  titleProperty: string;
  createdAt: number;
  updatedAt: number;
}

export interface ViewSchema {
  id: string;
  databaseId: string;
  name: string;
  type: "table" | "kanban" | "calendar" | "gallery" | "list";
  /** Config específico por tipo. */
  config: ViewConfig;
  createdAt: number;
}

export type ViewConfig =
  | { type: "table"; groupBy?: string; hiddenColumns: string[] }
  | { type: "kanban"; groupBy: string; cardProperties: string[] }
  | { type: "calendar"; dateProperty: string }
  | { type: "gallery"; coverProperty?: string }
  | { type: "list"; iconProperty?: string };

export interface Filter {
  property: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "in" | "isEmpty" | "isNotEmpty";
  value: unknown;
}

export interface SortRule {
  property: string;
  direction: "asc" | "desc";
}

export interface NoteRow {
  id: string;
  databaseId: string;
  /** Path relativo al vault. */
  path: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** Vector clock para conflict resolution. */
  clock: Record<string, number>;
  /** Content hash (SHA-256 del frontmatter + body). */
  contentHash: string;
}

// ─── Validación ──────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(public field: string, public reason: string) {
    super(`Validation failed for ${field}: ${reason}`);
    (this as unknown as { code: string }).code = "VALIDATION_ERROR";
  }
}

export function validatePropertyValue(
  schema: PropertySchema,
  value: unknown
): { ok: true } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    if (schema.required) return { ok: false, error: "required" };
    return { ok: true };
  }
  switch (schema.type) {
    case "text":
    case "url":
    case "email":
      if (typeof value !== "string") return { ok: false, error: "must be string" };
      if (schema.type === "url") {
        try { new URL(value); } catch { return { ok: false, error: "must be valid URL" }; }
      }
      if (schema.type === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: "must be valid email" };
      }
      return { ok: true };
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { ok: false, error: "must be number" };
      }
      return { ok: true };
    case "boolean":
      if (typeof value !== "boolean") return { ok: false, error: "must be boolean" };
      return { ok: true };
    case "date":
      if (typeof value !== "string") return { ok: false, error: "must be ISO string" };
      if (Number.isNaN(Date.parse(value))) return { ok: false, error: "must be valid date" };
      return { ok: true };
    case "select":
      if (typeof value !== "string") return { ok: false, error: "must be string" };
      if (schema.options && !schema.options.includes(value)) {
        return { ok: false, error: `must be one of: ${schema.options.join(", ")}` };
      }
      return { ok: true };
    case "multi":
      if (!Array.isArray(value)) return { ok: false, error: "must be array" };
      if (schema.options) {
        for (const v of value) {
          if (typeof v !== "string" || !schema.options.includes(v)) {
            return { ok: false, error: `each must be in: ${schema.options.join(", ")}` };
          }
        }
      }
      return { ok: true };
    case "relation":
      // value: { id, path } | string (path)
      if (typeof value === "string") return { ok: true };
      if (typeof value === "object" && value !== null && "path" in value) {
        return { ok: true };
      }
      return { ok: false, error: "must be path string or {id,path}" };
    case "formula":
      // Las formulas se computan, no se validan en input
      return { ok: true };
    default:
      return { ok: false, error: `unknown type: ${schema.type as string}` };
  }
}

// ─── Formulas (mini-lenguaje para campos computados) ──────────

const FORMULA_FNS: Record<string, (args: unknown[], row: NoteRow) => unknown> = {
  today: () => new Date().toISOString().slice(0, 10),
  now: () => Date.now(),
  upper: (args) => String(args[0] ?? "").toUpperCase(),
  lower: (args) => String(args[0] ?? "").toLowerCase(),
  length: (args) => String(args[0] ?? "").length,
  concat: (args) => args.map((a) => String(a ?? "")).join(""),
  abs: (args) => Math.abs(Number(args[0] ?? 0)),
  round: (args) => Math.round(Number(args[0] ?? 0)),
  if: (args) => (args[0] ? args[1] : args[2]),
};

export function evalFormula(formula: string, row: NoteRow, allRows: NoteRow[]): unknown {
  // Sintaxis muy simple: fn(arg1, arg2)
  // Los args pueden ser: string literal, número, o nombre de propiedad
  try {
    const match = formula.match(/^(\w+)\((.*)\)$/);
    if (!match) return null;
    const fnName = match[1].toLowerCase();
    const fn = FORMULA_FNS[fnName];
    if (!fn) return null;
    const argStrs = match[2].split(",").map((s) => s.trim());
    const args = argStrs.map((a) => {
      if (a.match(/^".*"$/)) return a.slice(1, -1);
      if (a.match(/^-?\d+(\.\d+)?$/)) return Number(a);
      if (a === "true") return true;
      if (a === "false") return false;
      // nombre de propiedad
      return row.properties[a];
    });
    return fn(args, row);
  } catch {
    return null;
  }
}

// ─── Filter y sort ───────────────────────────────────────────

export function applyFilters(rows: NoteRow[], filters: Filter[]): NoteRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

function matchesFilter(row: NoteRow, f: Filter): boolean {
  const v = row.properties[f.property];
  switch (f.op) {
    case "=": return v === f.value;
    case "!=": return v !== f.value;
    case ">": return typeof v === "number" && typeof f.value === "number" && v > f.value;
    case "<": return typeof v === "number" && typeof f.value === "number" && v < f.value;
    case ">=": return typeof v === "number" && typeof f.value === "number" && v >= f.value;
    case "<=": return typeof v === "number" && typeof f.value === "number" && v <= f.value;
    case "contains":
      if (typeof v === "string" && typeof f.value === "string") return v.includes(f.value);
      if (Array.isArray(v) && typeof f.value === "string") return v.includes(f.value);
      return false;
    case "in":
      if (Array.isArray(f.value) && Array.isArray(v)) return v.some((x) => (f.value as unknown[]).includes(x));
      if (Array.isArray(f.value)) return f.value.includes(v as never);
      return false;
    case "isEmpty": return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    case "isNotEmpty": return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
    default: return true;
  }
}

export function applySorts(rows: NoteRow[], sorts: SortRule[]): NoteRow[] {
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const av = a.properties[s.property];
      const bv = b.properties[s.property];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

// ─── Group (para kanban) ──────────────────────────────────────

export function groupBy<K extends string | number>(
  rows: NoteRow[],
  field: string
): Map<K, NoteRow[]> {
  const out = new Map<K, NoteRow[]>();
  for (const row of rows) {
    const key = (row.properties[field] ?? "(empty)") as K;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(row);
  }
  return out;
}

// ─── Content hash ─────────────────────────────────────────────

export function hashContent(frontmatter: Record<string, unknown>, body: string): string {
  const json = JSON.stringify({ frontmatter, body });
  return createHash("sha256").update(json).digest("hex");
}

export function genId(): string {
  return randomUUID();
}
