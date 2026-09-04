// ConflictResolver: estrategia para sincronizar notas entre dispositivos.
//
// v0.33: usamos Last-Write-Wins (LWW) por campo, no por nota entera.
// Esto evita sobreescrituras silenciosas cuando el usuario edita
// la flashcard X en el móvil y la nota Y en el vault, y luego ambos
// cambios se sincronizan.
//
// Cada campo tiene:
//   - value: el contenido actual
//   - version: vector [deviceId1: clock1, deviceId2: clock2, ...]
//   - updatedBy: deviceId que hizo el último cambio
//   - updatedAt: timestamp del último cambio
//
// Reglas de resolución:
// 1. Si la versión local es más reciente (clock mayor) → gana local
// 2. Si la versión remota es más reciente → gana remoto
// 3. Si son iguales (mismo clock) → gana el que tenga updatedAt mayor
// 4. Si todo es igual → el orden de deviceId (alfabético) decide (determinista)
//
// Para "fields" específicos (ej. front/back de una flashcard), LWW
// por campo permite que el front cambiado en el móvil se quede con
// la versión del móvil, mientras el back cambiado en el vault se
// queda con la versión del vault. Sin perder nada.

import { createHash } from "node:crypto";

export type DeviceClock = Record<string, number>;

export interface VersionedField<T = unknown> {
  value: T;
  /** Vector clock: mapea deviceId -> contador de cambios hechos por ese device. */
  clock: DeviceClock;
  /** DeviceId que hizo el último cambio. */
  updatedBy: string;
  /** Timestamp del último cambio (epoch ms). */
  updatedAt: number;
}

export interface FieldDiff {
  field: string;
  resolution: "local" | "remote" | "merged" | "equal";
  reason: string;
}

export interface ConflictReport {
  hasConflict: boolean;
  diffs: FieldDiff[];
  mergedClock: DeviceClock;
  /** Para depuración. */
  details?: Record<string, { localClock: DeviceClock; remoteClock: DeviceClock }>;
}

export class ConflictResolver {
  /**
   * Resuelve un conflicto entre un campo local y uno remoto, LWW por field.
   * Devuelve el "ganador" y la razón.
   */
  resolveField<T>(
    fieldName: string,
    local: VersionedField<T> | null,
    remote: VersionedField<T> | null
  ): { value: T | null; resolution: FieldDiff["resolution"]; reason: string; mergedClock: DeviceClock } {
    if (local == null && remote == null) {
      return { value: null, resolution: "equal", reason: "both null", mergedClock: {} };
    }
    if (local == null) {
      return {
        value: remote!.value,
        resolution: "remote",
        reason: "local is null",
        mergedClock: { ...remote!.clock },
      };
    }
    if (remote == null) {
      return {
        value: local.value,
        resolution: "local",
        reason: "remote is null",
        mergedClock: { ...local.clock },
      };
    }
    if (this.areClocksEqual(local.clock, remote.clock)) {
      // Mismo vector clock. Si los values son iguales → no hay conflicto.
      if (local.value === remote.value) {
        return {
          value: local.value,
          resolution: "equal",
          reason: "equal clock, equal value",
          mergedClock: { ...local.clock },
        };
      }
      if (local.updatedAt === remote.updatedAt) {
        // Mismo timestamp: orden alfabético determinista
        const winner = local.updatedBy < remote.updatedBy ? local : remote;
        return {
          value: winner.value,
          resolution: "local" as const,
          reason: `equal clock, equal ts, deviceId order: ${winner.updatedBy}`,
          mergedClock: { ...winner.clock },
        };
      }
      const winner = local.updatedAt > remote.updatedAt ? local : remote;
      return {
        value: winner.value,
        resolution: winner === local ? "local" : "remote",
        reason: `equal clock, newer ts: ${winner.updatedBy}@${winner.updatedAt}`,
        mergedClock: { ...winner.clock },
      };
    }
    // Clocks distintos: el que es estrictamente mayor (o concurrent) gana
    const cmp = this.compareClocks(local.clock, remote.clock);
    if (cmp > 0) {
      return {
        value: local.value,
        resolution: "local",
        reason: `local clock dominates (${this.formatClock(local.clock)} > ${this.formatClock(remote.clock)})`,
        mergedClock: { ...local.clock },
      };
    }
    if (cmp < 0) {
      return {
        value: remote.value,
        resolution: "remote",
        reason: `remote clock dominates (${this.formatClock(remote.clock)} > ${this.formatClock(local.clock)})`,
        mergedClock: { ...remote.clock },
      };
    }
    // Concurrent (LWW). Si mismo ts → tie-break por deviceId (determinista).
    let winner: VersionedField<T>;
    if (local.updatedAt !== remote.updatedAt) {
      winner = local.updatedAt > remote.updatedAt ? local : remote;
    } else {
      // Mismo ts: determinista por deviceId (menor alfabético gana)
      winner = local.updatedBy <= remote.updatedBy ? local : remote;
    }
    const mergedClock = this.mergeClocks(local.clock, remote.clock);
    return {
      value: winner.value,
      resolution: winner === local ? "local" : "remote",
      reason: `concurrent clocks, LWW by ts+deviceId: ${winner.updatedBy}@${winner.updatedAt}`,
      mergedClock,
    };
  }

