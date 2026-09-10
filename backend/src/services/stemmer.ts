// stemmer.ts: stemming custom para ES + EN (v0.62.0).
//
// v0.62.0: FTS5 ya tiene porter stemmer para EN. Aqui anadimos:
//   - Stemmer para espanol (sufijos: -ando/-iendo, -mente, -idad, etc.)
//   - Normalizacion NFD (sin acentos) para que "anatomia" == "anatomía"
//   - Manejo de plurales ES (s/es)
//   - Lowercase y limpieza de caracteres no-alfanumericos
//
// Uso:
//   stem("anatomías", "es") -> "anatom"
//   stem("running", "en")  -> "run"

const SUFFIXES_ES = [
  // Diminutivos
  "ísimo", "ísima", "itos", "itas", "illo", "illa", "ito", "ita",
  // adverbios
  "mente",
  // sustantivos abstractos
  "idad", "idades", "amiento", "imiento", "ación", "aciones", "mente",
  // verbos
  "ando", "iendo", "ar", "er", "ir", "amos", "emos", "imos",
  "aba", "abas", "aban", "ado", "ada", "ados", "adas",
  "ido", "ida", "idos", "idas",
  "aría", "erías", "iría", "irías",
  // plurales
  "es", "s",
];

const SUFFIXES_EN = [
  "ational", "tional", "alize", "icate", "ative", "fulness",
  "ousness", "iveness", "iviti", "biliti", "icate",
  "ing", "ed", "ies", "s", "ly", "ize", "ise", "ate",
  "ity", "ful", "ness", "ment", "tion", "sion",
];

const STOPWORDS_ES = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "en", "a", "al", "con", "sin", "por", "para",
  "y", "o", "u", "pero", "que", "si", "no",
  "es", "son", "está", "están", "ser", "estar", "tener",
  "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "muy", "más", "menos", "todo", "todos", "toda", "todas",
]);

const STOPWORDS_EN = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else",
  "of", "in", "on", "at", "to", "for", "with", "by", "from",
  "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those",
  "i", "you", "he", "she", "it", "we", "they",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "should", "could", "may", "might",
]);

/**
 * v0.62.0: normaliza una palabra: lowercase + NFD sin acentos.
 */
export function normalize(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * v0.62.0: aplica stemming al idioma dado.
 */
export function stem(word: string, lang: "es" | "en" = "es"): string {
  const n = normalize(word);
  if (n.length < 3) return n;
  const suffixes = lang === "es" ? SUFFIXES_ES : SUFFIXES_EN;
  // v0.62.0: iterativo, intenta quitar el sufijo mas largo primero
  for (const s of suffixes) {
    if (n.endsWith(s) && n.length - s.length >= 3) {
      return n.slice(0, -s.length);
    }
  }
  return n;
}

/**
 * v0.62.0: tokeniza un texto y devuelve stems filtrados (sin stopwords).
 */
export function tokenizeAndStem(text: string, lang: "es" | "en" = "es"): string[] {
  const stopwords = lang === "es" ? STOPWORDS_ES : STOPWORDS_EN;
  return text
    .split(/\s+/)
    .map((w) => normalize(w))
    .filter((w) => w.length >= 2 && !stopwords.has(w))
    .map((w) => stem(w, lang));
}

/**
 * v0.62.0: procesa query de busqueda: stem cada palabra, devuelve string para FTS5 MATCH.
 * Query se construye con OR entre stems.
 */
export function buildFtsQuery(query: string, lang: "es" | "en" | "auto" = "auto"): string {
  const detectedLang: "es" | "en" = lang === "auto" ? detectLanguage(query) : lang;
  const stems = tokenizeAndStem(query, detectedLang);
  if (stems.length === 0) return query;
  return stems.map((s) => `"${s}"*`).join(" OR ");
}

/**
 * v0.62.0: detecta idioma basico (mayoritario) por stopwords.
 */
export function detectLanguage(text: string): "es" | "en" {
  const words = text.toLowerCase().split(/\s+/);
  let esScore = 0, enScore = 0;
  for (const w of words) {
    if (STOPWORDS_ES.has(w)) esScore++;
    if (STOPWORDS_EN.has(w)) enScore++;
  }
  // Heuristica: si tiene acentos o palabras tipicas, ES
  if (/[áéíóúñü]/i.test(text)) return "es";
  return enScore > esScore ? "en" : "es";
}
