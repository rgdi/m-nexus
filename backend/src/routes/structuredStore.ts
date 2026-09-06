// Structured routes: shared store & helpers.

import { ConflictResolver } from "../services/conflictResolver.js";
import type { DatabaseSchema, NoteRow, ViewSchema } from "../services/structuredNotes.js";

export const vaultDatabases = new Map<string, Map<string, DatabaseSchema>>();
export const vaultRows = new Map<string, Map<string, Map<string, NoteRow>>>();
export const vaultViews = new Map<string, Map<string, Map<string, ViewSchema>>>();
export const resolver = new ConflictResolver();

export function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let v = map.get(key);
  if (!v) { v = factory(); map.set(key, v); }
  return v;
}
