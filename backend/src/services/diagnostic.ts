// diagnostic.ts — "¿qué sabes ya?" y, cuando la respuesta es no,
// el sondeo que encuentra exactamente qué te falta.
//
// v2.38.5
//
// El problema que resuelve: un usuario que abre una app de estudio no
// parte de cero ni parte de todo. Lo que hay que medir es el hueco, y
// medirlo cuesta. Casi todos los tests de nivelarden un solo intento:
// si acierto, sabe; si fallo, no. Eso mezcla tres cosas muy distintas
// —no saberlo, haberlo olvidado y no haberlo prestao atención— y
// deja al usuario sin saber por qué leixingen material que ya
// controlaba.
//
// Aqui el fallo no cierra nada: abre una excavación.
//
//   L0  pregunta directa, respuesta libre
//   L1  se estrecha: se pase de abierta a con opciones, o se da una pista
//   L2  se compara con material cercano del mismo tema, en vez de repetir
//       la misma pregunta, que solo mediría si memorizó la letra
//   L3  se discrimina: dos o tres preguntas de control distintas sobre
//       el mismo concepto, para separar "no sé esto" de "no sé este
//       tema" de "se me ha olvidado justo ahora"
//
// Lo que se aprende en el sondeo se devuelve a tres sitios:
//
//   · FSRS — un acierto en L3 vale mas que un acierto en L0, y un
//     fallo en L0 es un lapse, no un "visto"
//   · las tarjetas de drilling del tema, que vuelven a salir en cola
//   · el mapa de confianza del tema, que decide cuanto indagar la
//     proxima vez
//
// Y corre solo: se programa por examenes. Cuanto mas cerca esta el
// examen, mas sondajes y mas hondos, porque el tiempo que queda es el
// recurso escaso. Lejos del examen, un solo L0 por tema: medir es util
// pero no vale la pena sangrar la sesion de estudio por ello.

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Cuanto se ha cavado. Cada nivel mas profundo cuesta mas tiempo y dice mas. */
export type ProbeLevel = 0 | 1 | 2 | 3;

export type DiagnosticVerdict =
  | "known" // acierto en L0 o L1: no hay nada que excavar
  | "unstable" // acierto solo con pista: sabe, pero no la recall solo
  | "forgotten" // fallo en L0 y acierto en L2/L3: hueco, noabsence
  | "absent" // fallo hasta L3: el concepto no esta
  | "mismatched" // acierta el ejemplo y falla la regla: el modelo mental esta invertido

/** Lo que el sistema cree saber de un concepto. */
export interface KnowledgeEstimate {
  concept: string;
  /** 0 = nada, 1 = lo tiene. Es una probabilidad, no un nota. */
  p: number;
  /** Cuantas veces se ha medido. */
  observations: number;
  /** Ultimo veredicto y cuando. */
  lastVerdict: DiagnosticVerdict | null;
  lastSeenAt: number;
  /** Media de FSRS del concepto, si tiene tarjetas. 0 = sin datos. */
  fsrsMean: number;
}

export interface ProbeStep {
  level: ProbeLevel;
  /** Que se le pide exactamente. El frontend lo traduce a UI. */
  kind: "open" | "choice" | "pivot" | "control";
  question: string;
  options?: string[];
  hint?: string;
  /** Para L2: material del mismo tema contra el que comparar. */
  reference?: { cardId: string; front: string; back: string };
  /** Para L3: estos controles separan hueco de ausencia. */
  controls?: { id: string; question: string; options: string[] }[];
}

export interface ProbeSession {
  id: string;
  concept: string;
  folderId: string | null;
  level: ProbeLevel;
  steps: ProbeStep[];
  createdAt: number;
  /** Por que se ha cavado aqui y ahora. Se le enseña al usuario. */
  reason: ProbeReason;
  deadline: number;
}

export type ProbeReason =
  | "initial" // primera vez que se mide este concepto
  | "stale" // la ultima medida tiene ya cierta edad
  | "exam-near" // hay examen encima
  | "lapse" // acaba de fallar en revision normal
  | "drill" // vuelve por tarjetas de drilling del tema
  | "manual" // lo pidio el usuario

