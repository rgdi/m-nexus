// ConflictResolver: estrategia de resolución de conflictos vault ↔ servidor.
// v0.6: las políticas son:
//   - "local-wins": siempre mantener la versión local
//   - "server-wins": siempre aceptar la del servidor
//   - "newer-wins": comparar modifiedAt, gana la más reciente
//   - "manual": devolver acción "ask" para que el usuario decida

export type ConflictAction = "keep-local" | "keep-remote" | "ask";

export interface ConflictInput {
  path: string;
  localHash: string;
  remoteHash: string;
  /** Timestamp de la versión remota (ISO). */
  modifiedAt: string;
  strategy: "local-wins" | "server-wins" | "newer-wins" | "manual";
  /** Timestamp local opcional (si se conoce). */
  localModifiedAt?: string;
}

export interface ConflictOutput {
  path: string;
  action: ConflictAction;
  reason: string;
}

export class ConflictResolver {
  /**
   * Resuelve un conflicto aplicando la estrategia configurada.
   * Devuelve una acción; si es "ask", el caller debe pedir al usuario.
   */
  async resolve(input: ConflictInput): Promise<ConflictOutput> {
    if (input.localHash === input.remoteHash) {
      return { path: input.path, action: "keep-local", reason: "hashes idénticos" };
    }
    switch (input.strategy) {
      case "local-wins":
        return { path: input.path, action: "keep-local", reason: "estrategia: local-wins" };
      case "server-wins":
        return { path: input.path, action: "keep-remote", reason: "estrategia: server-wins" };
      case "newer-wins": {
        const local = input.localModifiedAt ? new Date(input.localModifiedAt).getTime() : 0;
        const remote = new Date(input.modifiedAt).getTime();
        if (local > remote) {
          return { path: input.path, action: "keep-local", reason: `local es más nuevo (${input.localModifiedAt})` };
        }
        return { path: input.path, action: "keep-remote", reason: `remote es más nuevo (${input.modifiedAt})` };
      }
      case "manual":
      default:
        return { path: input.path, action: "ask", reason: "decisión manual requerida" };
    }
  }
}
