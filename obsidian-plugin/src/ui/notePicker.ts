// NotePicker: input con autocomplete de notas/carpetas/tags/subjects.
// v0.14: dropdown con resultados agrupados, debounce, keyboard nav.

import { ScopeResolver } from "../exams/scopeResolver.js";
import type { ExamScope } from "../exams/types.js";

export interface NotePickerOptions {
  placeholder?: string;
  onChange?: (scopes: ExamScope[]) => void;
}

export interface NotePickerResult {
  scope: ExamScope;
  label: string;
  hint: string;
}

export class NotePicker {
  private container: HTMLElement;
  private input!: HTMLInputElement;
  private dropdown!: HTMLElement;
  private selectedScopes: ExamScope[] = [];
  private resolver: ScopeResolver;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentFocus: number = -1;
  private currentResults: NotePickerResult[] = [];
  private opts: NotePickerOptions;
  private wrapper: HTMLElement;
  private tagsContainer!: HTMLElement;

  constructor(parent: HTMLElement, resolver: ScopeResolver, opts: NotePickerOptions) {
    this.container = parent;
    this.resolver = resolver;
    this.opts = opts;
    this.wrapper = createDiv({ cls: "mnexus-note-picker" });
    this.render();
  }

  private render() {
    this.container.appendChild(this.wrapper);
    this.tagsContainer = this.wrapper.createDiv({ cls: "mnexus-note-picker-tags" });
    this.input = this.wrapper.createEl("input", {
      type: "text",
      placeholder: this.opts.placeholder ?? "Buscar nota, carpeta, tag o subject…",
    });
    this.input.addClass("mnexus-note-picker-input");
    this.dropdown = this.wrapper.createDiv({ cls: "mnexus-note-picker-dropdown" });
    this.dropdown.style.display = "none";
    this.input.addEventListener("input", () => this.scheduleRefresh());
    this.input.addEventListener("keydown", (e) => this.onKeydown(e));
    this.input.addEventListener("focus", () => this.scheduleRefresh());
    document.addEventListener("click", (e) => {
      if (!this.wrapper.contains(e.target as Node)) this.dropdown.style.display = "none";
    });
  }

  getSelectedScopes(): ExamScope[] {
    return [...this.selectedScopes];
  }

  setSelected(scopes: ExamScope[]) {
    this.selectedScopes = [...scopes];
    this.renderTags();
  }

  clear() {
    this.selectedScopes = [];
    this.input.value = "";
    this.renderTags();
  }

  private scheduleRefresh() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.refreshDropdown(), 50);
  }

  private refreshDropdown() {
    const q = this.input.value.trim();
    if (!q) {
      this.dropdown.style.display = "none";
      return;
    }
    const results = this.resolver.searchPrefix(q, 25);
    const all: NotePickerResult[] = [];

    // Carpetas
    for (const f of results.folders) {
      all.push({
        scope: { type: "folder", path: f, includeSubfolders: true },
        label: `📁 ${f}/**`,
        hint: "Toda la carpeta y subcarpetas",
      });
      all.push({
        scope: { type: "folder", path: f, includeSubfolders: false },
        label: `📁 ${f}`,
        hint: "Solo archivos directos",
      });
    }
    // Notas
    for (const n of results.notes) {
      all.push({
        scope: { type: "note", path: n },
        label: `📄 ${n}`,
        hint: "Nota individual",
      });
    }
    // Tags
    for (const t of results.tags) {
      all.push({
        scope: { type: "tag", tag: t },
        label: `🏷️ #${t}`,
        hint: "Todas las notas con este tag",
      });
    }
    // Subjects
    for (const s of results.subjects) {
      all.push({
        scope: { type: "subject", subject: s },
        label: `📚 ${s}`,
        hint: "Todas las notas con este subject",
      });
    }

    this.currentResults = all;
    this.currentFocus = -1;
    this.renderDropdown();
  }

  private renderDropdown() {
    this.dropdown.empty();
    if (this.currentResults.length === 0) {
      const empty = this.dropdown.createDiv({ cls: "mnexus-note-picker-empty", text: "Sin coincidencias" });
      this.dropdown.style.display = "block";
      return;
    }
    // Agrupar por label
    let lastType = "";
    for (let i = 0; i < this.currentResults.length; i++) {
      const r = this.currentResults[i];
      const type = r.scope.type;
      if (type !== lastType) {
        this.dropdown.createDiv({ cls: "mnexus-note-picker-section", text: this.sectionLabel(type) });
        lastType = type;
      }
      const row = this.dropdown.createDiv({ cls: "mnexus-note-picker-option" });
      row.dataset.idx = String(i);
      row.createDiv({ cls: "mnexus-note-picker-label", text: r.label });
      row.createDiv({ cls: "mnexus-note-picker-hint", text: r.hint });
      row.addEventListener("click", () => this.selectResult(i));
      row.addEventListener("mouseenter", () => this.setFocus(i));
    }
    this.dropdown.style.display = "block";
  }

  private sectionLabel(type: ExamScope["type"]): string {
    switch (type) {
      case "folder": return "Carpetas";
      case "note": return "Notas";
      case "tag": return "Tags";
      case "subject": return "Subjects";
    }
  }

  private setFocus(idx: number) {
    this.currentFocus = idx;
    const options = this.dropdown.querySelectorAll(".mnexus-note-picker-option");
    options.forEach((el, i) => {
      el.toggleClass("is-focused", i === idx);
    });
  }

  private onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.setFocus(Math.min(this.currentResults.length - 1, this.currentFocus + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.setFocus(Math.max(0, this.currentFocus - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.currentFocus >= 0) this.selectResult(this.currentFocus);
    } else if (e.key === "Escape") {
      this.dropdown.style.display = "none";
    }
  }

  private selectResult(idx: number) {
    const r = this.currentResults[idx];
    if (!r) return;
    this.selectedScopes.push(r.scope);
    this.input.value = "";
    this.dropdown.style.display = "none";
    this.renderTags();
    this.opts.onChange?.(this.getSelectedScopes());
  }

  private removeScope(idx: number) {
    this.selectedScopes.splice(idx, 1);
    this.renderTags();
    this.opts.onChange?.(this.getSelectedScopes());
  }

  private renderTags() {
    this.tagsContainer.empty();
    for (let i = 0; i < this.selectedScopes.length; i++) {
      const s = this.selectedScopes[i];
      const tag = this.tagsContainer.createDiv({ cls: "mnexus-note-picker-tag" });
      tag.createSpan({ text: this.labelOf(s) });
      const x = tag.createSpan({ text: "×", cls: "mnexus-note-picker-remove" });
      x.addEventListener("click", () => this.removeScope(i));
    }
  }

  private labelOf(scope: ExamScope): string {
    if (scope.type === "note") return `📄 ${scope.path}`;
    if (scope.type === "folder") return `📁 ${scope.path}${scope.includeSubfolders ? "/**" : ""}`;
    if (scope.type === "tag") return `🏷️ #${scope.tag}`;
    if (scope.type === "subject") return `📚 ${scope.subject}`;
    return "?";
  }
}
