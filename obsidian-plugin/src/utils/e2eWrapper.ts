// E2E wrapper: si la nota está marcada como `encrypt: true` en frontmatter,
// cifra el contenido antes de enviarlo al servidor y descifra al recibirlo.

import type { E2EManager } from "./e2e.js";
import { Logger } from "./logger.js";

const logger = new Logger("[m-nexus-e2e]");

const ENCRYPTED_MARKER = "<!--m-nexus-e2e:v1-->";

export interface NoteContent {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface SyncEnvelope {
  path: string;
  /** Texto plano O texto cifrado con marker. */
  content: string;
  frontmatter?: Record<string, unknown>;
  isEncrypted: boolean;
}

export class E2EWrapper {
  constructor(private e2e: E2EManager) {}

  async wrap(note: NoteContent): Promise<SyncEnvelope> {
    const encrypt = note.frontmatter?.encrypt === true;
    if (!encrypt) {
      return { path: note.path, content: note.content, frontmatter: note.frontmatter, isEncrypted: false };
    }
    if (!this.e2e.hasKey()) {
      throw new Error("E2E: la nota requiere cifrado pero no hay clave. Genera una en Settings → E2E.");
    }
    const enc = await this.e2e.encrypt(note.content);
    const wrapped = `${ENCRYPTED_MARKER}${JSON.stringify(enc)}`;
    // En el frontmatter, marcamos explícitamente
    const fm = { ...(note.frontmatter ?? {}), encrypt: true, e2e_alg: enc.alg };
    return { path: note.path, content: wrapped, frontmatter: fm, isEncrypted: true };
  }

  async unwrap(envelope: SyncEnvelope): Promise<NoteContent> {
    if (!envelope.isEncrypted) {
      return { path: envelope.path, content: envelope.content, frontmatter: envelope.frontmatter };
    }
    if (!envelope.content.startsWith(ENCRYPTED_MARKER)) {
      logger.warn(`E2E marker ausente en ${envelope.path}; nota marcada como cifrada`);
      return { path: envelope.path, content: envelope.content, frontmatter: envelope.frontmatter };
    }
    const json = envelope.content.slice(ENCRYPTED_MARKER.length);
    const enc = JSON.parse(json) as { alg: string; iv: string; ct: string };
    const plain = await this.e2e.decrypt(enc);
    return { path: envelope.path, content: plain, frontmatter: envelope.frontmatter };
  }
}
