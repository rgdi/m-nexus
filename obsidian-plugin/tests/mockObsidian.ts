/**
 * Mock completo de la API de Obsidian.
 *
 * Estrategia: el plugin depende de una API `obsidian` que se importa como módulo.
 * En tests, interceptamos ese import y devolvemos esta implementación simulada.
 *
 * Lo que mockeamos:
 *   - App, Plugin, PluginSettingTab
 *   - TFile, TFolder, TAbstractFile
 *   - Modal, ItemView
 *   - Notice
 *   - requestUrl (fetch)
 *   - parseFrontMatterTags
 *   - normalizePath
 *   - Setting
 *
 * Cómo se usa: los tests que importan código de `src/` automáticamente
 * reciben este mock cuando usan el alias `obsidian`.
 */

import { vi } from "vitest";

// ─── Helpers ────────────────────────────────────────────────────────────

let idCounter = 0;
const nextId = () => `mock-${++idCounter}`;

export class MockTAbstractFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  parent: MockTFolder | null = null;
  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? "";
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
  }
}

export class MockTFile extends MockTAbstractFile {
  type = "file" as const;
}

export class MockTFolder extends MockTAbstractFile {
  type = "folder" as const;
  children: MockTAbstractFile[] = [];
}

// ─── Vault simulado ─────────────────────────────────────────────────────

export class MockVault {
  private files = new Map<string, MockTFile>();
  private folders = new Map<string, MockTFolder>();
  adapter: MockAdapter;

  constructor(adapter?: MockAdapter) {
    this.folders.set("/", this.makeFolder("/"));
    this.adapter = adapter ?? new MockAdapter();
  }

  private makeFolder(path: string): MockTFolder {
    if (!this.folders.has(path)) {
      const f = new MockTFolder(path);
      f.parent = this.getParent(path);
      this.folders.set(path, f);
    }
    return this.folders.get(path)!;
  }

  private getParent(path: string): MockTFolder | null {
    const idx = path.lastIndexOf("/");
    if (idx <= 0) return this.folders.get("/") ?? null;
    return this.folders.get(path.slice(0, idx)) ?? null;
  }

  /** Crea la jerarquía de carpetas. */
  private ensureFolders(path: string) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts.slice(0, -1)) {
      cur += "/" + p;
      this.makeFolder(cur);
    }
  }

  // ─── API pública ────────────────────────────────────────────────────

  getMarkdownFiles(): MockTFile[] {
    return Array.from(this.files.values()).filter((f) => f.extension === "md");
  }

  getAbstractFileByPath(path: string): MockTAbstractFile | null {
    if (this.files.has(path)) return this.files.get(path)!;
    if (this.folders.has(path)) return this.folders.get(path)!;
    return null;
  }

  async read(file: MockTFile): Promise<string> {
    const content = (file as unknown as { _content?: string })._content;
    if (content === undefined) throw new Error(`No _content on ${file.path}`);
    return content;
  }

  async create(path: string, content: string): Promise<MockTFile> {
    if (this.files.has(path) || this.folders.has(path)) {
      throw new Error(`Path already exists: ${path}`);
    }
    this.ensureFolders(path);
    const file = new MockTFile(path);
    (file as unknown as { _content: string })._content = content;
    file.stat.size = content.length;
    file.stat.mtime = Date.now();
    const parent = this.getParent(path);
    if (parent) parent.children.push(file);
    this.files.set(path, file);
    return file;
  }

  async modify(file: MockTFile, content: string): Promise<void> {
    if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
    (file as unknown as { _content: string })._content = content;
    file.stat.size = content.length;
    file.stat.mtime = Date.now();
  }

  async delete(file: MockTAbstractFile): Promise<void> {
    if (file instanceof MockTFile) {
      this.files.delete(file.path);
      if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
    } else {
      this.folders.delete(file.path);
      if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
    }
  }

  async createFolder(path: string): Promise<MockTFolder> {
    if (this.folders.has(path)) return this.folders.get(path)!; // idempotente
    const parent = this.getParent(path);
    const folder = new MockTFolder(path);
    folder.parent = parent;
    this.folders.set(path, folder);
    if (parent) parent.children.push(folder);
    if (this.adapter) {
      // Mantener adapter sincronizado
      try { await this.adapter.mkdir(path); } catch { /* ignore */ }
    }
    return folder;
  }

  async rename(file: MockTAbstractFile, newPath: string): Promise<void> {
    // Implementación simplificada
    if (file instanceof MockTFile) {
      this.files.delete(file.path);
      file.path = newPath;
      file.name = newPath.split("/").pop() ?? "";
      this.files.set(newPath, file);
    }
  }

  // Helpers para tests
  __setRawFile(path: string, content: string) {
    this.ensureFolders(path);
    const file = new MockTFile(path);
    (file as unknown as { _content: string })._content = content;
    file.stat.size = content.length;
    this.files.set(path, file);
    const parent = this.getParent(path);
    if (parent && !parent.children.includes(file)) parent.children.push(file);
    return file;
  }

  __reset() {
    this.files.clear();
    this.folders.clear();
    this.folders.set("/", new MockTFolder("/"));
  }
}

