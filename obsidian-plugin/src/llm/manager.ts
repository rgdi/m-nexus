// LLM Manager: punto único de acceso al LLM activo.
// Resuelve el provider según settings.llmProvider y cachea la instancia.

import { App } from "obsidian";
import { LLMProvider, ProviderFactory } from "./provider";
import { OpenRouterProvider } from "./openrouter";
import { OllamaProvider } from "./ollama";
import { MNexusSettings, LLMProviderId } from "../types";
import { Logger } from "../utils/logger";

export class LLMManager {
  private current: LLMProvider | null = null;
  private currentId: LLMProviderId | null = null;
  private remoteProvider: LLMProvider | null = null;

  /** Registry de providers. Para añadir uno nuevo, basta con push aquí. */
  private factories: Record<LLMProviderId, ProviderFactory | null> = {
    openrouter: () => new OpenRouterProvider(this.settings, this.log),
    ollama: () => new OllamaProvider(this.settings, this.log),
    "openai-compatible": null, // placeholder para futuro
    remote: null, // provider remoto se inyecta con setRemoteProvider()
    disabled: () => ({
      id: "disabled",
      name: "Deshabilitado",
      isConfigured: () => false,
      getStatus: async () => ({ provider: "disabled", configured: false }),
      listModels: async () => [],
      complete: async () => {
        throw new Error("LLM deshabilitado en ajustes.");
      },
      chat: async () => {
        throw new Error("LLM deshabilitado en ajustes.");
      },
      streamChat: async function* () {
        throw new Error("LLM deshabilitado en ajustes.");
      },
      completeJson: async () => {
        throw new Error("LLM deshabilitado en ajustes.");
      },
      chatJson: async () => {
        throw new Error("LLM deshabilitado en ajustes.");
      },
    }),
  };

  /**
   * Inyecta el provider remoto para que tenga prioridad cuando
   * settings.forceRemote=true. Llamar desde main.ts tras initThinClient().
   */
  setRemoteProvider(provider: LLMProvider | null) {
    this.remoteProvider = provider;
  }

  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger
  ) {}

  /** Devuelve el provider activo (lazy-init). Lanza si no hay uno configurado. */
  getProvider(): LLMProvider {
    if (this.settings.forceRemote && this.remoteProvider?.isConfigured()) {
      return this.remoteProvider;
    }
    const id = this.settings.llmProvider;
    if (id === "disabled") {
      throw new Error("LLM deshabilitado. Actívalo en Ajustes → M-NEXUS → LLM.");
    }
    if (this.current && this.currentId === id) return this.current;
    const factory = this.factories[id];
    if (!factory) {
      throw new Error(
        `Provider LLM '${id}' no está implementado. Edita src/llm/manager.ts para añadirlo.`
      );
    }
    this.current = factory();
    this.currentId = id;
    return this.current;
  }

  /** Provider activo: respeta forceRemote y devuelve el remoto si está configurado. */
  getActiveProvider(forceRemoteProvider?: LLMProvider): LLMProvider {
    if (this.settings.forceRemote && forceRemoteProvider?.isConfigured()) {
      return forceRemoteProvider;
    }
    return this.getProvider();
  }

  /** Devuelve el provider activo o null si no está configurado. */
  tryGetProvider(): LLMProvider | null {
    try {
      const p = this.getProvider();
      if (!p.isConfigured()) return null;
      return p;
    } catch {
      return null;
    }
  }

  /** Helper: devuelve true si hay LLM listo para usar. */
  isAvailable(): boolean {
    return this.tryGetProvider() !== null;
  }

  /** Stream chat directo al provider activo. */
  streamChat(messages: import("../types").LLMMessage[], options?: import("../types").CompletionOptions): AsyncIterable<string> {
    return this.getProvider().streamChat(messages, options);
  }

  /** Registra un provider nuevo. Llamar antes de getProvider(). */
  registerProvider(id: LLMProviderId, factory: ProviderFactory) {
    this.factories[id] = factory;
    // Si el activo coincide, invalidar cache
    if (this.currentId === id) this.current = null;
  }
}
