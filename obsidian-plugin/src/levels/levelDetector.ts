// LevelDetector: extrae el nivel académico del frontmatter de una nota
// o del global de settings. Permite override por nota individual.

import { App, TFile, normalizePath } from "obsidian";
import { AcademicLevel, MNexusFrontmatter, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

const VALID_LEVELS: AcademicLevel[] = ["1_MED", "2_MED", "3_MED", "4_MED", "5_MED", "6_MED_MIR", "custom"];

function isValidLevel(s: string): s is AcademicLevel {
  return (VALID_LEVELS as string[]).includes(s);
}

export class LevelDetector {
  constructor(private app: App, private settings: MNexusSettings, private log: Logger) {}

  /** Nivel del usuario (config global). */
  getUserLevel(): AcademicLevel {
    return this.settings.userLevel;
  }

  /**
   * Resuelve el nivel efectivo de una nota:
   * 1) frontmatter `level` (override por nota)
   * 2) subject → heurística desde nombre de materia
   * 3) settings.userLevel
   */
  async resolveForNote(notePath: string): Promise<AcademicLevel> {
    const fromFm = await this.readFromFrontmatter(notePath);
    if (fromFm) return fromFm;
    const fromSubject = this.guessFromSubject(notePath);
    if (fromSubject) return fromSubject;
    return this.getUserLevel();
  }

  /** Lee el campo `level` del frontmatter. */
  async readFromFrontmatter(notePath: string): Promise<AcademicLevel | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!file) return null;
    try {
      const content = await this.app.vault.read(file as never);
      const fm = this.parseFrontmatter(String(content));
      if (fm.level && isValidLevel(fm.level)) return fm.level;
    } catch (e) {
      this.log.debug(`LevelDetector: error leyendo ${notePath}: ${(e as Error).message}`);
    }
    return null;
  }

  /** Heurística por nombre de archivo/materia. */
  private guessFromSubject(notePath: string): AcademicLevel | null {
    const lower = notePath.toLowerCase();
    // Asignaturas típicas de 1_MED
    if (/bioqu[ií]mica|histolog[ií]a|anatom[ií]a|citolog[ií]a|biolog[ií]a\s+celular|embriolog/i.test(lower)) return "1_MED";
    // 2_MED
    if (/fisiolog[ií]a|microbiolog[ií]a|inmunolog[ií]a|farmacolog[ií]a\s+b[aá]sica|histolog/i.test(lower)) return "2_MED";
    // 3_MED
    if (/patolog[ií]a|semiolog|semiol[oó]g|fisiopatolog|proped[eé]utica/i.test(lower)) return "3_MED";
    // 4_MED
    if (/medicina\s+interna|cardiolog[ií]a|neurolog[ií]a|gastroenterolog|nephrolog|pulmonolog|endocrinolog|reumatolog|hematolog|oncolog/i.test(lower)) return "4_MED";
    // 5_MED
    if (/pr[aá]cticas|residentes|urgencias|cuidados\s+intensivos|UCI/i.test(lower)) return "5_MED";
    // 6_MED_MIR
    if (/MIR|USMLE|examen|ENM/i.test(lower)) return "6_MED_MIR";
    return null;
  }

  private parseFrontmatter(content: string): Partial<MNexusFrontmatter> {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const fm: Record<string, string> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w_-]+):\s*(.+)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
    const out: Partial<MNexusFrontmatter> = {};
    if (fm.level) out.level = isValidLevel(fm.level) ? fm.level : undefined;
    if (fm.subject) out.subject = fm.subject;
    if (fm.title) out.title = fm.title;
    return out;
  }
}