export interface ProbeResult {
  level: ProbeLevel;
  correct: boolean;
  /** Cuanto tardo. Un acierto de 4s y uno de 30s no son lo mismo. */
  ms: number;
  /** Confianza declarada por el usuario, si la dio. */
  confidence?: number;
}

export interface ProbeOutcome {
  verdict: DiagnosticVerdict;
  estimate: KnowledgeEstimate;
  /** Como hay que tocar FSRS por lo que se ha visto. */
  fsrs: FsrsAdjustment;
  /** Tarjetas que vuelven a la cola de estudio. */
  requeue: { cardId: string; why: "drill" | "relearn"; delayDays: number }[];
  /** El siguiente paso, o null si ya se ha tocado fondo. */
  next: ProbeStep | null;
  /** Lo que se le cuenta al usuario. Nunca "has fallado". */
  narrative: string;
}

export interface FsrsAdjustment {
  cardId: string | null;
  /** Rating para el scheduler: 1 = lapse, 2 = hard, 3 = good, 4 = easy. */
  rating: 1 | 2 | 3 | 4;
  /** Dias hasta la proxima vez, antes de que el scheduler opine. */
  delayDays: number;
  why: string;
}

export interface ExamWindow {
  id: string;
  title: string;
  folderId: string | null;
  /** ISO date. */
  date: string;
  topics: string[];
}

export interface DiagnosticPlan {
  /** Lo que toca hoy, en orden. */
  queue: { concept: string; folderId: string | null; reason: ProbeReason; level: ProbeLevel }[];
  /** Conceptos que ya se han medido hoy. */
  doneToday: string[];
  /** Proxima ventana de ejecucion programada. */
  nextRunAt: number;
  /** De donde sale la prioridad de cada uno. Para poder enseñarselo. */
  due: { concept: string; reason: ProbeReason; exam?: ExamWindow; daysToExam?: number }[];
}

export interface DiagnosticConfig {
  /** Dias desde hoy a partir de los cuales el examen empieza a tirar. */
  examHorizonDays: number;
  /** Cada cuanto se repite la medicion de un concepto, si nada lo exige antes. */
  restaleDays: number;
  /** Tope de conceptos por dia, para no comerse la sesion. */
  maxPerDay: number;
  /** Hora de la sesion programada (hora local del servidor). */
  dailyHour: number;
}

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

export const DEFAULT_DIAGNOSTIC_CONFIG: DiagnosticConfig = {
  examHorizonDays: 21,
  restaleDays: 45,
  maxPerDay: 6,
  dailyHour: 9,
};

// ---------------------------------------------------------------------------
// El arte de la excavacion
// ---------------------------------------------------------------------------

/**
 * Cuanto se cava segun lo que se sabe hasta ahora.
 *
 * No es un numero magico: sale de la combinacion de tres cosas que se
 * pueden mirar sin preguntar nada — la probabilidad de que lo sepa, si
 * hay un examen cerca, y si acaba de fallar en revision normal.
 */
export function chooseProbeLevel(
  estimate: KnowledgeEstimate,
  opts: { reason: ProbeReason; daysToExam?: number; lapseRecently?: boolean },
  config: DiagnosticConfig = DEFAULT_DIAGNOSTIC_CONFIG,
): ProbeLevel {
  if (opts.reason === "initial") return 2; // sin datos, no se gastan dos niveles en comprobar
  if (opts.reason === "manual") return 3;
  if (opts.reason === "lapse" || opts.lapseRecently) return 3;

  const horizon = opts.daysToExam ?? Infinity;
  if (horizon <= 3) return 3; // tres dias: o se sabe o hay que drillarla ya
  if (horizon <= 7) return 2;
  if (horizon <= config.examHorizonDays) return 1;

  // Sin examen cerca se mide barato: una comprobacion, no una excavacion.
  if (estimate.p >= 0.7) return 0;
  if (estimate.p >= 0.4) return 1;
  return 2;
}

