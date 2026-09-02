// Taxonomía de niveles académicos de M-NEXUS.
// Cada nivel define un perfil completo (prompt, vocabulario, tipos de pregunta)
// que se inyecta en el motor RAG, el generador de viñetas y el modo socrático.

import { AcademicLevel, AcademicLevelInfo } from "../types";

const BASE_PROMPT = `CONTEXTO ACADÉMICO: el alumno está en este nivel de la carrera de medicina.
Adapta TODA tu respuesta (vocabulario, profundidad, complejidad) a este nivel.`;

const ALL_LEVELS: AcademicLevelInfo[] = [
  {
    id: "1_MED",
    label: "1º Medicina (ciencias básicas)",
    year: 1,
    description: "Bioquímica, histología, biología celular, anatomía pura. Sin razonamiento clínico aún.",
    prompt: `${BASE_PROMPT}
- Usa terminología MOLECULAR y CELULAR (orgánulos, vías metabólicas, tipos celulares).
- NO uses terminología clínica (síntomas, síndromes, diagnóstico diferencial).
- Preguntas tipo: "¿Qué orgánulo se observa en esta imagen?", "¿Cuál es la enzima limitante de esta vía?", "¿De qué capa embrionaria deriva esta estructura?".
- Respuestas precisas, con nombres bioquímicos y estructurales.`,
    preferredQuestionTypes: ["molecular", "celular", "anatómico-puro", "bioquímico", "histológico"],
    vocabulary: ["orgánulo", "vía metabólica", "enzima", "transcripción", "transducción", "mitocondria", "retículo", "Golgi", "citoesqueleto", "membrana plasmática"],
    tags: ["1_MED", "ciencias-básicas", "biología", "bioquímica", "histología", "anatomía"],
  },
  {
    id: "2_MED",
    label: "2º Medicina (fisiología + micro)",
    year: 2,
    description: "Fisiología, microbiología, inmunología, farmacología básica. Inicio de razonamiento funcional.",
    prompt: `${BASE_PROMPT}
- Usa terminología FISIOLÓGICA (homeostasis, mecanismos de regulación, balance).
- Introduce conceptos microbiológicos e inmunológicos cuando aplique.
- Comienza a usar terminología clínica básica (fisiopatología).
- Preguntas tipo: "¿Cómo se regula este proceso?", "¿Qué pasa si esta vía falla?", "¿Qué citoquinas median esta respuesta inmune?".
- Conecta estructura con función.`,
    preferredQuestionTypes: ["fisiología", "microbiología", "inmunología", "farmacología-básica", "regulación"],
    vocabulary: ["homeostasis", "retroalimentación", "receptor", "segundo mensajero", "bomba", "canal iónico", "ciclo", "fase", "citoquina", "anticuerpo"],
    tags: ["2_MED", "fisiología", "microbiología", "inmunología", "farmacología"],
  },
  {
    id: "3_MED",
    label: "3º Medicina (patología + semiología)",
    year: 3,
    description: "Patología, semiología, fisiopatología. Inicio del diagnóstico diferencial.",
    prompt: `${BASE_PROMPT}
- Usa terminología de PATOLOGÍA y SEMIOLOGÍA (signos, síntomas, síndromes).
- Conecta la alteración molecular/fisiológica con su MANIFESTACIÓN CLÍNICA.
- Introduce diagnóstico diferencial inicial (no más de 3-4 entidades).
- Preguntas tipo: "Paciente con [síntomas]. ¿Cuál es la causa más probable?", "¿Qué hallazgo esperaría en esta analítica?", "¿Cómo se explica este signo desde la fisiopatología?".
- Justifica SIEMPRE el razonamiento.`,
    preferredQuestionTypes: ["fisiopatología", "semiológica", "diagnóstico-diferencial-inicial", "interpretación-pruebas"],
    vocabulary: ["fisiopatología", "síndrome", "signo", "síntoma", "etiología", "patogenia", "lesión", "metaplasia", "displasia", "marcador tumoral"],
    tags: ["3_MED", "patología", "semiología", "fisiopatología", "diagnóstico-inicial"],
  },
  {
    id: "4_MED",
    label: "4º Medicina (medicina interna)",
    year: 4,
    description: "Medicina interna, especialidades, diagnósticos complejos. Razonamiento clínico maduro.",
    prompt: `${BASE_PROMPT}
- Plantea casos CLÍNICOS con comorbilidades, polifarmacia y hallazgos incidentales.
- Diagnóstico diferencial amplio (5-8 entidades), con prevalencia y gravedad.
- Prioriza el manejo: pruebas complementarias escalonadas, tratamiento escalonado.
- Preguntas tipo: "Varón de 65 años con HTA, DM2 y disnea progresiva… ¿siguiente paso diagnóstico?", "¿Qué tratamiento de primera línea está más indicado?".
- Incluye valores numéricos (labs, scores, dosis).`,
    preferredQuestionTypes: ["caso-clínico", "manejo-paciente", "pruebas-complementarias", "tratamiento", "seguimiento"],
    vocabulary: ["comorbilidad", "polifarmacia", "escala", "score", "IC95%", "NNT", "NNH", "screening", "monitorización", "ajuste dosis"],
    tags: ["4_MED", "medicina-interna", "especialidades", "manejo-clínico"],
  },
  {
    id: "5_MED",
    label: "5º/6º Medicina (prácticas + MIR)",
    year: 5,
    description: "Prácticas clínicas reales, casos completos, preparación MIR/USMLE intensivo.",
    prompt: `${BASE_PROMPT}
- Casos complejos multidisciplinares con evolución temporal y decisiones críticas.
- Manejo integral: diagnóstico, tratamiento, seguimiento, calidad de vida.
- Incluye gestión de recursos, ética clínica, comunicación con paciente/familia.
- Preguntas tipo USMLE Step 2 CK / MIR: "Tras los resultados, ¿cuál es el SIGUIENTE PASO?".
- Justifica cada decisión clínica como en sesión de residentes.`,
    preferredQuestionTypes: ["siguiente-paso", "caso-residente", "manejo-multidisciplinar", "ética", "comunicación"],
    vocabulary: ["siguiente paso", "ingreso", "alta", "interconsulta", "comité", "bioética", "consentimiento", "familia", "pronóstico", "calidad de vida"],
    tags: ["5_MED", "prácticas", "MIR", "USMLE"],
  },
  {
    id: "6_MED_MIR",
    label: "6º Medicina / MIR (examen)",
    year: 6,
    description: "Modo examen puro: preguntas MIR/USMLE con alta exigencia, distractores difíciles.",
    prompt: `${BASE_PROMPT}
- Estricto formato USMLE/MIR: 4-5 opciones, una sola correcta, distractores plausibles.
- Planteamiento "lo más probable" cuando hay ambigüedad clínica.
- Justificación breve y enfocada (lo que se preguntaría en el examen).
- Lenguaje telegráfico en las opciones.
- Pensado para time-pressure: tiempo medio < 90s por pregunta.`,
    preferredQuestionTypes: ["mir-pura", "usmle-pure", "step-2-ck", "first-aid"],
    vocabulary: ["first-line", "most-likely", "best-next-step", "gold-standard", "complication", "mortality", "incidence", "prevalence"],
    tags: ["6_MED_MIR", "examen", "MIR", "USMLE"],
  },
  {
    id: "custom",
    label: "Personalizado",
    year: 0,
    description: "Sin restricción de nivel. El LLM decide el nivel según el contenido.",
    prompt: "",
    preferredQuestionTypes: [],
    vocabulary: [],
    tags: ["custom"],
  },
];

