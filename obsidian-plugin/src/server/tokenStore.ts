// TokenStore: persiste y rota los tokens JWT del backend.
// v0.12: reemplaza el antiguo backendToken estático.

export interface StoredTokens {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  serverVersion: string;
}

export interface TokenStore {
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

const STORAGE_KEY = "m-nexus-tokens-v1";

export function createLocalTokenStore(): TokenStore {
  return {
    load() {
      const raw = localStorage?.getItem?.(STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StoredTokens;
      } catch {
        return null;
      }
    },
    save(tokens) {
      try {
        localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(tokens));
      } catch {
        // localStorage puede no estar disponible en sandbox tests
      }
    },
    clear() {
      try {
        localStorage?.removeItem?.(STORAGE_KEY);
      } catch {
        // noop
      }
    },
  };
}

/** Store en memoria — para tests, sin localStorage. */
export function createMemoryTokenStore(): TokenStore {
  let data: StoredTokens | null = null;
  return {
    load: () => data,
    save: (t) => { data = t; },
    clear: () => { data = null; },
  };
}
