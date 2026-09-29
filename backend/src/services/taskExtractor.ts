// services/taskExtractor.ts — v2.38.0
//
// Turns free text into structured tasks.
//
//     "dar de comer a los gatos mañana, comprar pan y llamar al dentista el viernes"
//       → 3 tasks, with dates resolved and a kind assigned
//
// ── Why deterministic-first ──────────────────────────────────────
// A phone-captured thought ("comprar pan mañana") is exactly the input
// a user will type while walking. Round-tripping that to a paid LLM on
// every capture is slow, costs money per note, and is unreliable when
// the phone is out of signal — which is when people capture most of
// these. So the parser handles the overwhelming majority of real
// captures with plain string work, and the LLM is only asked to handle
// the residue: ambiguous phrasing, dates it cannot resolve, or
// questions that are not tasks at all.
//
// Every result carries `how` so the UI can say honestly whether a task
// came from a rule or from a model:
//
//   { text, kind, due, priority, subject, how: "rule" | "llm" | "llm+rule" }
//
// A `kind` is what lets the same capture feed three different screens:
//   task     — a one-off to do
//   habit    — recurring ("ir al gimnasio", "leer 20 min")
//   shopping — a thing to acquire ("comprar pan", "necesitoickets")
//   expense  — money out ("pagué 40€ de luz", "me debe 15")
//   event    — a time-bound appointment, not an action

import { generateCompletion } from "./aiProviders.js";
import { logOp } from "../utils/log.js";

export type TaskKind = "task" | "habit" | "shopping" | "expense" | "event";

export interface ExtractedTask {
  text: string;
  kind: TaskKind;
  /** Epoch ms, or null when no date could be resolved. */
  due: number | null;
  priority: 0 | 1 | 2;
  subject: string;
  /** Where the decision came from. Never a lie about the LLM. */
  how: "rule" | "llm" | "llm+rule";
  /** For `expense`: the amount in cents, when one could be read. */
  amountCents?: number;
  /** For `habit`: the cadence phrase that was recognised. */
  cadence?: string;
}