// ─── MetadataCache ──────────────────────────────────────────────────────

export class MockMetadataCache {
  private cache = new Map<string, { frontmatter?: Record<string, unknown>; tags?: string[] }>();

  getFileCache(file: MockTFile): { frontmatter?: Record<string, unknown>; tags?: string[] } | null {
    return this.cache.get(file.path) ?? null;
  }

  setCache(path: string, data: { frontmatter?: Record<string, unknown>; tags?: string[] }) {
    this.cache.set(path, data);
  }
}

// ─── Workspace ──────────────────────────────────────────────────────────

export class MockWorkspace {
  activeFile: MockTFile | null = null;
  private leaves: { view: unknown }[] = [];
  onLayoutReadyCallbacks: (() => void)[] = [];

  getActiveFile(): MockTFile | null {
    return this.activeFile;
  }

  openLinkText(_path: string, _source: string, _newLeaf: boolean): Promise<void> {
    return Promise.resolve();
  }

  getLeavesOfType(_type: string) {
    return this.leaves;
  }

  getRightLeaf(_split: boolean) {
    return null;
  }

  revealLeaf(leaf: { view: unknown }) {
    // No-op
  }

  onLayoutReady(cb: () => void) {
    this.onLayoutReadyCallbacks.push(cb);
    // Ejecutar inmediatamente en test
    queueMicrotask(cb);
  }
}

// ─── DataAdapter (FileSystemAdapter simplificado) ──────────────────────

export class MockAdapter {
  private folders = new Set<string>(["/"]);
  private files = new Map<string, { content: string; ctime: number; mtime: number; size: number }>();
  private binaries = new Map<string, ArrayBuffer>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.write(path, content);
    }
  }

  async exists(path: string): Promise<boolean> {
    if (this.folders.has(path)) return true;
    if (this.files.has(path)) return true;
    if (this.binaries.has(path)) return true;
    return false;
  }

  async stat(path: string): Promise<{ size: number; ctime: number; mtime: number } | null> {
    const f = this.files.get(path) ?? this.binaries.get(path);
    if (!f) return null;
    if (f instanceof ArrayBuffer) return { size: f.byteLength, ctime: Date.now(), mtime: Date.now() };
    return { size: f.size, ctime: f.ctime, mtime: f.mtime };
  }

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`File not found: ${path}`);
    return f.content;
  }

  async write(path: string, content: string, _opts?: unknown): Promise<void> {
    this.files.set(path, { content, size: content.length, ctime: Date.now(), mtime: Date.now() });
    // Asegurar que las carpetas padre existen
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.folders.add(parts.slice(0, i).join("/") || "/");
    }
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.binaries.set(path, content);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.folders.add(parts.slice(0, i).join("/") || "/");
    }
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const f = this.binaries.get(path);
    if (f) return f;
    // Si es texto, devolver como bytes UTF-8
    const txt = this.files.get(path);
    if (txt) {
      const enc = new TextEncoder();
      return enc.encode(txt.content).buffer;
    }
    throw new Error(`File not found: ${path}`);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.binaries.delete(path);
  }

  async list(folderPath: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders: string[] = [];
    const prefix = folderPath === "/" ? "" : folderPath;
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix + "/")) files.push(f);
    }
    for (const f of this.binaries.keys()) {
      if (f.startsWith(prefix + "/")) files.push(f);
    }
    for (const fd of this.folders) {
      if (fd === "/") continue;
      if (fd.startsWith(prefix + "/")) folders.push(fd);
    }
    return { files: Array.from(new Set(files)), folders: Array.from(new Set(folders)) };
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (f) {
      this.files.set(to, f);
      this.files.delete(from);
    }
    const b = this.binaries.get(from);
    if (b) {
      this.binaries.set(to, b);
      this.binaries.delete(from);
    }
  }

  getName() {
    return "mock-adapter";
  }
}