/**
 * El paso siguiente. Cada nivel repregunta de otra manera a proposito:
 * repetir la misma pregunta mide si te sabias la formulacion, no el
 * concepto.
 */
export function nextStep(
  concept: string,
  level: ProbeLevel,
  ctx: {
    sameTopicCards: { cardId: string; front: string; back: string }[];
    controls: { id: string; question: string; options: string[] }[];
    lastWrong?: string;
  },
): ProbeStep | null {
  switch (level) {
    case 0:
      return { level: 0, kind: "open", question: `Define ${concept}.` };

    case 1:
      return {
        level: 1,
        kind: "choice",
        question: `¿Cuál de estas describe ${concept}?`,
        options: [ctx.lastWrong ?? "Ninguna de las anteriores", "Una definición correcta", "Una definición parcialmente correcta", "Una definición invertida"].filter(
          Boolean,
        ),
        hint: `Pista: empieza por la función, no por la estructura.`,
      };

    case 2: {
      // El pivote: no se repite la pregunta, se compara con algo
      // cercano. Fallar aqui con lo de al lado bien es informacion:
      // el concepto esta, la frontera no.
      const ref = ctx.sameTopicCards[0];
      if (!ref) return null;
      return {
        level: 2,
        kind: "pivot",
        question: `¿En qué se diferencia ${concept} de «${ref.front}»?`,
        options: [ref.back, "Son lo mismo", "Se complementan exactamente", "No tienen relación"],
        reference: ref,
      };
    }

    case 3: {
      if (!ctx.controls.length) return null;
      return {
        level: 3,
        kind: "control",
        question: `Tres preguntas de control sobre ${concept}. La primera que falles corta la excavación.`,
        controls: ctx.controls.slice(0, 3),
      };
    }

    default:
      return null;
  }
}

/**
 * Que significa lo que ha pasado, y que hay que hacer con FSRS.
 *
 * Aqui esta el juicio pedagogico, y conviene que sea explicito y
 * discutible: el nucleo de la idea es que un acierto en el fondo vale
 * mas que un acierto en la superficie, y que fallar la primera vez no
 * es lo mismo que no saber.
 */
export function judge(
  results: ProbeResult[],
  opts: { cardId: string | null; confidence?: number; pivotChoice?: string; referenceBack?: string },
  now: number = Date.now(),
): { verdict: DiagnosticVerdict; fsrs: FsrsAdjustment; requeue: ProbeOutcome["requeue"] } {
  const first = results[0];
  const deepest = results[results.length - 1];
  const correctAt = (lv: ProbeLevel) => results.find((r) => r.level === lv && r.correct);

  let verdict: DiagnosticVerdict;

  if (correctAt(0)) {
    verdict = "known";
  } else if (correctAt(1)) {
    verdict = "unstable";
  } else if (correctAt(2) || correctAt(3)) {
    verdict = "forgotten";
  } else {
    verdict = "absent";
  }

  // v2.38.5: modelo mental invertido. No sale de la cuenta de aciertos
  // sino de *que* fallo: si en el pivote (L2) se equivoco eligiendo la
  // opcion que era literalmente la definicion del concepto, no esta
  // despistado — ha invertido la regla y la sostiene con confianza. Un
  // mapa mental lo deshace; seguir repitiendo la misma pregunta no.
  if (verdict === "absent" && invertedAtL2(results, opts)) {
    verdict = "mismatched";
  }

  // Confianza mal calibrada: dice saberlo mucho y no lo sabe. Es la
  // senal mas util que existe, y la que menos se recoge, porque
  // cuestaButtons.
  const overconfident =
    opts.confidence !== undefined && opts.confidence >= 4 && verdict === "absent";

  let rating: 1 | 2 | 3 | 4;
  let delayDays: number;
  let why: string;

  switch (verdict) {
    case "known":
      rating = 3;
      delayDays = 0;
      why = "A la primera. El scheduler decide el intervalo.";
      break;
    case "unstable":
      rating = 2;
      delayDays = 1;
      why = "Sabía la respuesta pero no la saco solo. Vuelve mañana.";
      break;
    case "forgotten":
      rating = 1;
      delayDays = 1;
      why = "El concepto sigue ahí — lo recuperaste al contrastarlo — pero la vía rápida no funciona.";
      break;
    case "mismatched":
      rating = 1;
      delayDays = 2;
      why = "El ejemplo te sale y la regla no. Modelo mental invertido.";
      break;
    default:
      rating = 1;
      delayDays = 2;
      why = overconfident
        ? "Dijiste que lo tenías y no era así. Esa combinación es la que más rinde después."
        : "No aparece ni con pistas. Es un concepto que hay que trabajar de verdad.";
  }

  return {
    verdict,
    fsrs: { cardId: opts.cardId, rating, delayDays, why },
    requeue:
      verdict === "known" || verdict === "unstable"
        ? []
        : [{ cardId: opts.cardId ?? "", why: verdict === "forgotten" ? "drill" : "relearn", delayDays }],
  };
}