export interface ExtractResult {
  tasks: ExtractedTask[];
  /** True when the LLM was consulted at all. */
  usedLlm: boolean;
  /** Present when the LLM path failed; the rule result is still valid. */
  llmError?: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ *
 * 0. Word boundaries that survive accents
 * ------------------------------------------------------------------ */

/**
 * JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so `é` is a
 * NON-word character. That makes `\bpagu[eé]\b` fail against "pagué":
 * the character before the boundary is `é` (non-word) and the one after
 * is a space (non-word), so there is no boundary to assert. Every
 * Spanish keyword with an accent — pagué, gasté, hábitos, miércoles —
 * was silently unreachable.
 *
 * This wraps a pattern in Unicode-aware assertions that treat any
 * letter or digit as a word character.
 */
const LETTER = "[\\p{L}\\p{N}]";
/** Wrap a pattern so it is bounded by "not a letter/digit" on both sides. */
function w(pattern: string): string {
  return `(?<!${LETTER})(?:${pattern})(?!${LETTER})`;
}

/* ------------------------------------------------------------------ *
 * 1. Splitting a blob into candidate items
 * ------------------------------------------------------------------ */

/**
 * Words that begin a new item after a comma, an "y", or a newline.
 *
 * This is the whole classification vocabulary, not just the common
 * verbs: "comprar pan, pagué 40€ de luz" has to break on the comma even
 * though "pagué" is not a verb anyone would think to list.
 */
const ACTION = [
  "comprar", "necesito", "conseguir", "adquirir", "llamar", "escribir", "enviar",
  "mandar", "poner", "firmar", "buscar", "revisar", "recordar", "pedir", "entregar",
  "imprimir", "traer", "hacer", "arreglar", "pagar", "ir a", "ir al", "quedar",
  "pagué", "pague", "pagado", "gasté", "gaste", "gastado", "costó", "coste",
  "costo", "me debe", "debo", "cargar", "abono", "transferencia", "recibí",
  "recibi", "cobrar", "nómina", "nomina", "salario",
  "gimnasio", "correr", "nadar", "meditar", "leer", "estudiar", "practicar",
  "entrenar", "todos los días", "cada día", "diariamente",
  "cita", "reunión", "reunion", "entrevista", "examen", "videollamada",
  "conferencia", "clase", "reservar", "a las",
].join("|");

/**
 * Split a capture blob into candidate items.
 *
 * Commas and newlines are the obvious separators, but Spanish lists are
 * usually "comprar pan y llamar al dentista" — an "y" joining two verbs
 * with no comma. Splitting on a bare " y " would shred "pan y huevos"
 * into two groceries, so "y" only splits when the right-hand side
 * actually begins a new action.
 */
export function splitInput(input: string): string[] {
  const parts = input.split(
    new RegExp(
      "[;\\n]+" +
      "|,(?=\\s*(?:" + ACTION + ")(?!\\p{L}))" +
      "|\\s+y\\s+(?=(?:" + ACTION + ")(?!\\p{L}))",
      "iu",
    ),
  );
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim().replace(/^[-*•]\s*/, "").replace(/\s+/g, " ");
    if (t.length > 1) out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Date resolution
 * ------------------------------------------------------------------ */

interface DateHit {
  due: number | null;
  /** The span consumed, so it can be stripped from the task text. */
  matched: string;
}

const DAY = 86_400_000;

/** Start of the local day `n` days from today. */
function dayAt(offset: number, from: number): number {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offset * DAY;
}

function nextWeekday(target: number, from: number): number {
  const d = new Date(from);
  const diff = (target - d.getDay() + 7) % 7 || 7;
  return dayAt(diff, from);
}

const MONTHS: Record<string, number> = {
  ene: 0, enero: 0, jan: 0, january: 0,
  feb: 1, febrero: 1, february: 1,
  mar: 2, marzo: 2, march: 2,
  abr: 3, abril: 3, april: 3,
  may: 4, mayo: 4, may_: 4,
  jun: 5, junio: 5, june: 5,
  jul: 6, julio: 6, july: 6,
  ago: 7, agosto: 7, august: 7,
  sep: 8, sept: 8, septiembre: 8, september: 8,
  oct: 9, octubre: 9, october: 9,
  nov: 10, noviembre: 10, november: 10,
  dic: 11, diciembre: 11, december: 11,
};

const DOW: Record<string, number> = {
  domingo: 0, dom: 0, sun: 0, sunday: 0,
  lunes: 1, lun: 1, mon: 1, monday: 1,
  martes: 2, mar: 2, tue: 2, tuesday: 2,
  miercoles: 3, miércoles: 3, mierc: 3, wed: 3, wednesday: 3,
  jueves: 4, jue: 4, thu: 4, thursday: 4,
  viernes: 5, vie: 5, fri: 5, friday: 5,
  sabado: 6, sabado_: 6, sábado: 6, sab: 6, sat: 6, saturday: 6,
};

/**
 * Find a date expression. Order matters: the longer patterns are tried
 * first so "12 de marzo" is not consumed as "12" + junk.
 */
export function findDate(text: string, now: number = Date.now()): DateHit {
  const t = text.toLowerCase();

  // ISO-ish: 12/03, 12-03, 2026-03-12
  let m = t.match(new RegExp(w(`(\\d{4})-(\\d{1,2})-(\\d{1,2})`), "iu"));
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return { due: d.getTime(), matched: m[0] };
  }
  m = t.match(new RegExp(w(`(\\d{1,2})[/](\\d{1,2})`), "iu"));
  if (m) {
    const d = new Date(now);
    d.setMonth(Number(m[2]) - 1, Number(m[1]));
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < now) d.setFullYear(d.getFullYear() + 1);
    return { due: d.getTime(), matched: m[0] };
  }