// ─── App ────────────────────────────────────────────────────────────────

export class MockApp {
  vault: MockVault;
  metadataCache = new MockMetadataCache();
  workspace = new MockWorkspace();
  adapter: MockAdapter;
  private fileContents = new Map<string, string>();

  constructor(initialFiles: Record<string, string> = {}) {
    this.adapter = new MockAdapter(initialFiles);
    this.vault = new MockVault(this.adapter);
  }

  loadData = vi.fn(async () => ({ settings: this.fileContents }));
  saveData = vi.fn(async (data: unknown) => {
    this.fileContents = data as Map<string, string>;
    return Promise.resolve();
  });
}

// ─── Plugin base ────────────────────────────────────────────────────────

export class MockPlugin {
  app: MockApp;
  manifest = { id: "m-nexus", name: "M-NEXUS", version: "0.5.0", minAppVersion: "1.5.0" };
  constructor(app: MockApp) {
    this.app = app;
  }
  addCommand = vi.fn();
  addSettingTab = vi.fn();
  addRibbonIcon = vi.fn();
  registerView = vi.fn();
  registerInterval = vi.fn();
  loadData = vi.fn();
  saveData = vi.fn();
}

// ─── Notice ─────────────────────────────────────────────────────────────

export class MockNotice {
  constructor(public message: string, public timeout?: number) {}
  hide() {}
  setMessage(msg: string) { this.message = msg; }
}

// ─── Modal / ItemView / PluginSettingTab ───────────────────────────────

export class MockModal {
  app: MockApp;
  contentEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  constructor(app: MockApp) {
    this.app = app;
    this.contentEl = document.createElement("div");
    this.modalEl = document.createElement("div");
    this.titleEl = document.createElement("div");
  }
  open() { this.modalEl.style.display = "block"; }
  close() { this.modalEl.style.display = "none"; }
  onOpen() {}
  onClose() {}
}

export class MockItemView {
  app: MockApp;
  containerEl: HTMLElement;
  constructor(_leaf: unknown, app: MockApp) {
    this.app = app;
    this.containerEl = document.createElement("div");
    const inner = document.createElement("div");
    this.containerEl.appendChild(inner);
  }
  getViewType() { return "mock"; }
  getDisplayText() { return "Mock"; }
  getIcon() { return "file"; }
  onOpen() {}
  onClose() {}
}

export class MockPluginSettingTab {
  app: MockApp;
  plugin: unknown;
  containerEl: HTMLElement;
  constructor(app: MockApp, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }
  display() {}
}

