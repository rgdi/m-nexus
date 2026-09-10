// Config: variables de entorno y defaults.

import "dotenv/config";

export interface BackendConfig {
  port: number;
  host: string;
  /** Si true, requiere Authorization: Bearer en todos los endpoints excepto /health. */
  authRequired: boolean;
  /** Secret para firmar tokens JWT. */
  jwtSecret: string;
  /** Path al binario de Whisper (faster-whisper o whisper.cpp). */
  whisperBinary: string;
  /** Path al binario de Tesseract. */
  tesseractBinary: string;
  /** URL del servidor Ollama. */
  ollamaBaseUrl: string;
  /** API key de OpenRouter. */
  openrouterApiKey: string;
  /** Modelo de embeddings por defecto. */
  embeddingModel: string;
  /** Rate limit por minuto por deviceId. */
  rateLimitPerMinute: number;
  /** v0.13: tamaño máximo del cache de embeddings. */
  embeddingCacheSize: number;
  /** v0.13: ruta del cache persistente (opcional). */
  embeddingCachePath: string | undefined;
  /** v0.28: ruta del directorio de backups (un archivo .zip por backup, drag-and-drop). */
  backupStoragePath: string;
  /** v0.28: ruta del archivo SQLite de índice de backups. */
  backupIndexPath: string;
  /** v0.28: tamaño máximo de un backup individual (bytes). */
  maxBackupSize: number;
  /** v0.51: directorio donde persistir docs Yjs. */
  crdtDir: string;
}

function getAuthRequired(): boolean {
  return (process.env.AUTH_REQUIRED ?? "true") === "true";
}

/**
 * v0.28: configuración con getters lazy.
 * Los tests pueden setear process.env DESPUÉS de importar este módulo
 * y los cambios se ven reflejados sin necesidad de re-importar.
 */
export const config: BackendConfig = {
  get port() { return parseInt(process.env.PORT ?? "4000", 10); },
  get host() { return process.env.HOST ?? "0.0.0.0"; },
  get authRequired() { return getAuthRequired(); },
  get jwtSecret() {
    // v0.47.12: fail-fast si JWT_SECRET no está seteado o es débil.
    // Antes: default hardcodeado "change-me-in-production" (público en el repo)
    // permitía auth bypass trivial: cualquiera podía firmar tokens con cualquier
    // deviceId. Ver AUDIT_REPORT.md SEC-2.
    const s = process.env.JWT_SECRET;
    if (!s) {
      throw new Error(
        "JWT_SECRET must be set. " +
        "Generate one with: openssl rand -hex 32"
      );
    }
    // Lista de substrings prohibidos (case-insensitive). Cubre los defaults
    // hardcodeados del proyecto: 'change-me', 'change-me-in-production'.
    // No incluimos 'test' ni 'dev' porque son demasiado comunes y romperían
    // setup de tests y nombres de variable. Empty string '' está excluido
    // porque '' está contenido en cualquier string.
    const WEAK_SUBSTRINGS = ["change-me"];
    const lower = s.toLowerCase();
    if (WEAK_SUBSTRINGS.some((w) => lower.includes(w))) {
      throw new Error(
        `JWT_SECRET too weak (contains forbidden substring like 'change-me', 'test', 'secret', 'dev'). ` +
        "Generate one with: openssl rand -hex 32"
      );
    }
    if (s.length < 32) {
      throw new Error(
        `JWT_SECRET too short (${s.length} chars, min 32). ` +
        "Generate one with: openssl rand -hex 32"
      );
    }
    return s;
  },
  get whisperBinary() { return process.env.WHISPER_BINARY ?? "whisper"; },
  get tesseractBinary() { return process.env.TESSERACT_BINARY ?? "tesseract"; },
  get ollamaBaseUrl() { return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"; },
  get openrouterApiKey() { return process.env.OPENROUTER_API_KEY ?? ""; },
  get embeddingModel() { return process.env.EMBEDDING_MODEL ?? "nomic-embed-text"; },
  get rateLimitPerMinute() { return parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "120", 10); },
  get embeddingCacheSize() { return parseInt(process.env.EMBEDDING_CACHE_SIZE ?? "10000", 10); },
  get embeddingCachePath() { return process.env.EMBEDDING_CACHE_PATH; },
  // v0.28: backups ultrarrápidos — un .zip por backup en disco + índice SQLite
  get backupStoragePath() { return process.env.BACKUP_STORAGE_PATH ?? "/var/lib/mnexus/backups"; },
  get backupIndexPath() { return process.env.BACKUP_INDEX_PATH ?? "/var/lib/mnexus/backups-index.db"; },
  get maxBackupSize() { return parseInt(process.env.MAX_BACKUP_SIZE ?? String(500 * 1024 * 1024), 10); },
  // v0.51: CRDT persistence dir
  get crdtDir() { return process.env.CRDT_DIR ?? "./.m-nexus-crdt"; },
} as BackendConfig;