/**
 * Se ha equivocado eligiendo la opcion que era la definicion misma del
 * concepto. Eso no es despiste: es la regla del revés.
 */
function invertedAtL2(
  results: ProbeResult[],
  opts: { pivotChoice?: string; referenceBack?: string },
): boolean {
  if (!opts.pivotChoice || !opts.referenceBack) return false;
  const l2 = results.find((r) => r.level === 2);
  if (!l2 || l2.correct) return false;
  return opts.pivotChoice.trim() === opts.referenceBack.trim();
}

// ---------------------------------------------------------------------------
// La medicion en si
// ---------------------------------------------------------------------------

/**
 * Convierte una sesion en una estimacion actualizada. Aciertos en el
 * fondo pesan mas que en la superficie: quien responde a la de
 * control, sin haberleos la de arriba, se sabe la cosa.
 */
export function updateEstimate(
  prev: KnowledgeEstimate | null,
  concept: string,
  results: ProbeResult[],
  verdict: DiagnosticVerdict,
  fsrsMean: number,
  now: number = Date.now(),
): KnowledgeEstimate {
  const deep = results.some((r) => r.level >= 2 && r.correct);
  const shallow = results[0]?.correct === true && !deep;
  const failed = !results[0]?.correct;

  // Un acierto profundo sube mucho; uno superficial sube poco; fallar
  // baja, pero bajar mas cuando se ha llegado al fondo.
  const delta = deep ? 0.34 : shallow ? 0.08 : failed ? (results.length > 1 ? -0.26 : -0.12) : 0;

  const p0 = prev?.p ?? 0.5;
  const observations = (prev?.observations ?? 0) + 1;

  return {
    concept,
    p: clamp(p0 + delta, 0.02, 0.99),
    observations,
    lastVerdict: verdict,
    lastSeenAt: now,
    fsrsMean: fsrsMean > 0 ? fsrsMean : prev?.fsrsMean ?? 0,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Lo que se le cuenta a la persona
// ---------------------------------------------------------------------------

/**
 * El texto que aparece al final. La regla es que no diga "has fallado":
 * un resultado de medicion no es un veredicto sobre la persona, es
 * informacion sobre donde poner el esfuerzo.
 */
export function narrate(outcome: Omit<ProbeOutcome, "narrative">, now = new Date()): string {
  const when = now.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  switch (outcome.verdict) {
    case "known":
      return "Lo tenías. No teupyo más tiempo aquí.";
    case "unstable":
      return "Sabías la respuesta, pero no te salió sola. Mañana vuelves a verla: es más barato repasar que aprender.";
    case "forgotten":
      return `El concepto estaba, se te había ido. Lo has sacado al contrastarlo con ${when}. Lo has apuntado en drilling.`;
    case "mismatched":
      return "El ejemplo te sale y la regla no. Es el patrón clásico: has memorizado la forma y no el porqué. El mapa mental lo suele arreglar.";
    default:
      return "No sale ni con pistas. No es que lo estés olvidando: es que nunca llegó a entrar. Le he puesto una fecha corta y aparece pronto.";
  }
}

// ---------------------------------------------------------------------------
// Programacion: examinations, no "cuando el usuario entre"
// ---------------------------------------------------------------------------

/**
 * La cola de hoy. Se construye con lo que se sabe sin preguntar nada:
 * las estimaciones guardadas, los exámenes que se acercan's y los
 * fallos recientes.
 */
export function buildPlan(
  estimates: KnowledgeEstimate[],
  exams: ExamWindow[],
  today: number,
  config: DiagnosticConfig = DEFAULT_DIAGNOSTIC_CONFIG,
): DiagnosticPlan {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;

  const doneToday = estimates
    .filter((e) => e.lastSeenAt >= dayStart.getTime() && e.lastSeenAt < dayEnd)
    .map((e) => e.concept);

  const upcoming = exams
    .map((ex) => ({ ex, daysToExam: Math.ceil((Date.parse(ex.date) - today) / 86400000) }))
    .filter((e) => e.daysToExam >= 0 && e.daysToExam <= config.examHorizonDays)
    .sort((a, b) => a.daysToExam - b.daysToExam);

  const examByTopic = new Map<string, { exam: ExamWindow; days: number }>();
  for (const { ex, daysToExam } of upcoming) {
    for (const topic of ex.topics) {
      const prev = examByTopic.get(topic);
      if (!prev || daysToExam < prev.days) examByTopic.set(topic, { exam: ex, days: daysToExam });
    }
  }

  const due: DiagnosticPlan["due"] = [];
  for (const e of estimates) {
    if (doneToday.includes(e.concept)) continue;
    const exam = examByTopic.get(e.concept);
    const daysSince = (today - e.lastSeenAt) / 86400000;
    const reason: ProbeReason | null = exam
      ? "exam-near"
      : e.observations === 0
        ? "initial"
        : daysSince >= config.restaleDays
          ? "stale"
          : e.p < 0.35
            ? "drill"
            : null;
    if (!reason) continue;
    due.push({ concept: e.concept, reason, exam: exam?.exam, daysToExam: exam?.days });
  }

  // Orden: primero lo que tiene examen, y dentro de eso lo mas cercano.
  // Despues lo que no se sabe, que es donde mas rinde el tiempo.
  due.sort((a, b) => {
    const ea = a.daysToExam ?? Infinity;
    const eb = b.daysToExam ?? Infinity;
    if (ea !== eb) return ea - eb;
    return (estimates.find((x) => x.concept === a.concept)?.p ?? 0.5) -
           (estimates.find((x) => x.concept === b.concept)?.p ?? 0.5);
  });

  const picked = due.slice(0, Math.max(0, config.maxPerDay - doneToday.length));
  const queue = picked.map((d) => {
    const est = estimates.find((x) => x.concept === d.concept) ?? null;
    return {
      concept: d.concept,
      folderId: d.exam?.folderId ?? null,
      reason: d.reason,
      level: chooseProbeLevel(
        est ?? { concept: d.concept, p: 0.5, observations: 0, lastVerdict: null, lastSeenAt: 0, fsrsMean: 0 },
        { reason: d.reason, daysToExam: d.daysToExam },
        config,
      ),
    };
  });

  const next = new Date(today);
  next.setHours(config.dailyHour, 0, 0, 0);
  if (next.getTime() <= today) next.setTime(next.getTime() + 86400000);

  return { queue, doneToday, nextRunAt: next.getTime(), due };
}

/**
 * El FSRS no se toca de la misma manera por todos. Un lapse en una
 * tarjeta con estabilidad alta es una senal fuerte — algo se rompio —
 * y uno en una tarjeta nueva es solo su estado natural.
 */
export function fsrsSeverity(
  prevStability: number,
  prevState: string,
  verdict: DiagnosticVerdict,
): "lapse" | "hard" | "good" {
  if (verdict === "known") return "good";
  if (verdict === "unstable") return "hard";
  if (prevStability >= 21 && (prevState === "review" || prevState === "lapsed")) return "lapse";
  return "lapse";
}
