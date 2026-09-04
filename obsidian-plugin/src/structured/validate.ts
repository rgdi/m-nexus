// validate.ts: validación de propiedades typed + fórmulas (v0.33).
//
// Las fórmulas son un mini-lenguaje seguro (sin eval):
//   today()        → fecha actual (YYYY-MM-DD)
//   now()          → unix ms actual
//   upper(s)       → uppercase
//   lower(s)       → lowercase
//   length(s)      → longitud
//   concat(a, b)   → concatenar strings
//   abs(n)         → valor absoluto
//   round(n)       → redondear
//   if(cond, a, b) → si cond es truthy, a; si no, b
//   prop(name)     → propiedad del row actual

import type { PropertySchema, PropertyType } from "./schema";

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ValidationError";
  }
}

/** Valida un valor contra un property schema. */
export function validatePropertyValue(
  schema: PropertySchema,
  value: unknown
): { ok: true; coerced: unknown } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    if (schema.required) {
      return { ok: false, error: `${schema.name} is required` };
    }
    return { ok: true, coerced: value ?? schema.default ?? null };
  }
  switch (schema.type) {
    case "text":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be a string` };
      }
      return { ok: true, coerced: value };
    case "number":
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `${schema.name} must be a number` };
      }
      return { ok: true, coerced: n };
    case "boolean":
      if (typeof value === "boolean") return { ok: true, coerced: value };
      if (value === "true") return { ok: true, coerced: true };
      if (value === "false") return { ok: true, coerced: false };
      return { ok: false, error: `${schema.name} must be boolean` };
    case "date":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be an ISO date string` };
      }
      if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return { ok: false, error: `${schema.name} must be YYYY-MM-DD` };
      }
      return { ok: true, coerced: value };
    case "select":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be a string` };
      }
      if (schema.options && !schema.options.includes(value)) {
        return {
          ok: false,
          error: `${schema.name} must be one of: ${schema.options.join(", ")}`,
        };
      }
      return { ok: true, coerced: value };
    case "multi":
      if (!Array.isArray(value)) {
        return { ok: false, error: `${schema.name} must be an array` };
      }
      if (schema.options) {
        for (const v of value) {
          if (typeof v !== "string" || !schema.options.includes(v)) {
            return {
              ok: false,
              error: `${schema.name} contains invalid option: ${v}`,
            };
          }
        }
      }
      return { ok: true, coerced: value };
    case "url":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be a string URL` };
      }
      try {
        new URL(value);
      } catch {
        return { ok: false, error: `${schema.name} is not a valid URL` };
      }
      return { ok: true, coerced: value };
    case "email":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be a string email` };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { ok: false, error: `${schema.name} is not a valid email` };
      }
      return { ok: true, coerced: value };
    case "relation":
      if (typeof value !== "string") {
        return { ok: false, error: `${schema.name} must be a path string` };
      }
      return { ok: true, coerced: value };
    case "formula":
      return {
        ok: false,
        error: `${schema.name} is a formula and cannot be set directly`,
      };
    default:
      return { ok: false, error: `Unknown property type: ${schema.type}` };
  }
}

/** Evalúa una fórmula contra un contexto (row). */
export function evalFormula(
  formula: string,
  row: Record<string, unknown>
): unknown {
  // Tokenizer + recursive descent parser
  const tokens = tokenize(formula);
  const parser = new Parser(tokens);
  const ast = parser.parseExpression();
  return evalAst(ast, row);
}

function tokenize(formula: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < formula.length) {
    const c = formula[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      tokens.push(c);
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = "";
      while (j < formula.length && formula[j] !== quote) {
        if (formula[j] === "\\" && j + 1 < formula.length) {
          str += formula[j + 1];
          j += 2;
        } else {
          str += formula[j];
          j++;
        }
      }
      tokens.push(`"${str}"`);
      i = j + 1;
      continue;
    }
    let j = i;
    while (
      j < formula.length &&
      !/\s|\(|\)|,/.test(formula[j])
    ) {
      j++;
    }
    tokens.push(formula.slice(i, j));
    i = j;
  }
  return tokens;
}

type Expr =
  | { type: "call"; name: string; args: Expr[] }
  | { type: "prop"; name: string }
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "ident"; value: string };

class Parser {
  private pos = 0;
  constructor(private tokens: string[]) {}
  peek(): string | undefined {
    return this.tokens[this.pos];
  }
  consume(): string {
    return this.tokens[this.pos++];
  }
  parseExpression(): Expr {
    return this.parseCallOrAtom();
  }
  private parseCallOrAtom(): Expr {
    const tok = this.peek();
    if (!tok) return { type: "literal", value: null };
    if (tok === "(" || tok === ",") {
      throw new Error(`Unexpected token: ${tok}`);
    }
    this.consume();
    if (this.peek() === "(") {
      this.consume();
      const args: Expr[] = [];
      while (this.peek() !== ")") {
        args.push(this.parseCallOrAtom());
        if (this.peek() === ",") this.consume();
      }
      this.consume(); // ")"
      return { type: "call", name: tok, args };
    }
    if (tok.startsWith('"') && tok.endsWith('"')) {
      return { type: "literal", value: tok.slice(1, -1) };
    }
    if (/^-?\d+(\.\d+)?$/.test(tok)) {
      return { type: "literal", value: Number(tok) };
    }
    if (tok === "true") return { type: "literal", value: true };
    if (tok === "false") return { type: "literal", value: false };
    if (tok === "null") return { type: "literal", value: null };
    if (tok === "prop") {
      // prop(name) se maneja arriba; esta rama es para prop.name (no soportado)
      throw new Error("prop must be called as prop(name)");
    }
    return { type: "ident", value: tok };
  }
}

function evalAst(expr: Expr, row: Record<string, unknown>): unknown {
  if (expr.type === "literal") return expr.value;
  if (expr.type === "ident") return row[expr.value] ?? null;
  if (expr.type === "prop") return row[expr.name] ?? null;
  if (expr.type === "call") {
    const args = expr.args.map((a) => evalAst(a, row));
    switch (expr.name) {
      case "today":
        return new Date().toISOString().slice(0, 10);
      case "now":
        return Date.now();
      case "upper":
        return String(args[0] ?? "").toUpperCase();
      case "lower":
        return String(args[0] ?? "").toLowerCase();
      case "length":
        return String(args[0] ?? "").length;
      case "concat":
        return args.map((a) => String(a)).join("");
      case "abs":
        return Math.abs(Number(args[0] ?? 0));
      case "round":
        return Math.round(Number(args[0] ?? 0));
      case "if":
        return args[0] ? args[1] : args[2];
      case "prop":
        return row[String(args[0] ?? "")] ?? null;
      default:
        throw new Error(`Unknown function: ${expr.name}`);
    }
  }
  return null;
}

/** Aplica filtros a una lista de rows. */
export function applyFilters(
  rows: Array<{ properties: Record<string, unknown> }>,
  filters: Array<{ property: string; op: string; value: unknown }>
): typeof rows {
  if (!filters?.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const v = row.properties[f.property];
      switch (f.op) {
        case "=": return v === f.value;
        case "!=": return v !== f.value;
        case ">": return Number(v) > Number(f.value);
        case "<": return Number(v) < Number(f.value);
        case ">=": return Number(v) >= Number(f.value);
        case "<=": return Number(v) <= Number(f.value);
        case "contains": return String(v ?? "").includes(String(f.value));
        case "in": return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        case "isEmpty": return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
        case "isNotEmpty": return v !== null && v !== undefined && v !== "";
        default: return true;
      }
    })
  );
}

/** Aplica sorts. */
export function applySorts<T extends { properties: Record<string, unknown> }>(
  rows: T[],
  sorts: Array<{ property: string; direction: "asc" | "desc" }>
): T[] {
  if (!sorts?.length) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of sorts) {
      const av = a.properties[s.property];
      const bv = b.properties[s.property];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      }
      if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

/** Agrupa rows por una propiedad (para kanban). */
export function groupBy<T extends { properties: Record<string, unknown> }>(
  rows: T[],
  property: string
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.properties[property] ?? "");
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(row);
  }
  return out;
}