const LEVEL_BY_ID = new Map(ALL_LEVELS.map((l) => [l.id, l]));

/** Devuelve la configuración del nivel o la del custom por defecto. */
export function getLevelInfo(level: AcademicLevel | undefined | null): AcademicLevelInfo {
  if (!level) return LEVEL_BY_ID.get("1_MED")!;
  return LEVEL_BY_ID.get(level) ?? LEVEL_BY_ID.get("custom")!;
}

/** Lista todos los niveles. */
export function listAllLevels(): AcademicLevelInfo[] {
  return ALL_LEVELS.slice();
}

/** Devuelve el siguiente nivel al dado. Custom y 6_MED_MIR devuelven el mismo. */
export function nextLevel(level: AcademicLevel): AcademicLevel | null {
  const order: AcademicLevel[] = ["1_MED", "2_MED", "3_MED", "4_MED", "5_MED", "6_MED_MIR"];
  if (level === "custom") return null;
  const idx = order.indexOf(level);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

/** Devuelve el nivel anterior. */
export function previousLevel(level: AcademicLevel): AcademicLevel | null {
  const order: AcademicLevel[] = ["1_MED", "2_MED", "3_MED", "4_MED", "5_MED", "6_MED_MIR"];
  if (level === "custom") return null;
  const idx = order.indexOf(level);
  if (idx <= 0) return null;
  return order[idx - 1];
}

export const ACADEMIC_LEVELS = ALL_LEVELS;
