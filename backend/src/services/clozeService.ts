// clozeService.ts: parser y generador de cloze deletion cards (Fase 3.A).
//
// v0.46: implementación completa de cloze deletion estilo Anki.
//
// Sintaxis: {{c1::texto oculto}} o {{c1::texto::hint}}
// - c1, c2, c3...: número de cloze (mismo número = misma card)
// - texto: lo que se oculta
// - hint (opcional): pista que se muestra

export interface ClozeInfo {
  /** Número del cloze (1, 2, 3...) */
  number: number;
  /** Texto oculto (respuesta) */
  hidden: string;
  /** Hint opcional */
  hint?: string;
  /** Posición en el texto */
  start: number;
  /** Longitud del match completo ({{c1::...}}) */
  fullLength: number;
  /** Texto del match completo */
  raw: string;
}

export interface ClozeCard {
  /** Número del cloze (cada cloze genera una card separada) */
  number: number;
  /** Texto completo con la respuesta visible (para mostrar en el "front") */
  textWithAnswer: string;
  /** Texto con la respuesta oculta (para mostrar en el "back" / para revelar) */
  textWithCloze: string;
  /** Hint si existe */
  hint?: string;
}

const CLOZE_REGEX = /\{\{c(\d+)::([^}:]+)(?:::([^}]*))?\}\}/g;

export class ClozeService {
  /**
   * Extrae todos los clozes de un texto.
   */
  static parseCloze(content: string): ClozeInfo[] {
    const clozes: ClozeInfo[] = [];
    const regex = new RegExp(CLOZE_REGEX.source, "g");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      const [raw, numStr, hidden, hint] = m;
      clozes.push({
        number: parseInt(numStr, 10),
        hidden: hidden.trim(),
        hint: hint?.trim() || undefined,
        start: m.index,
        fullLength: raw.length,
        raw,
      });
    }
    return clozes;
  }

  /**
   * Genera las cards de cloze.
   * Cada cloze (por número) genera una card separada.
   * Si hay 3 cloze c1, c2, c3 → 3 cards distintas.
   * Si hay c1 dos veces → 1 card (unión de los textos).
   */
  static generateCards(content: string): ClozeCard[] {
    const clozes = ClozeService.parseCloze(content);
    if (clozes.length === 0) return [];

    // Agrupar por número
    const byNumber = new Map<number, ClozeInfo[]>();
    for (const c of clozes) {
      if (!byNumber.has(c.number)) byNumber.set(c.number, []);
      byNumber.get(c.number)!.push(c);
    }

    const cards: ClozeCard[] = [];
    for (const [number, group] of byNumber) {
      // Texto con respuesta visible (front)
      let textWithAnswer = content;
      // Reemplazar todos los clozoes (no solo este número) con respuesta
      for (const c of clozes) {
        const replacement = c.hint ? `**${c.hidden}** [${c.hint}]` : `**${c.hidden}**`;
        textWithAnswer = textWithAnswer.replace(c.raw, replacement);
      }
      // Texto con cloze (back) — ocultar SOLO los de este número, mostrar el resto
      let textWithCloze = content;
      for (const c of clozes) {
        const isThisCard = c.number === number;
        if (isThisCard) {
          const clozeText = c.hint ? `[...] (${c.hint})` : `[...]`;
          textWithCloze = textWithCloze.replace(c.raw, clozeText);
        } else {
          // Mostrar el otro cloze con respuesta visible
          textWithCloze = textWithCloze.replace(c.raw, c.hidden);
        }
      }
      // Hint de la card = hint del primer clozoe de este número
      const hint = group[0].hint;
      cards.push({ number, textWithAnswer, textWithCloze, hint });
    }
    return cards.sort((a, b) => a.number - b.number);
  }

  /**
   * Cuenta los clozoes únicos (por número).
   */
  static count(content: string): number {
    const clozes = ClozeService.parseCloze(content);
    const unique = new Set(clozes.map((c) => c.number));
    return unique.size;
  }

  /**
   * Valida que la sintaxis sea correcta.
   * Retorna lista de errores (pos + mensaje).
   */
  static validate(content: string): Array<{ position: number; message: string }> {
    const errors: Array<{ position: number; message: string }> = [];
    // Buscar {{c:: sin ::
    const broken = /\{\{c\d*::/g;
    let m: RegExpExecArray | null;
    while ((m = broken.exec(content)) !== null) {
      // Verificar que tenga cierre
      const start = m.index;
      const closeIdx = content.indexOf("}}", start);
      if (closeIdx === -1) {
        errors.push({ position: start, message: "Cloze abierto sin cerrar (falta '}}')" });
      }
    }
    // Buscar }} sin {{
    const orphan = /}}/g;
    while ((m = orphan.exec(content)) !== null) {
      const before = content.lastIndexOf("{{", m.index);
      if (before === -1) {
        errors.push({ position: m.index, message: "Cierre '}}' sin apertura '{{'" });
      }
    }
    // Números negativos o cero
    const badNum = /\{\{c(-?\d+)::/g;
    while ((m = badNum.exec(content)) !== null) {
      const n = parseInt(m[1], 10);
      if (n <= 0) {
        errors.push({ position: m.index, message: `Número de cloze inválido: ${n} (debe ser >= 1)` });
      }
    }
    return errors;
  }

  /**
   * Convierte un texto con clozoes a HTML/Markdown renderizable.
   */
  static toMarkdown(content: string, options: { showAnswers?: boolean } = {}): string {
    const showAnswers = options.showAnswers ?? false;
    return content.replace(CLOZE_REGEX, (_match, num, hidden, hint) => {
      if (showAnswers) {
        return hint ? `<span class="cloze-answer" data-n="${num}">**${hidden}** <em>(${hint})</em></span>` : `<span class="cloze-answer" data-n="${num}">**${hidden}**</span>`;
      } else {
        return hint ? `<span class="cloze-hidden" data-n="${num}">[...] (${hint})</span>` : `<span class="cloze-hidden" data-n="${num}">[...]</span>`;
      }
    });
  }
}