  // "12 de marzo", "12 de marzo de 2027"
  m = t.match(new RegExp(w(`(\\d{1,2})(?:\\s+de)?\\s+([a-zñ_]{3,10})\\.?(?:\\s+de\\s+(\\d{4}))?`), "iu"));
  if (m && MONTHS[m[2]] !== undefined) {
    const year = m[3] ? Number(m[3]) : new Date(now).getFullYear();
    const d = new Date(year, MONTHS[m[2]], Number(m[1]));
    if (!isNaN(d.getTime())) {
      if (!m[3] && d.getTime() < dayAt(0, now)) d.setFullYear(d.getFullYear() + 1);
      return { due: d.getTime(), matched: m[0] };
    }
  }

  // Relative: hoy, mañana, pasado mañana, en N días
  if (new RegExp(w(`pasado\\s+mañana`), "iu").test(t)) return { due: dayAt(2, now), matched: "pasado mañana" };
  if (new RegExp(w(`mañana`), "iu").test(t)) return { due: dayAt(1, now), matched: "mañana" };
  if (new RegExp(w(`hoy`), "iu").test(t)) return { due: dayAt(0, now), matched: "hoy" };

  m = t.match(new RegExp(w(`en\\s+(\\d{1,3})\\s+d[ií]as?`), "iu"));
  if (m) return { due: dayAt(Number(m[1]), now), matched: m[0] };

  m = t.match(new RegExp(w(`(?:en\\s+)?(\\d{1,2})\\s+semanas?`), "iu"));
  if (m) return { due: dayAt(Number(m[1]) * 7, now), matched: m[0] };

  // Weekdays: bare or prefixed
  m = t.match(new RegExp(w(`(?:el\\s+|este\\s+|pr[oó]ximo\\s+|next\\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|mon|tue|wed|thu|fri|sat|sun)`), "iu"));
  if (m && DOW[m[1]] !== undefined) {
    return { due: nextWeekday(DOW[m[1]], now), matched: m[0] };
  }

  m = t.match(new RegExp(w(`(?:la\\s+)?semana que viene|next week`), "i"));
  if (m) return { due: dayAt(7, now), matched: m[0] };

  return { due: null, matched: "" };
}

/* ------------------------------------------------------------------ *
 * 3. Kind classification
 * ------------------------------------------------------------------ */

/**
 * Classification rules, most specific first.
 *
 * Each pattern is a source string passed through `w()` at module load,
 * because the plain-literal form cannot express a boundary that survives
 * an accent — see the note on `w` above.
 */
const RULES: Array<{ kind: TaskKind; re: RegExp; priority?: 0 | 1 | 2; subject?: string; cadence?: string }> = [
  // expense first: "comprar pan" and "pagué 40" both start with a verb,
  // and a receipt is a fact rather than something to do.
  { kind: "expense", re: new RegExp(w(`pagu[eé]|pagado|gast[eé]|gastado|cost[oó]|me\s+debe|debo\s+a|debo|cargar|abono|transferencia`), "iu"), priority: 1, subject: "dinero" },
  { kind: "expense", re: new RegExp(w(`(?:\d+[.,]?\d*)\s*(?:€|eur|euros?|\$|usd|£|gbp)`), "iu"), priority: 1, subject: "dinero" },
  { kind: "expense", re: new RegExp(w(`recib[ií]|ingreso|entra(?:n)?|n[oó]mina|salario|cobrar`), "iu"), priority: 1, subject: "dinero" },

  { kind: "shopping", re: new RegExp(w(`comprar|necesito|ha[cz]me\s+falta|falta(?:n)?|conseguir|adquirir`), "iu"), subject: "compras" },
  { kind: "shopping", re: new RegExp(w(`pan|leche|huevos|caf[eé]|arroz|pasta|jab[oó]n|gel|champ[uú]|papel\s+higi[eé]nico|lej[ií]a|aceite|queso|pollo|carne|verdura|fruta`), "iu"), subject: "compras" },

  { kind: "habit", re: new RegExp(w(`ir\s+al\s+gimnasio|gimnasio|gym|correr|patinar|nadar|meditar|leer|estudiar|practicar|entrenar`), "iu"), subject: "hábitos", cadence: "diaria" },
  { kind: "habit", re: new RegExp(w(`(?:todos\s+los\s+d[ií]as|cada\s+d[ií]a|diariamente|a\s+diario|cada\s+semana)`), "iu"), subject: "hábitos", cadence: "diaria" },

  { kind: "event", re: new RegExp(w(`cita|reuni[oó]n|entrevista|examen|ex[aá]men|videollamada|conferencia|clase|acto|partido|reservar`), "iu"), priority: 1 },
  { kind: "event", re: new RegExp(w(`a\s+las\s+\d{1,2}`), "iu"), priority: 1 },

  { kind: "task", re: new RegExp(w(`llamar|escribir|enviar|mandar|recordar|firmar|revisar|buscar|pedir|poner|apagar|recoger|terminar|imprimir|pagar|traer|llevar|hacer|arreglar|entregar|comprar`), "iu"), priority: 2 },
];

