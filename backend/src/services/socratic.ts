// socratic.ts — el tutor que no da la respuesta.
//
// v2.38.10
//
// Una tarjeta de anverso-frente y una de Socrático parecen lo mismo y no lo
// son. La primera te dice "CFTR está en el cromosoma 7" y tú lo
// memorizas. La segunda te hace decir por qué, te devuelve "vale, pero
// ¿y si está en el 11?" y te obliga a sostener el razonamiento.
//
// El problema conocido de esto, y la razón de que la mayoría de
// implementaciones sean unチャット: comparar la respuesta del usuario
// con la de referencia. Pero comparar textos palabra a palabra no dice
// nada útil —"está en el 7" contra "cromosoma 7" puntúa cero— y con un
// LLM es caro, lento y no reproducible.
//
// Aquí la comparación es de tres capas y va de la más barata a la más
// cara, parando en cuanto hay confianza:
//
//   1. ¿Acierta los términos clave?        determinista, gratis
//   2. ¿Dice lo mismo con otras palabras?  sinónimos y frases
//   3. ¿El razonamiento se sostiene?        solo aquí, y solo si hay
//                                           modelo; sin modelo, se dice
//
// El paso 3 es el único que necesita LLM, y se salta entero cuando no
// hay uno. Es peor que con modelo, y se dice en la respuesta en vez de
// fingir.
//
// Lo que se guarda no es la nota: es la brecha. Qué términos de la
// respuesta de referencia no han salido en la del usuario. Eso es lo
// que entra en el diagnóstico.

import { contentWords, normalise } from "./resourceIndex.js";

export type SocraticVerdict =
  | "correct" // está, y además lo explica
  | "partial" // está el dato, falta el porqué
  | "inverted" // el dato está pero en el lado equivocado
  | "empty" // no ha dicho nada
  | "unrelated"; // palabras sueltas sin relación

export interface Reference {
  /** La respuesta estándar, tal cual está en el material. */
  answer: string;
  /** Términos que no pueden faltar para darlo por bueno. */
  mustInclude?: string[];
  /** Lo que NO puede decir, para detectar el modelo invertido. */
  mustNot?: string[];
  /** Sinónimos: cada grupo cuenta como uno. */
  synonyms?: string[][];
  /** De dónde sale: para poder citarlo. */
  source?: { noteId?: string; docId?: string; page?: number; title?: string };
}

export interface SocraticVerdictDetail {
  verdict: SocraticVerdict;
  score: number;
  /** Términos clave que el usuario no ha dicho. */
  missing: string[];
  /** Lo que ha dicho de más o de forma contradictoria. */
  wrong: string[];
  /** Términos que sí ha acertado, para no repetir lo mismo. */
  hit: string[];
  /** Capa que decidió. */
  decidedAt: 1 | 2 | 3;
  /** Texto que se le enseña al usuario. */
  followUp: string;
}

/**
 * Trocea una respuesta de referencia en términos clave. Por comas,
 * punto y coma y "y" — las tres cosas por las que la gente separa
 * conceptos cuando los escribe. Una frase corrida da mejor las cosas
 * como un bloque, pero una lista da mejor los atomos.
 */
export function splitKeyTerms(answer: string): string[] {
  const parts = answer
    .split(/[,;]|\sy\s|\s(?:e|o)\s/i)
    .map((part) => part.replace(/^\s*(y|e|o)\s+/i, "").trim())
    .filter((part) => part.length > 1);

  // v2.38.10 — una respuesta sin comas ni "y" se queda como un solo
  // bloque, y comparar contra un bloque entero exige decirla igual que
  // el profesor, tildes y orden incluidos. "Es una enfermedad recesiva
  // de tipo genetico" puntua 0 contra "una enfermedad genetica
  // autosomica recesiva", que es lo mismo.
  //
  // Cuando el bloque es largo, se añaden también sus palabras de
  // contenido como términos sueltos. El estudiante puede acertar
  // algunas y no otras, y ese matiz es justo el que dice algo.
  if (parts.length === 1 && contentWords(parts[0]).length > 3) {
    return [...parts, ...contentWords(parts[0])];
  }
  return parts;
}

const HEDGES = [
  "creo", "no se", "nose", "quizá", "quiza", "algo", "mismo", "parecido",
  "tipo", "no me acuerdo", "no se", "vale", "a ver",
];

/**
 * Capa 1 y 2: comparación determinista.
 *
 * Devuelve null si la confianza es tan baja que no compensa seguir,
 * que es lo que pasa con una respuesta de dos palabras.
 */
