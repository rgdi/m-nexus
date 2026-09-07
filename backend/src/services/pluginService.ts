// pluginService.ts: Plugin API estilo Obsidian (Fase 6).
//
// v0.46: permite a developers crear plugins que extiendan M-NEXUS.
// Un plugin es un objeto JS con hooks (onNoteCreated, onReviewComplete, etc).
// Se ejecuta en sandbox con permisos limitados (whitelist de APIs).

import { randomUUID } from "node:crypto";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Hooks implementados por este plugin */
  hooks: PluginHook[];
  /** Permisos requeridos */
  permissions: PluginPermission[];
  /** Settings schema (opcional) */
  settingsSchema?: Array<{
    key: string;
    type: "string" | "number" | "boolean";
    default: unknown;
    description: string;
  }>;
}

export type PluginHook =
  | "onNoteCreated"
  | "onNoteUpdated"
  | "onNoteDeleted"
  | "onReviewComplete"
  | "onSessionStart"
  | "onSessionEnd"
  | "onDailyNoteCreated"
  | "onGraphUpdate";

export type PluginPermission =
  | "read_notes"
  | "write_notes"
  | "read_tags"
  | "write_tags"
  | "read_search"
  | "read_stats"
  | "http_request"
  | "file_system"
  | "clipboard";

export interface PluginEvent {
  hook: PluginHook;
  payload: unknown;
  timestamp: number;
}

export interface PluginContext {
  /** Settings del plugin */
  settings: Record<string, unknown>;
  /** API expuesta (whitelist) */
  api: PluginAPI;
}

export interface PluginAPI {
  /** Logger */
  log(...args: unknown[]): void;
  /** Get current settings */
  getSettings(): Record<string, unknown>;
  /** Update settings */
  setSetting(key: string, value: unknown): void;
  /** Get info del plugin */
  getInfo(): { id: string; name: string; version: string };
  /** Storage local (key-value, scoped al plugin) */
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
}

export class PluginService {
  private manifests: Map<string, PluginManifest> = new Map();
  private enabled: Set<string> = new Set();
  private storage: Map<string, Map<string, unknown>> = new Map();
  private eventLog: PluginEvent[] = [];

  /**
   * Registra un plugin.
   */
  register(manifest: PluginManifest): void {
    this.manifests.set(manifest.id, manifest);
    if (!this.storage.has(manifest.id)) {
      this.storage.set(manifest.id, new Map());
    }
  }

  /**
   * Habilita un plugin.
   */
  enable(id: string): boolean {
    if (!this.manifests.has(id)) return false;
    this.enabled.add(id);
    return true;
  }

  /**
   * Deshabilita un plugin.
   */
  disable(id: string): boolean {
    return this.enabled.delete(id);
  }

  /**
   * Elimina un plugin.
   */
  unregister(id: string): boolean {
    const existed = this.manifests.delete(id);
    this.enabled.delete(id);
    this.storage.delete(id);
    return existed;
  }

  /**
   * Lista todos los plugins registrados.
   */
  list(): PluginManifest[] {
    return Array.from(this.manifests.values());
  }

  /**
   * Lista plugins habilitados.
   */
  listEnabled(): PluginManifest[] {
    return this.list().filter((p) => this.enabled.has(p.id));
  }

  /**
   * Obtiene un plugin por ID.
   */
  get(id: string): PluginManifest | null {
    return this.manifests.get(id) ?? null;
  }

  /**
   * Dispara un evento a todos los plugins habilitados que tengan ese hook.
   * Los plugins ejecutan sus handlers (asume que los plugins están cargados
   * en un sandbox separado — esto solo emite el evento).
   */
  emit(hook: PluginHook, payload: unknown): void {
    const event: PluginEvent = {
      hook,
      payload,
      timestamp: Date.now(),
    };
    this.eventLog.push(event);
    // Limita el log a 1000 eventos
    if (this.eventLog.length > 1000) {
      this.eventLog.shift();
    }
    // Aquí se ejecutarían los handlers en el sandbox
    // (no implementado en backend — se hace en app/Flutter)
  }

  /**
   * Devuelve los últimos N eventos.
   */
  recentEvents(limit = 50): PluginEvent[] {
    return this.eventLog.slice(-limit);
  }

  /**
   * Crea un contexto para un plugin (con API whitelisted).
   */
  createContext(id: string, settings: Record<string, unknown> = {}): PluginContext | null {
    const manifest = this.manifests.get(id);
    if (!manifest) return null;
    const storage = this.storage.get(id) ?? new Map();
    this.storage.set(id, storage);
    return {
      settings,
      api: {
        log: (...args) => {
          console.log(`[Plugin ${manifest.name}]`, ...args);
        },
        getSettings: () => ({ ...settings }),
        setSetting: (key, value) => {
          settings[key] = value;
        },
        getInfo: () => ({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
        }),
        storage: {
          get: (key) => storage.get(key),
          set: (key, value) => storage.set(key, value),
          delete: (key) => storage.delete(key),
        },
      },
    };
  }

  /**
   * Valida un manifest.
   */
  static validate(manifest: PluginManifest): string[] {
    const errors: string[] = [];
    if (!manifest.id || !/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push("id must be kebab-case");
    }
    if (!manifest.name) errors.push("name required");
    if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push("version must be semver");
    }
    if (!manifest.author) errors.push("author required");
    if (!Array.isArray(manifest.hooks)) errors.push("hooks must be array");
    if (!Array.isArray(manifest.permissions)) errors.push("permissions must be array");
    return errors;
  }

  /**
   * Genera un ID único para un plugin nuevo.
   */
  static generateId(): string {
    return "plugin-" + randomUUID().slice(0, 8);
  }

  /**
   * Stats del sistema de plugins.
   */
  stats(): { totalPlugins: number; enabledPlugins: number; totalEvents: number } {
    return {
      totalPlugins: this.manifests.size,
      enabledPlugins: this.enabled.size,
      totalEvents: this.eventLog.length,
    };
  }
}
