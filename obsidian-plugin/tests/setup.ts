// Setup global de tests.
// El mock de Obsidian se aplica vía alias en vitest.config.ts (obsidian → tests/mockObsidian.ts).
// Aquí solo configuramos polyfills y globales.

// Polyfill de fetch si jsdom no lo trae
if (typeof globalThis.fetch === "undefined") {
  (globalThis as { fetch: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
}

// Polyfill de crypto: usar webcrypto de Node 18+ (ofrece subtle, randomUUID, getRandomValues, etc.)
import { webcrypto } from "node:crypto";
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Polyfill de TextEncoder/TextDecoder (puede faltar en jsdom antiguos)
import { TextEncoder, TextDecoder } from "node:util";
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  (globalThis as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
  (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
}

// localStorage mínimo en jsdom
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const map = new Map<string, string>();
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}
