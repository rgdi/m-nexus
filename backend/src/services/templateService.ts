// templateService.ts: gestiona templates de notas (Fase 2.D).
//
// v0.46: sistema de templates médicos built-in + custom.
// Templates pueden incluir variables ({{date}}, {{topic}}, etc).
// Daily notes se crean automáticamente al abrir la app.

export interface Template {
  id: string;
  name: string;
  description: string;
  category: "general" | "medical" | "study" | "custom";
  /** Contenido del template con placeholders {{var}} */
  content: string;
  /** Tags que se aplican automáticamente al usar el template */
  defaultTags?: string[];
  /** Icon para UI (Material Icon name) */
  icon?: string;
}

export interface RenderedTemplate {
  /** Template original */
  template: Template;
  /** Contenido con variables reemplazadas */
  rendered: string;
  /** Nombre del archivo sugerido */
  suggestedFilename: string;
}

const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Nota vacía",
    description: "Empezar desde cero",
    category: "general",
    content: "# {{title}}\n\n",
    icon: "description",
  },
  {
    id: "daily",
    name: "Daily Note",
    description: "Nota diaria con secciones de estudio y reflexión",
    category: "general",
    content: `# {{date}}

## 🎯 Objetivos del día
- 

## 📚 Estudio
- 

## 💡 Aprendido
- 

## 🤔 Preguntas
- 

## ✅ Logros
- 
`,
    defaultTags: ["daily"],
    icon: "today",
  },
  {
    id: "soap",
    name: "Nota SOAP (médica)",
    description: "Subjetivo, Objetivo, Análisis, Plan — historia clínica",
    category: "medical",
    content: `# {{title}} — SOAP

**Fecha:** {{date}}
**Paciente:** 

## S — Subjetivo
- Motivo de consulta: 
- Síntomas: 
- Historia: 

## O — Objetivo
- Signos vitales: 
- Examen físico: 
- Labs: 

## A — Análisis
- Diagnóstico presuntivo: 
- Diagnósticos diferenciales: 

## P — Plan
- Estudios: 
- Tratamiento: 
- Seguimiento: 
`,
    defaultTags: ["clinica", "soap"],
    icon: "medical_services",
  },
  {
    id: "pharmacology",
    name: "Fármaco",
    description: "Ficha de farmacología: mecanismo, indicaciones, efectos",
    category: "medical",
    content: `# {{title}}

## Clase
- 

## Mecanismo de acción
- 

## Farmacocinética
- Absorción: 
- Distribución: 
- Metabolismo: 
- Eliminación: 

## Indicaciones
- 

## Posología
- Dosis: 
- Frecuencia: 
- Duración: 

## Efectos adversos
- Comunes: 
- Graves: 

## Contraindicaciones
- 

## Interacciones
- 

## Mnemotécnico
- 
`,
    defaultTags: ["farmacologia"],
    icon: "medication",
  },
  {
    id: "anatomy",
    name: "Anatomía",
    description: "Estructura, función, inervación, irrigación",
    category: "medical",
    content: `# {{title}}

## Ubicación
- 

## Estructura
- 

## Función
- 

## Inervación
- 

## Irrigación
- 

## Relaciones anatómicas
- Anterior: 
- Posterior: 
- Superior: 
- Inferior: 

## Patologías asociadas
- 
`,
    defaultTags: ["anatomia"],
    icon: "accessibility",
  },
  {
    id: "disease",
    name: "Enfermedad",
    description: "Etiología, patogenia, clínica, diagnóstico, tratamiento",
    category: "medical",
    content: `# {{title}}

## Definición
- 

## Etiología
- 

## Epidemiología
- 

## Patogenia
- 

## Cuadro clínico
- Síntomas: 
- Signos: 

## Diagnóstico
- Clínico: 
- Laboratorio: 
- Imagen: 

## Diagnóstico diferencial
- 

## Tratamiento
- No farmacológico: 
- Farmacológico: 
- Quirúrgico: 

## Complicaciones
- 

## Pronóstico
- 
`,
    defaultTags: ["patologia", "clinica"],
    icon: "coronavirus",
  },
  {
    id: "flashcard-batch",
    name: "Batch de flashcards",
    description: "Crear múltiples flashcards a la vez",
    category: "study",
    content: `# Flashcards — {{topic}}

> Una card por bloque. Formato: Pregunta :: Respuesta

- :: 
- :: 
- :: 
- :: 
- :: 
`,
    defaultTags: ["flashcards", "batch"],
    icon: "style",
  },
];

export class TemplateService {
  private templates: Map<string, Template> = new Map();

  constructor() {
    // Cargar built-in templates
    for (const t of BUILTIN_TEMPLATES) {
      this.templates.set(t.id, t);
    }
  }

  /**
   * Lista todos los templates disponibles.
   * Filtra opcionalmente por categoría.
   */
  list(category?: Template["category"]): Template[] {
    const all = Array.from(this.templates.values());
    if (category) return all.filter((t) => t.category === category);
    return all;
  }

  /**
   * Obtiene un template por ID.
   */
  get(id: string): Template | null {
    return this.templates.get(id) ?? null;
  }

  /**
   * Registra un template custom.
   */
  register(template: Template): void {
    this.templates.set(template.id, template);
  }

  /**
   * Renderiza un template con las variables dadas.
   * Variables no provistas se reemplazan con string vacío.
   */
  render(id: string, variables: Record<string, string> = {}): RenderedTemplate | null {
    const template = this.get(id);
    if (!template) return null;

    // Auto-fill variables conocidas
    const now = new Date();
    const fullVars: Record<string, string> = {
      date: now.toISOString().slice(0, 10),
      datetime: now.toISOString(),
      year: String(now.getFullYear()),
      ...variables,
    };

    let rendered = template.content;
    for (const [key, value] of Object.entries(fullVars)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      rendered = rendered.replace(regex, value);
    }
    // Variables no reemplazadas → string vacío
    rendered = rendered.replace(/\{\{\s*\w+\s*\}\}/g, "");

    // Generar filename sugerido
    const title = fullVars.title ?? template.name.toLowerCase().replace(/\s+/g, "-");
    const dateStr = fullVars.date ?? now.toISOString().slice(0, 10);
    const suggestedFilename = template.id === "daily"
      ? `Daily/${dateStr}.md`
      : `${title}.md`;

    return {
      template,
      rendered,
      suggestedFilename,
    };
  }

  /**
   * Genera la daily note de hoy (o de fecha específica).
   */
  renderDailyNote(date?: Date): RenderedTemplate {
    const d = date ?? new Date();
    return this.render("daily", { date: d.toISOString().slice(0, 10) })!;
  }

  /**
   * Busca templates por nombre o descripción (case-insensitive).
   */
  search(query: string): Template[] {
    const q = query.toLowerCase();
    return this.list().filter((t) =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }
}