  /**
   * Compara dos vector clocks. Retorna:
   *  > 0 si a > b (a domina)
   *  < 0 si a < b (b domina)
   *    0 si concurrentes o iguales
   */
  compareClocks(a: DeviceClock, b: DeviceClock): number {
    const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);
    let aGreater = false;
    let bGreater = false;
    for (const d of allDevices) {
      const av = a[d] ?? 0;
      const bv = b[d] ?? 0;
      if (av > bv) aGreater = true;
      if (av < bv) bGreater = true;
    }
    if (aGreater && !bGreater) return 1;
    if (bGreater && !aGreater) return -1;
    return 0;
  }

  /** True si dos clocks son idénticos. */
  areClocksEqual(a: DeviceClock, b: DeviceClock): boolean {
    const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const d of allDevices) {
      if ((a[d] ?? 0) !== (b[d] ?? 0)) return false;
    }
    return true;
  }

  /** Merge de clocks: para cada device, max(a[d], b[d]). */
  mergeClocks(a: DeviceClock, b: DeviceClock): DeviceClock {
    const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: DeviceClock = {};
    for (const d of allDevices) {
      out[d] = Math.max(a[d] ?? 0, b[d] ?? 0);
    }
    return out;
  }

  /**
   * Incrementa el clock de un device. Devuelve un nuevo clock.
   */
  incrementClock(clock: DeviceClock, deviceId: string): DeviceClock {
    return { ...clock, [deviceId]: (clock[deviceId] ?? 0) + 1 };
  }

  private formatClock(clock: DeviceClock): string {
    return Object.entries(clock)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, c]) => `${d}:${c}`)
      .join(",");
  }

  /**
   * Resuelve una nota entera (mapa de campos). Cada campo se resuelve
   * independientemente y se devuelve un ConflictReport.
   */
  resolveNote<T = unknown>(
    local: Record<string, VersionedField<T>> | null,
    remote: Record<string, VersionedField<T>> | null,
    localDeviceId: string
  ): { resolved: Record<string, VersionedField<T>>; report: ConflictReport } {
    const localFields = local ?? {};
    const remoteFields = remote ?? {};
    const allFieldNames = new Set([...Object.keys(localFields), ...Object.keys(remoteFields)]);
    const resolved: Record<string, VersionedField<T>> = {};
    const diffs: FieldDiff[] = [];
    const details: Record<string, { localClock: DeviceClock; remoteClock: DeviceClock }> = {};
    let mergedClock: DeviceClock = {};

    for (const field of allFieldNames) {
      const lf = localFields[field] ?? null;
      const rf = remoteFields[field] ?? null;
      const res = this.resolveField(field, lf, rf);
      details[field] = {
        localClock: lf?.clock ?? {},
        remoteClock: rf?.clock ?? {},
      };
      diffs.push({ field, resolution: res.resolution, reason: res.reason });
      if (res.value !== null) {
        resolved[field] = {
          value: res.value,
          clock: res.mergedClock,
          updatedBy: res.resolution === "remote" ? rf!.updatedBy : lf?.updatedBy ?? localDeviceId,
          updatedAt: res.resolution === "remote" ? rf!.updatedAt : lf?.updatedAt ?? Date.now(),
        };
      }
      mergedClock = this.mergeClocks(mergedClock, res.mergedClock);
    }

    return {
      resolved,
      report: {
        hasConflict: diffs.some((d) => d.resolution !== "equal"),
        diffs,
        mergedClock,
        details,
      },
    };
  }

  /**
   * Hash determinista para detectar cambios en campos complejos.
   * Se usa para evitar escrituras redundantes en el backend.
   */
  static hashValue(value: unknown): string {
    const json = JSON.stringify(value, Object.keys(value as object).sort());
    return createHash("sha256").update(json).digest("hex");
  }
}
