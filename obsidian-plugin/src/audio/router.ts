// Enrutador de Fase 2:
//   - Si la nota destino existe → añadir bloque de transcripción + timestamps + énfasis.
//   - Si NO existe → dejar .md de transcripción en Inbox/En Espera y registrar AudioRecord.

import { App, Notice, TFile, normalizePath } from "obsidian";
import * as path from "path";
import { AudioRecord, MNexusFrontmatter, MNexusSettings, TranscriptResult } from "../types";
import { Logger } from "../utils/logger";
import { Transcriber } from "./transcriber";
import { secondsToObsidian } from "./timestamps";
import { EMPHASIS_PATTERNS } from "../constants";
import { FrontmatterManager } from "../metadata/frontmatter";
import { AudioRegistry } from "./registry";
import { ScheduleMatcher, type ScheduleMatch } from "../exams/scheduleMatcher";
import type { PluginDataStorage } from "../exams/persistence";

export class AudioRouter {
  private fm: FrontmatterManager;
  private registry: AudioRegistry;
  private scheduleMatcher?: ScheduleMatcher;
  private storage?: PluginDataStorage;
  /** Callback cuando se detecta una clase para una grabación. */
  public onClassDetected?: (audioPath: string, match: ScheduleMatch) => void | Promise<void>;

  constructor(
    private app: App,
    private settings: MNexusSettings,
    private transcriber: Transcriber,
    private log: Logger
  ) {
    this.fm = new FrontmatterManager(app);
    this.registry = new AudioRegistry(app, settings);
  }

  /** v0.22: inyecta storage + matcher (lazy). */
  setStorage(storage: PluginDataStorage): void {
    this.storage = storage;
    const schedules = storage.getClassSchedules();
    this.scheduleMatcher = new ScheduleMatcher(schedules as any);
  }

  /** v0.22: refresca el matcher cuando cambian los schedules. */
  refreshScheduleMatcher(): void {
    if (this.storage) {
      const schedules = this.storage.getClassSchedules();
      this.scheduleMatcher = new ScheduleMatcher(schedules as any);
    }
  }

  /** Procesa un archivo de audio: transcribe y enruta. */
  async processAudioFile(audioPath: string, targetNotePath?: string): Promise<AudioRecord> {
    const fileName = path.basename(audioPath);
    const stat = await this.app.vault.adapter.stat(audioPath).catch(() => null);

    // v0.22: detectar clase por horario ANTES de transcribir (rápido).
    if (this.scheduleMatcher) {
      // Usar ctime (creación) si está disponible, si no mtime (modificación).
      // Si no hay stat (p. ej., archivo en otro vault), usar Date.now() pero
      // descontar la duración estimada para aproximar el inicio.
      const statAny = stat as unknown as { ctime?: number; mtime?: number } | null;
      const fileStartMs = statAny?.ctime ?? statAny?.mtime ?? (Date.now() - 60 * 60_000);
      const estimatedDurationMs = 60 * 60_000; // Asumimos 60min por defecto
      const match = this.scheduleMatcher.match(fileStartMs, estimatedDurationMs);
      if (match) {
        this.log.info(
          `[audioRouter] match: ${match.schedule.subject} (confidence ${match.confidence.toFixed(2)})`
        );
        // Si no se especificó target, usar la carpeta del subject
        if (!targetNotePath) {
          const subjectPath = this.pathForSubject(match.schedule.subject);
          if (subjectPath) targetNotePath = subjectPath;
        }
        // Notificar
        await this.onClassDetected?.(audioPath, match);
      }
    }

    const transcript = await this.transcriber.transcribe(audioPath);

    // Resolver destino
    const explicitTarget = targetNotePath ? normalizePath(targetNotePath) : undefined;
    const guessedTarget = explicitTarget ?? (await this.guessTargetNote(fileName));
    const targetExists = guessedTarget ? await this.app.vault.adapter.exists(guessedTarget) : false;

    if (targetExists && guessedTarget) {
      return this.linkToNote(audioPath, guessedTarget, transcript);
    } else {
      return this.sendToInbox(audioPath, transcript, guessedTarget);
    }
  }

  // -------------------------------------------------------------------------

  private async guessTargetNote(fileName: string): Promise<string | undefined> {
    // Heurística: buscar nota con subject/audio relacionado en metadatos.
    const notes = this.app.vault.getMarkdownFiles();
    const stem = path.basename(fileName, path.extname(fileName)).toLowerCase();
    for (const n of notes) {
      const fm = this.app.metadataCache.getFileCache(n)?.frontmatter;
      const audioRef = (fm?.prof_audio_ref as string | undefined)?.toLowerCase() ?? "";
      if (audioRef && audioRef.includes(stem)) return n.path;
      if (n.basename.toLowerCase() === stem) return n.path;
    }
    return undefined;
  }

  /** v0.22: busca/crea la carpeta del subject. */
  private pathForSubject(subject: string): string | undefined {
    // Buscar carpeta existente con nombre similar
    const subjectLower = subject.toLowerCase();
    const folders = this.app.vault.getAllLoadedFiles().filter((f) => "children" in f);
    for (const f of folders) {
      if (f.name.toLowerCase() === subjectLower) {
        return `${f.path}/${this.dateSlug()}.md`;
      }
    }
    // Si no existe, sugerir crear
    return `${this.settings.inboxFolder}/${subject}/${this.dateSlug()}.md`;
  }

