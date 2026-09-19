// crdt.ts — Vector clock + field-level LWW conflict resolution for sync (v2.15.0).
//
// Modeled on Riak's vector clocks + DynamoDB-style last-write-wins, but
// per-field instead of per-row. Each sync message carries:
//   - clock: { [clientId]: seqNumber }  → causal ordering
//   - fieldTimestamps: { [field]: ts } → per-field last-write ts
//   - data: { ... }                    → the new field values
//
// Resolution rules at the receiver (applied before applying):
// 1. If incoming clock dominates local clock → accept fully (causally later).
// 2. If local clock dominates incoming → reject silently (already applied).
// 3. If neither dominates (concurrent edits) →
//    merge field-by-field: keep newer per-field timestamp. Equal ts → keep
//    local (deterministic tie-break).

export type VectorClock = Record<string, number>;
export type FieldTimestamps = Record<string, number>;

export interface CRDTMessage<T = any> {
  clientId: string;
  clock: VectorClock;            // monotonic per-client counter
  fieldTimestamps: FieldTimestamps; // per-field timestamps (when data[field] was set)
  data: T;                       // the actual payload (subset of fields edited)
  parent?: VectorClock;          // optional: the clock this client observed before writing
}

/** Clock dominates: a >_C b iff for all k, a[k] >= b[k], and exists k where a[k] > b[k]. */
export function clockDominates(a: VectorClock, b: VectorClock): boolean {
  let anyGt = false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] || 0;
    const bv = b[k] || 0;
    if (av < bv) return false;
    if (av > bv) anyGt = true;
  }
  return anyGt;
}

export function clockEqual(a: VectorClock, b: VectorClock): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] || 0) !== (b[k] || 0)) return false;
  }
  return true;
}

/**
 * Compare two clocks: returns
 *  - "after" if a dominates b
 *  - "before" if b dominates a (a is older)
 *  - "concurrent" if neither dominates (true conflict)
 */
export function compareClocks(a: VectorClock, b: VectorClock): "after" | "before" | "concurrent" {
  const aD = clockDominates(a, b);
  const bD = clockDominates(b, a);
  if (aD && !bD) return "after";
  if (bD && !aD) return "before";
  if (clockEqual(a, b)) return "after"; // equal == same causal point
  return "concurrent";
}

/**
 * Merge two field sets using field-level LWW (last-write-wins).
 *
 * - For each field present in either side, keep the value with the higher
 *   fieldTimestamp (breaking ties by preferring `local` for determinism).
 * - If fieldTimestamps are equal AND field exists in both, keep `local` value.
 */
export function mergeFields<T extends Record<string, any>>(
  localData: T,
  localTs: FieldTimestamps,
  incomingData: Partial<T>,
  incomingTs: FieldTimestamps,
): { data: T; ts: FieldTimestamps; winners: { field: string; source: "local" | "incoming" }[] } {
  const out: any = { ...localData };
  const outTs: FieldTimestamps = { ...localTs };
  const winners: { field: string; source: "local" | "incoming" }[] = [];

  for (const field of Object.keys(incomingData)) {
    const lTs = localTs[field] || 0;
    const iTs = incomingTs[field] || 0;
    if (iTs > lTs) {
      // Incoming is strictly newer — apply.
      out[field] = incomingData[field];
      outTs[field] = iTs;
      winners.push({ field, source: "incoming" });
    } else if (iTs === lTs && !(field in localData)) {
      // Same ts but field didn't exist locally — initialize from incoming.
      out[field] = incomingData[field];
      outTs[field] = iTs;
      winners.push({ field, source: "incoming" });
    }
    // Else: local is newer or equal — keep local (do not overwrite).
  }
  return { data: out as T, ts: outTs, winners };
}

/**
 * Increment a vector clock for a write by `clientId`. Returns the new clock.
 */
export function bumpClock(clock: VectorClock, clientId: string): VectorClock {
  return { ...clock, [clientId]: (clock[clientId] || 0) + 1 };
}

/**
 * Merge two clocks into one (taking the max of each component).
 * Used to advance a client's view when receiving another's clock.
 */
export function joinClocks(a: VectorClock, b: VectorClock): VectorClock {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = Math.max(out[k] || 0, b[k] || 0);
  }
  return out;
}

/**
 * Convenience: returns true iff the incoming message should be applied to
 * local state, considering causal order and concurrent field merges.
 *
 * Args:
 *   localData: current canonical state
 *   localFieldTs: per-field timestamps for localData
 *   localClock: the clock local state was based on (used to compare against
 *               incoming.clock for causal ordering)
 *   incoming: CRDT message
 */
export function shouldApply<T extends Record<string, any>>(
  localData: T,
  localFieldTs: FieldTimestamps,
  localClock: VectorClock,
  incoming: CRDTMessage<Partial<T>>,
): { apply: boolean; mergedData: T; mergedTs: FieldTimestamps; conflictFields: string[]; relation: "after" | "before" | "concurrent" } {
  const relation = compareClocks(incoming.clock, localClock);

  if (relation === "before") {
    return { apply: false, mergedData: localData, mergedTs: localFieldTs, conflictFields: [], relation };
  }
  if (relation === "after") {
    // Apply incoming fully. Update timestamps for fields present.
    const newData = { ...localData, ...incoming.data };
    const newTs: FieldTimestamps = { ...localFieldTs, ...incoming.fieldTimestamps };
    return { apply: true, mergedData: newData as T, mergedTs: newTs, conflictFields: [], relation };
  }
  // Concurrent: field merge.
  const { data, ts, winners } = mergeFields(localData, localFieldTs, incoming.data, incoming.fieldTimestamps);
  const conflictFields = winners.filter((w) => w.source === "incoming").map((w) => w.field);
  return { apply: true, mergedData: data as T, mergedTs: ts, conflictFields, relation };
}