export function compare(user: string, ref: Reference): SocraticVerdictDetail | null {
  const u = normalise(user);
  if (!u || contentWords(user).length < 1) {
    return {
      verdict: "empty", score: 0, missing: ref.mustInclude ?? [], wrong: [], hit: [],
      decidedAt: 1, followUp: "No has dicho nada todavía. ¿Por dónde empezarías?",
    };
  }

  // Los términos clave son los de la respuesta de referencia, o los
  // que el autor marcó, o un resumen: la referencia manda.
  // La referencia puede traer los términos como lista o como frase: las
  // dos formas son legitimas y el autor no tiene por qué saber cual.
  const rawMust: string[] = ref.mustInclude?.length
    ? [...ref.mustInclude]
    : [ref.answer].flatMap((a) => splitKeyTerms(a));
  const must = rawMust
    .filter(Boolean)
    .map((t) => normalise(t))
    .filter((t) => t.length > 1);

  const groups = (ref.synonyms?.length ? ref.synonyms : []).map((g) => g.map((t) => normalise(t)));

  const hit: string[] = [];
  const missing: string[] = [];
  for (const t of must) {
    const alt = groups.find((g) => g.some((x) => u.includes(x)))?.find((x) => u.includes(x));
    if (u.includes(t) || alt) hit.push(t);
    else missing.push(t);
  }

  // La respuesta invertida: se ha dicho algo, pero se ha dicho lo
  // contrario de lo que dice la referencia. Es el error que más cuesta
  // quitar de la cabeza, y aquí se confunde con un fallo normal si no
  // se mira aparte.
  const wrong: string[] = [];
  for (const t of ref.mustNot ?? []) {
    const n = normalise(t);
    if (n && u.includes(n)) wrong.push(n);
  }

  const total = must.length || 1;
  const score = hit.length / total;
  const hedged = HEDGES.some((h) => u.includes(h));

  let verdict: SocraticVerdict;
  let decidedAt: 1 | 2 = 1;
  if (score >= 0.75) verdict = "correct";
  else if (score >= 0.4) verdict = "partial";
  else if (score > 0 || wrong.length) verdict = "unrelated";
  else verdict = "unrelated";
  if (wrong.length && score < 0.5) verdict = "inverted";

  // Poca sustancia: mejor no dar un veredicto sobre media palabra. El
  // "empty" ya se ha resuelto antes de llegar aquí, así que no puede
  // volver a salir y la comprobación solo mira el largo.
  if (contentWords(user).length < 4) {
    return {
      verdict, score, missing, wrong, hit, decidedAt,
      followUp:
        "Con eso no puedo decirte si está bien. Cuéntame por qué, no solo qué: ¿cómo lo deduces?",
    };
  }

  return {
    verdict,
    score,
    missing,
    wrong,
    hit,
    decidedAt,
    followUp: followUpFor(verdict, hit, missing, wrong, hedged),
  };
}

/** La pregunta que sigue. Nunca da la respuesta, siempre la empuja. */
function followUpFor(
  v: SocraticVerdict,
  hit: string[],
  missing: string[],
  wrong: string[],
  hedged: boolean,
): string {
  switch (v) {
    case "correct":
      return hedged
        ? "Vale, lo has dicho. Pero has dicho «creo». ¿Qué te haría dudar? Porque la duda es justo lo que se te va a olvidar."
        : "Correcto. Y el porqué: ¿por qué es así y no de otra manera? Si lo supieras explicar, no se te olvidaría.";
    case "partial":
      return `Tienes ${hit.length} de ${hit.length + missing.length} cosas. ¿Y ${missing[0]}? Piénsalo: no te estoy pidiendo que lo sepas, te estoy pidiendo que lo deduzcas.`;
    case "inverted":
      return `Has dicho ${wrong[0]}, y no es eso. No está mal el razonamiento: está empezando por el sitio equivocado. ¿Y qué pasaría si fuera al revés?`;
    case "empty":
      return "¿Por dónde empezarías? Con lo que se te ocurra, aunque parezca tonto.";
    default:
      return "No me suena a lo mismo. ¿Me lo dices de otra forma, con tus palabras? Si no lo sabes, dímelo y te pregunto otra cosa.";
  }
}

// ---------------------------------------------------------------------------
// La brecha: lo que se guarda
// ---------------------------------------------------------------------------

export interface SocraticGap {
  noteId: string;
  cardId?: string;
  /** Términos de la referencia que no salieron. */
  missing: string[];
  /** Lo que se dijo al revés. */
  wrong: string[];
  attempts: number;
  lastAt: number;
  /** 0..1: cuánto se acerca. */
  best: number;
}

export function recordGap(
  prev: SocraticGap | null,
  d: SocraticVerdictDetail,
  ref: { noteId: string; cardId?: string },
  now = Date.now(),
): SocraticGap {
  return {
    noteId: ref.noteId,
    cardId: ref.cardId,
    missing: d.verdict === "correct" ? [] : [...new Set([...(prev?.missing ?? []), ...d.missing])],
    wrong: [...new Set([...(prev?.wrong ?? []), ...d.wrong])],
    attempts: (prev?.attempts ?? 0) + 1,
    lastAt: now,
    best: Math.max(prev?.best ?? 0, d.score),
  };
}

// ---------------------------------------------------------------------------
// La capa 3: la que necesita modelo
// ---------------------------------------------------------------------------

/**
 * Evaluar el razonamiento, no el dato. Solo esto necesita un LLM, y sin
 * modelo no se hace: se devuelve null y quien llama lo explica. Un
 * "has razonado bien" inventado es peor que un "no puedo juzgar el
 * razonamiento sin modelo".
 */
export async function judgeReasoning(
  user: string,
  ref: Reference,
  callLlm: ((prompt: string) => Promise<string>) | null,
): Promise<{ ok: boolean; why: string; usedLlm: boolean }> {
  if (!callLlm) {
    return {
      ok: false,
      why: "Sin modelo de lenguaje no se puede juzgar si el razonamiento se sostiene: solo se comprueban los términos.",
      usedLlm: false,
    };
  }
  try {
    const why = await callLlm(
      `Responde solo con sí o no, y en una frase por qué.\n` +
      `Pregunta de referencia: ${ref.answer}\n` +
      `Lo que ha dicho el estudiante y su explicación: ${user}\n` +
      `¿El razonamiento que ha dado lleva a la respuesta correcta, aunque no haya listado los términos?`,
    );
    return { ok: /^(si|sí|yes)/i.test(why.trim()), why: why.slice(0, 300), usedLlm: true };
  } catch (e) {
    return { ok: false, why: `El modelo falló: ${(e as Error).message}`, usedLlm: false };
  }
}