  private dateSlug(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  private async linkToNote(
    audioPath: string,
    notePath: string,
    transcript: TranscriptResult
  ): Promise<AudioRecord> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      throw new Error(`La nota destino ${notePath} no es un TFile.`);
    }
    const fm = await this.fm.read(file);
    const fileName = path.basename(audioPath);

    // Marcar énfasis detectados en la transcripción
    const emphasis: { time: number; phrase: string }[] = [];
    for (const seg of transcript.segments) {
      for (const pat of EMPHASIS_PATTERNS) {
        if (pat.test(seg.text)) {
          emphasis.push({ time: seg.start, phrase: seg.text });
        }
      }
    }

    // Construir bloque de transcripción
    const block = this.buildTranscriptBlock(fileName, transcript, emphasis);

    // Inyectar en la nota
    const raw = await this.app.vault.read(file);
    const sectionHeader = `\n\n## Transcripción de Clase — ${fileName}\n`;
    const newBody = raw.trimEnd() + sectionHeader + block + "\n";

    // Actualizar frontmatter: pending_flashcard_review se incrementará tras generar
    const updatedFm: Partial<MNexusFrontmatter> = {
      prof_audio_ref: `[[${fileName}#t=${secondsToObsidian(0)}]]`,
      last_audit: new Date().toISOString(),
    };
    if (emphasis.length > 0) {
      updatedFm.emphasis_blocks = (fm.emphasis_blocks ?? []).concat(
        emphasis.map((e) => `${secondsToObsidian(e.time)} — ${e.phrase}`)
      );
    }

    await this.fm.merge(file, updatedFm);
    await this.app.vault.modify(file, newBody);

    const record: AudioRecord = {
      id: `${Date.now()}-${fileName}`,
      filePath: audioPath,
      fileName,
      createdAt: new Date().toISOString(),
      state: "linked",
      targetNotePath: notePath,
      durationSec: transcript.segments.at(-1)?.end,
    };
    await this.registry.add(record);
    new Notice(`Audio vinculado a ${file.basename}.`);
    this.log.info(`Audio ${fileName} → nota ${notePath} (énfasis: ${emphasis.length})`);
    return record;
  }

  private async sendToInbox(
    audioPath: string,
    transcript: TranscriptResult,
    guessedNote: string | undefined
  ): Promise<AudioRecord> {
    const inboxDir = normalizePath(this.settings.inboxFolder);
    await this.ensureFolder(inboxDir);

    const fileName = path.basename(audioPath);
    const stem = path.basename(fileName, path.extname(fileName));
    const transcriptMd = this.buildInboxNote(fileName, transcript, guessedNote);
    const destPath = normalizePath(`${inboxDir}/${stem}.md`);

    await this.app.vault.create(destPath, transcriptMd);

    const record: AudioRecord = {
      id: `${Date.now()}-${fileName}`,
      filePath: audioPath,
      fileName,
      createdAt: new Date().toISOString(),
      state: "inbox",
      transcriptPath: destPath,
    };
    await this.registry.add(record);
    new Notice(
      `No se encontró nota destino para ${fileName}. Transcripción en Inbox. ${guessedNote ? "Sospecha: " + guessedNote : ""}`
    );
    this.log.warn(`Audio ${fileName} enviado a Inbox (sin nota destino).`);
    return record;
  }

  // -------------------------------------------------------------------------

  private buildTranscriptBlock(
    fileName: string,
    t: TranscriptResult,
    emphasis: { time: number; phrase: string }[]
  ): string {
    const emphasisMap = new Map(emphasis.map((e) => [e.time.toFixed(2), true]));
    const lines: string[] = [`> [!info] Audio de clase — [[${fileName}]]`, ""];
    for (const seg of t.segments) {
      const ts: string = secondsToObsidian(seg.start);
      const isEmphasis: boolean = emphasisMap.has(seg.start.toFixed(2));
      const line: string = isEmphasis
        ? `> [!IMPORTANT] **[${ts}]** ${seg.text}`
        : `> **[${ts}]** ${seg.text}`;
      lines.push(line);
    }
    return lines.join("\n");
  }

  private buildInboxNote(
    fileName: string,
    t: TranscriptResult,
    guessedNote: string | undefined
  ): string {
    const frontmatter = [
      "---",
      `title: "En Espera — ${fileName}"`,
      "mnexus_inbox: true",
      "author_verified: false",
      `pending_link: "${guessedNote ?? ""}"`,
      "---",
      "",
      `# 🎙️ Transcripción pendiente: ${fileName}`,
      "",
      guessedNote
        ? `> [!warning] **Sospecha:** esta transcripción podría pertenecer a \`${guessedNote}\`. Crea o vincula la nota manualmente.`
        : "> [!warning] No se detectó nota destino. Crea la nota del tema y luego vincúlala.",
      "",
      "## Transcripción",
      "",
    ].join("\n");

    const body = t.segments
      .map((s) => `- **[${secondsToObsidian(s.start)}]** ${s.text}`)
      .join("\n");
    return frontmatter + body + "\n";
  }

  private async ensureFolder(folderPath: string) {
    const norm = normalizePath(folderPath);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      const exists = await this.app.vault.adapter.exists(cur);
      if (!exists) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}
