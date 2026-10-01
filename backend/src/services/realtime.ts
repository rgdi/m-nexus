// realtime.ts — a quién se le avisa y qué se le ha perdido.
//
// v2.38.13
//
// Un pub/sub en memoria, por cuenta. Es lo justo: el servidor no
// necesita más, y un Redis aquí sería una dependencia entera para
// resolver un problema que en un despliegue de un proceso no existe.
//
// El historial se guarda para poder enviar lo perdido durante una
// desconexión, que es el caso real: el móvil entra en un metro, pierde
// la cobertura, y al salir no debe recibir "ha cambiado" de las 400
// escrituras que se ha perdido —eso lo saturaría— sino las que le
// importan. Se acota por cuenta y por tiempo, porque un historial sin
// límite es una fuga de memoria esperando a que alguien mire.

export interface ChangeEvent {
  account: string;
  revision: number;
  /** La colección tocada, si se sabe. Si no, null: mejor "algo cambió"
   *  que una adivinanza equivocada que haga recargar de menos. */
  collection: string | null;
  by?: string;
  at: number;
}

type Listener = (ev: ChangeEvent) => void;

const listeners = new Map<string, Map<string, Listener>>();
const history = new Map<string, ChangeEvent[]>();
let counter = 0;

const HISTORY_MAX = 200;
const HISTORY_TTL_MS = 10 * 60_000;

export function addListener(account: string, fn: Listener): string {
  const id = `l${++counter}`;
  let m = listeners.get(account);
  if (!m) { m = new Map(); listeners.set(account, m); }
  m.set(id, fn);
  return id;
}

export function removeListener(account: string, id: string): void {
  const m = listeners.get(account);
  if (!m) return;
  m.delete(id);
  if (!m.size) listeners.delete(account);
}

export function historyFor(account: string): ChangeEvent[] {
  prune(account);
  return history.get(account) ?? [];
}

/** La revisión más antigua que todavía se guarda. Antes de esta, ya no
 *  hay nada: lo que se pasó mientras el cliente estaba fuera se ha
 *  perdido de verdad, y hay que decirlo en vez de fingir que no.
 *
 *  v2.38.19 — `Infinity` cuando no queda nada, para que un cliente que
 *  va atrasado y se encuentra el historial vacío se entere del hueco.
 */
export function oldestRevisionFor(account: string): number {
  const h = historyFor(account);
  return h.length ? h[0].revision : Number.POSITIVE_INFINITY;
}

/** Publica un cambio. Devuelve el evento, para que quien escribe lo
 *  pueda incluir en su propia respuesta. */
export function publish(ev: Omit<ChangeEvent, "at"> & { at?: number }): ChangeEvent {
  const full: ChangeEvent = { ...ev, at: ev.at ?? Date.now() };
  const m = listeners.get(full.account);
  if (m) for (const fn of m.values()) {
    try { fn(full); } catch { /* un cliente muerto no tumba a los demás */ }
  }
  const h = history.get(full.account) ?? [];
  h.push(full);
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
  history.set(full.account, h);
  return full;
}

function prune(account: string): void {
  const h = history.get(account);
  if (!h) return;
  const cut = Date.now() - HISTORY_TTL_MS;
  const i = h.findIndex((e) => e.at < cut);
  if (i > 0) h.splice(0, i);
}

export function activeListenerCount(): number {
  let n = 0;
  for (const m of listeners.values()) n += m.size;
  return n;
}

/** Solo para tests. */
export function resetRealtime(): void {
  listeners.clear();
  history.clear();
}