export class MockSetting {
  settingEl: HTMLElement;
  constructor(_containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
  }
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addText(cb: (t: { setValue: (v: string) => MockText; onChange: (cb: (v: string) => unknown) => MockText; inputEl: HTMLInputElement }) => void) {
    const t = { setValue: () => t, onChange: () => t, inputEl: document.createElement("input") };
    cb(t);
    return this;
  }
  addTextArea(cb: (t: MockText) => void) { const t = { setValue: () => t, onChange: () => t, inputEl: document.createElement("textarea") }; cb(t); return this; }
  addToggle(cb: (t: { setValue: (v: boolean) => unknown; onChange: (cb: (v: boolean) => unknown) => unknown }) => void) { const t = { setValue: () => t, onChange: () => t }; cb(t); return this; }
  addSlider(cb: (t: { setLimits: () => MockSlider; setValue: () => MockSlider; setDynamicTooltip: () => MockSlider; onChange: () => MockSlider }) => void) { const t = { setLimits: () => t, setValue: () => t, setDynamicTooltip: () => t, onChange: () => t }; cb(t); return this; }
  addDropdown(cb: (t: { addOption: () => MockDropdown; setValue: () => MockDropdown; onChange: () => MockDropdown }) => void) { const t = { addOption: () => t, setValue: () => t, onChange: () => t }; cb(t); return this; }
}
type MockText = { setValue: (v: string) => MockText; onChange: (cb: (v: string) => unknown) => MockText; inputEl: HTMLInputElement };
type MockSlider = { setLimits: () => MockSlider; setValue: () => MockSlider; setDynamicTooltip: () => MockSlider; onChange: () => MockSlider };
type MockDropdown = { addOption: () => MockDropdown; setValue: () => MockDropdown; onChange: () => MockDropdown };

// ─── requestUrl ─────────────────────────────────────────────────────────

type RequestUrlParam = { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean };
type RequestUrlResult = { status: number; text: string; headers?: Record<string, string>; arrayBuffer?: { bytes: ArrayBuffer } };

export const mockRequestUrl = vi.fn(async (param: RequestUrlParam): Promise<RequestUrlResult> => {
  // Si hay un handler global configurado por el test, úsalo
  const handler = (globalThis as { __requestUrlHandler?: (p: RequestUrlParam) => Promise<RequestUrlResult> }).__requestUrlHandler;
  if (handler) return handler(param);
  // Default: 200 OK con JSON vacío
  return { status: 200, text: "{}", headers: {} };
});

// ─── normalizePath / parseFrontMatterTags ──────────────────────────────

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "");
}

export function parseFrontMatterTags(fm: Record<string, unknown>): string[] {
  if (Array.isArray(fm.tags)) return (fm.tags as unknown[]).map(String);
  if (typeof fm.tags === "string") return fm.tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

// ─── Hook para vitest resolver `obsidian` ──────────────────────────────

export const obsidianMock = {
  App: MockApp,
  Plugin: MockPlugin,
  PluginSettingTab: MockPluginSettingTab,
  Setting: MockSetting,
  TFile: MockTFile,
  TFolder: MockTFolder,
  TAbstractFile: MockTAbstractFile,
  Modal: MockModal,
  ItemView: MockItemView,
  Notice: MockNotice,
  requestUrl: mockRequestUrl,
  normalizePath,
  parseFrontMatterTags,
  Vault: MockVault,
  Workspace: MockWorkspace,
  MetadataCache: MockMetadataCache,
};

// Helper para tests: crear un App mock con un vault pre-poblado
export default obsidianMock;

// Re-exports de propiedades de obsidianMock para que `import { requestUrl } from "obsidian"` funcione.
// (Los que NO colisionan con funciones ya exportadas.)
export const App = obsidianMock.App;
export const Plugin = obsidianMock.Plugin;
export const PluginSettingTab = obsidianMock.PluginSettingTab;
export const Setting = obsidianMock.Setting;
export const TFile = obsidianMock.TFile;
export const TFolder = obsidianMock.TFolder;
export const TAbstractFile = obsidianMock.TAbstractFile;
export const Modal = obsidianMock.Modal;
export const ItemView = obsidianMock.ItemView;
export const Notice = obsidianMock.Notice;
export const requestUrl = obsidianMock.requestUrl;
export const Vault = obsidianMock.Vault;
export const Workspace = obsidianMock.Workspace;
export const MetadataCache = obsidianMock.MetadataCache;

export function makeMockApp(initialFiles: Record<string, string> = {}): MockApp {
  const app = new MockApp(initialFiles);
  for (const [path, content] of Object.entries(initialFiles)) {
    app.vault.__setRawFile(path, content);
    // Si tiene frontmatter, parsearlo para metadataCache
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (m) {
      const fm: Record<string, unknown> = {};
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([\w_-]+):\s*(.+)$/);
        if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
      }
      const tags = parseFrontMatterTags(fm);
      app.metadataCache.setCache(path, { frontmatter: fm, tags });
    }
  }
  return app;
}