const URGENT = new RegExp(w(`urgente|ahora|importante|critical|prioridad|asap`), "iu");
const SUBJECT_HINT = /\b(universidad|clase|examen|profes|trabajo|empresa|reunión|medicina|física|química|matemáticas|biología|historia|lengua|inglés|derecho|economía|nutrición)\b/i;

/** Read an amount in euros/dollars and return cents. */
export function parseAmount(text: string): number | undefined {
  const m = text.match(new RegExp(w(`(\\d{1,6}(?:[.,]\\d{1,2})?)\\s*(?:€|eur|euros?|\\$|usd|£|gbp)?`), "iu"));
  if (!m) return undefined;
  const raw = m[1].replace(",", ".");
  const value = Number(raw);
  if (!isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

/** Classify one item with the rule table. */
function classifyRule(text: string): Omit<ExtractedTask, "text" | "due" | "how"> {
  for (const r of RULES) {
    if (r.re.test(text)) {
      return {
        kind: r.kind,
        priority: r.priority ?? (URGENT.test(text) ? 2 : 1),
        subject: r.subject ?? "",
        ...(r.cadence ? { cadence: r.cadence } : {}),
      };
    }
  }
  return {
    kind: "task",
    priority: URGENT.test(text) ? 2 : 1,
    subject: "",
  };
}

/** A guess at the subject, for search and grouping. */
function guessSubject(text: string, classified: string): string {
  if (classified) return classified;
  const m = text.match(SUBJECT_HINT);
  if (m) return m[1].toLowerCase();
  return "";
}

/* ------------------------------------------------------------------ *
 * 4. The deterministic pass
 * ------------------------------------------------------------------ */

export function extractDeterministic(input: string, now: number = Date.now()): ExtractedTask[] {
  return splitInput(input).map((item) => {
    const hit = findDate(item, now);
    // Strip the consumed date phrase so the title reads cleanly.
    let text = item;
    if (hit.matched) {
      text = text.replace(new RegExp(hit.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim();
      text = text.replace(/^[,;:.\s]+|[,;:.\s]+$/g, "").replace(/\s{2,}/g, " ");
    }
    if (!text) text = item;

    const base = classifyRule(text);
    const kind = base.kind;
    return {
      text,
      kind,
      due: hit.due,
      priority: base.priority,
      subject: guessSubject(text, base.subject),
      how: "rule" as const,
      ...(kind === "expense" && parseAmount(text) !== undefined
        ? { amountCents: parseAmount(text) }
        : {}),
      ...(base.cadence ? { cadence: base.cadence } : {}),
    };
  });
}

/* ------------------------------------------------------------------ *
 * 5. The LLM pass — only for what the rules could not settle
 * ------------------------------------------------------------------ */

const LLM_SYSTEM = `Eres un extractor de tareas. Recibes un texto libre en español o inglés.
Devuelve SOLO JSON, sin texto alrededor, con esta forma:
{"tasks":[{"text":"...","kind":"task|habit|shopping|expense|event","due":"YYYY-MM-DD o null","priority":0|1|2,"subject":"..."}]}
Reglas:
- Separa en tareas independientes. Una frase puede dar varias.
- "text" es la tarea sin la fecha (la fecha va en "due").
- "due" en formato YYYY-MM-DD, o null si no se menciona ninguna.
- "kind": task (acción puntual), habit (recurrente), shopping (comprar algo), expense (dinero), event (cita con hora).
- Si el texto NO contiene ninguna tarea, devuelve {"tasks":[]}.`;

function parseLlmJson(raw: string): any | null {
  // Models wrap JSON in prose and fences more often than not.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normaliseLlmTask(t: any, fallbackText: string, now: number): ExtractedTask | null {
  const text = String(t?.text ?? "").trim() || fallbackText;
  if (!text) return null;
  const kind: TaskKind = ["task", "habit", "shopping", "expense", "event"].includes(t?.kind)
    ? t.kind
    : "task";
  let due: number | null = null;
  if (typeof t?.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due)) {
    const d = new Date(t.due + "T00:00:00");
    if (!isNaN(d.getTime())) due = d.getTime();
  } else if (typeof t?.due === "number" && t.due > 0) {
    due = t.due;
  }
  return {
    text,
    kind,
    due,
    priority: [0, 1, 2].includes(t?.priority) ? t.priority : 1,
    subject: String(t?.subject ?? "").trim(),
    how: "llm",
  };
}

export interface ExtractOptions {
  /** Consult the model for the parts the rules could not settle. */
  useLlm?: boolean;
  now?: number;
  /** Injectable for tests. */
  llm?: (prompt: string) => Promise<string>;
}

/**
 * Extract tasks from free text.
 *
 * The rule pass always runs. The LLM runs only when `useLlm` is set and
 * either (a) the input is long enough that splitting is genuinely
 * ambiguous, or (b) at least one item came back with no date and no
 * recognised kind signal. In that case items the model returns replace
 * the rule items 1:1, and `how` records that the model was involved.
 */
export async function extractTasks(input: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const rules = extractDeterministic(input, now);
  const trimmed = String(input ?? "").trim();

  if (!trimmed) {
    return { tasks: [], usedLlm: false, durationMs: Date.now() - t0 };
  }

  // Nothing the rules could not handle → no reason to spend a completion.
  const needsHelp =
    trimmed.length > 220 ||
    rules.length === 0 ||
    rules.some((r) => r.due === null && !r.subject && r.kind === "task" && r.text.length > 40);

  if (!opts.useLlm || !needsHelp) {
    logOp("extract", "rules", true, { n: rules.length, llm: false, ms: Date.now() - t0 });
    return { tasks: rules, usedLlm: false, durationMs: Date.now() - t0 };
  }

  try {
    const call = opts.llm ?? ((p: string) => generateCompletion(p, { system: LLM_SYSTEM, temperature: 0.1 }));
    const raw = await call(`${LLM_SYSTEM}\n\nTexto:\n${trimmed}`);
    const parsed = parseLlmJson(raw);
    if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      // The model said there is nothing here. If the rules found
      // something concrete, the rules win; if neither found anything,
      // an empty result is the honest answer.
      logOp("extract", "llm empty", true, { ms: Date.now() - t0 });
      return { tasks: rules, usedLlm: true, durationMs: Date.now() - t0 };
    }
    const merged = parsed.tasks
      .map((t: any, i: number) => normaliseLlmTask(t, rules[i]?.text ?? "", now))
      .filter(Boolean) as ExtractedTask[];
    // Preserve whatever the rules knew that the model dropped.
    for (let i = 0; i < merged.length; i++) {
      const r = rules[i];
      if (!r) continue;
      if (merged[i].due === null && r.due !== null) {
        merged[i].due = r.due;
        merged[i].how = "llm+rule";
      } else if (merged[i].kind === "task" && r.kind !== "task") {
        merged[i].kind = r.kind;
        merged[i].how = "llm+rule";
        if (r.amountCents) merged[i].amountCents = r.amountCents;
      }
    }
    logOp("extract", "llm", true, { n: merged.length, ms: Date.now() - t0 });
    return { tasks: merged, usedLlm: true, durationMs: Date.now() - t0 };
  } catch (e: any) {
    // The model is optional. The rules already produced a usable answer.
    logOp("extract", "llm failed", false, { error: String(e?.message ?? e) });
    return {
      tasks: rules,
      usedLlm: true,
      llmError: String(e?.message ?? e),
      durationMs: Date.now() - t0,
    };
  }
}
