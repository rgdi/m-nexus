// schema.ts: tipos para "Notion-style" structured notes (v0.33).
//
// Cada vault de Obsidian puede tener "databases" (carpetas con
// propiedades tipadas en el frontmatter). Similar a Notion.
//
// Tipos de propiedades:
//   text, number, boolean, date, select, multi, url, email, relation, formula
//
// Cada database puede tener N vistas (table, kanban, calendar, gallery).

/** Tipos de propiedad soportados. */
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

/** Schema de una propiedad. */
export interface PropertySchema {
  name: string;
  type: PropertyType;
  /** Para select/multi: opciones permitidas. */
  options?: string[];
  /** Para formula: expresión (ej. "upper(name)", "today()"). */
  formula?: string;
  /** Para relation: nombre del target database. */
  relationTarget?: string;
  /** Default value. */
  default?: unknown;
  /** Si es required en el frontmatter. */
  required?: boolean;
}

/** Schema completo de una "database" (= una carpeta del vault). */
export interface DatabaseSchema {
  id: string;
  name: string;
  /** Carpeta del vault (ej: "_M-NEXUS/Flashcards/Approved"). */
  folder: string;
  properties: PropertySchema[];
  /** Qué propiedad usar como "title" principal. */
  titleProperty: string;
  /** Color/icono de la database (Notion-style). */
  icon?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

/** Tipos de vista. */
export type ViewType = "table" | "kanban" | "calendar" | "gallery" | "list";

/** Config de vista, discriminated union por tipo. */
export type ViewConfig =
  | { type: "table"; groupBy?: string; hiddenColumns: string[]; density: "compact" | "normal" }
  | { type: "kanban"; groupBy: string; cardProperties: string[]; showEmptyGroups: boolean }
  | { type: "calendar"; dateProperty: string; showWeekNumbers: boolean }
  | { type: "gallery"; coverProperty?: string; cardSize: "small" | "medium" | "large" }
  | { type: "list"; iconProperty?: string; showProperties: boolean };

/** Vista de una database. */
export interface ViewSchema {
  id: string;
  databaseId: string;
  name: string;
  config: ViewConfig;
  createdAt: number;
}

/** Filtro para queries. */
export interface Filter {
  property: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "in" | "isEmpty" | "isNotEmpty";
  value: unknown;
}

/** Sort rule. */
export interface SortRule {
  property: string;
  direction: "asc" | "desc";
}

/** Una "row" de la database (= una nota del vault con frontmatter). */
export interface NoteRow {
  /** Path absoluto en el vault. */
  path: string;
  /** basename sin extensión. */
  name: string;
  /** Propiedades parseadas del frontmatter. */
  properties: Record<string, unknown>;
  /** Body markdown sin el frontmatter. */
  body: string;
  /** Cover image (opcional, del frontmatter). */
  cover?: string;
  /** Icon (emoji o URL). */
  icon?: string;
  /** Timestamps del filesystem. */
  createdAt: number;
  updatedAt: number;
}
