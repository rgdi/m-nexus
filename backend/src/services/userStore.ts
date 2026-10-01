// services/userStore.ts — v2.38.1 per-user data isolation.
//
// ── What is wrong without it ──────────────────────────────────────
// `notes.json` and `flashcards.json` are one file each, shared by
// everyone who points at the instance. Two people register a device,
// authenticate, call `GET /api/v1/notes`, and get the same notes. The
// heatmap aggregates everyone's reviews. A review on device A changes
// what device B — a different person, a different household — sees on
// their progress screen.
//
// v2.37.0 closed the endpoints: they require a token. But a token does
// not change *which* notes come back, because there is only one set.
// Requiring auth on a global store is a lock on the same door.
//
// ── What this does ─────────────────────────────────────────────────
// Data moves to `data/users/<sub>/notes.json` etc. `sub` is the JWT
// subject — the device id, which is per-registration, not per-install.
//
// Three properties, and the third is the reason this is not just a
// path swap:
//
//   1. Isolation — user A's file is never opened for user B.
//   2. Migration — the existing global file is adopted by exactly one
//      user, the first one to read it, and then moved aside. Everyone
//      who already had notes does not wake up to an empty app.
//   3. No cross-request bleed — the service caches per subject rather
//      than in one `private cache`, which is the bug that would
//      otherwise appear the moment two requests overlap.
//
// The single-user case is the default: with AUTH_REQUIRED=false, and
// for the LAN bypass, everyone maps to one bucket and behaviour is
// exactly what it was before.

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { logOp } from "../utils/log.js";

const DATA = () => join(process.cwd(), "data");
const LEGACY_FILE = (name: string) => join(DATA(), name);
// v2.38.12 — una cuenta puede tener varios dispositivos.
//
// Antes, la identidad ERA el dispositivo: cada registro era un subject
// y por tanto un directorio, y por tanto "la tablet y el portatil a la
// vez sobre la misma nota" era imposible. No era un bug de sync, era el
// modelo de identidad.
//
// Ahora un subject puede pertenecer a una cuenta, y si pertenece, su
// directorio ES el de la cuenta. Un solo punto de cambio —esta
// funcion— y todo lo que ya funciona sigue funcionando: los que no
// tienen cuenta siguen en su directorio de siempre, con los mismos
// datos y sin migracion.
//
//   sin cuenta    data/users/<subject>/     ← como siempre
//   con cuenta    data/accounts/<cuenta>/   ← los dispositivos juntos
const ACCOUNT_DIR = (accountId: string) => join(DATA(), "accounts", sanitise(accountId));

/**
 * De subject a directorio. Es el unico sitio donde se decide, y por
 * eso el cambio de identidad es una sola linea y no una migracion.
 *
 * La lista de cuentas se lee del disco y se cachea unos segundos: se
 * consulta en cada lectura y no puede ser un a disco por nota.
 */
const accountCache = new Map<string, { root: string; at: number }>();
const ACCOUNT_TTL_MS = 3000;

/** La cuenta de un subject, o "" si no tiene ninguna. */
export async function accountOf(sub: string): Promise<string> {
  if (!sub) return "";
  const hit = accountCache.get(sub);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.root;
  try {
    const dir = ACCOUNT_DIR("_links");
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".link")) continue;
      const device = f.slice(0, -5);
      const account = (await fs.readFile(join(dir, f), "utf-8")).trim();
      accountCache.set(device, { root: account, at: Date.now() });
      if (device === sub) return account;
    }
    if (files.some((f) => f.endsWith(".link"))) anyLinksKnown = true;
  } catch {
    // Sin directorio de enlaces: nadie tiene cuenta. Es el caso normal.
  }
  return hit?.root ?? "";
}

/** Si alguna vez se ha visto un enlace, hay cuentas en el sistema.
 *
 *  Mientras sea false —que es el caso de cualquiera que no haya creado
 *  una cuenta— el hook de rutas se mantiene EXACTAMENTE como estaba:
 *  síncrono, sin promesas. Hacerlo asíncrono siempre fue lo que vació
 *  la respuesta del dashboard, y no hay razón para que le cambie a
 *  quien no usa cuentas.
 */
let anyLinksKnown = false;

export function hasAnyAccounts(): boolean {
  return anyLinksKnown;
}

export function invalidateAccounts(): void {
  accountCache.clear();
}

function USER_DIR_SYNC(sub: string): string {
  const hit = accountCache.get(sub);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) {
    return hit.root ? ACCOUNT_DIR(hit.root) : join(DATA(), "users", sanitise(sub));
  }
  return join(DATA(), "users", sanitise(sub));
}

const USER_DIR = USER_DIR_SYNC;
const USER_FILE = (sub: string, name: string) => join(USER_DIR(sub), name);

/**
 * El directorio de un usuario: el de su cuenta si tiene, el suyo si no.
 *
 * v2.38.21 — lo exportan los ficheros que guardan cosas que no son
 * colecciones —un modelo 3D, por ejemplo, que es un binario y no un
 * JSON—. Es el MISMO directorio que usan las notas, para que un
 * dispositivo con cuenta y otro sin ella no acaben con los datos
 * partidos.
 */
export function userDirFor(sub: string): string {
  return USER_DIR(sub);
}

export const DEFAULT_SUBJECT = "default";

/**
 * Make a subject safe to use as a directory name.
 *
 * The subject is a JWT claim, so it is trusted, but it also ends up on
 * disk and a traversal there is a file-write outside the data
 * directory. Belt and braces: nothing but [A-Za-z0-9._-] survives, and
 * a leading dot is stripped.
 */
export function sanitise(sub: string): string {
  const s = String(sub ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  // Collapse every ".." run, not just a leading one: a segment that is
  // exactly ".." would resolve to data/users/.. and walk out of the
  // directory, and "data/users/x.." names are needlessly confusing.
  return s.replace(/\.{2,}/g, "_").replace(/^\.+/, "") || DEFAULT_SUBJECT;
}

/**
 * The subject of the request currently being handled.
 *
 * An AsyncLocalStorage rather than a module-level variable, and not
 * because of style: with a module-level "current user", two overlapping
 * requests — user A reading notes while user B writes them — would race
 * on the same slot, and the wrong user could be served the other one's
 * data. That is the exact bug this whole module exists to prevent, so
 * the mechanism that reads the subject has to be race-free too.
 */
const als = new AsyncLocalStorage<string>();

/** Called once per request by the auth middleware. */
export function runWithSubject<T>(sub: string, fn: () => T): T {
  return als.run(sub, fn);
}

/**
 * Enter the subject scope for the remainder of the current async chain.
 *
 * `run(sub, fn)` is not usable from a Fastify hook: the hook returns
 * before the route handler runs, so the scope would already be gone.
 * `enterWith` is the one that persists across the awaits that follow,
 * which is what a request chain is made of.
 *
 * The caveat, stated plainly: `enterWith` mutates the current execution
 * context rather than creating a child one, so it would be wrong if two
 * requests were ever genuinely interleaved inside one synchronous
 * execution. In an event-loop server that does not happen — each request
 * gets its own async chain — but it is the reason this is isolated to
 * one hook and documented, rather than sprinkled through the services.
 */
export async function enterSubjectAsync(sub: string): Promise<void> {
  // Antes de fijar el ambito se resuelve la cuenta, porque el
  // directorio depende de ella y no hay forma de saberlo de forma
  // sincronica sin leer disco en cada acceso.
  if (sub && !accountCache.has(sub)) await accountOf(sub);
}

export function enterSubject(sub: string): void {
  als.enterWith(sub);
}

/** Which bucket does this request belong to? */
export function currentSubject(): string {
  return als.getStore() ?? DEFAULT_SUBJECT;
}

export function subjectFor(auth: { sub?: string } | null | undefined): string {
  if (process.env.AUTH_REQUIRED === "false") return DEFAULT_SUBJECT;
  const sub = auth?.sub;
  return sub ? sanitise(sub) : DEFAULT_SUBJECT;
}

/* ------------------------------------------------------------------ *
 * Cache, per subject
 * ------------------------------------------------------------------ */

const REV_FILE = (id: string) => join(ACCOUNT_DIR(id), "revision.json");

/**
 * Un contador que sube con cada escritura. Es lo minimo para que un
 * dispositivo sepa si lo que tiene en memoria es lo ultimo: no hace
 * falta comparar contenido entero, basta con "¿mi numero es el de
 * ahora?".
 *
 * Sin esto, dos dispositivos pueden mostrar dos verdades durante
 * minutos, y el usuario no tiene por donde saber cual es la buena.
 */
export async function bumpRevision(sub: string): Promise<number> {
  const account = await accountOf(sub);
  const file = account ? REV_FILE(account) : join(USER_DIR_SYNC(sub), "revision.json");
  let n = 0;
  try {
    n = JSON.parse(await fs.readFile(file, "utf-8")).rev ?? 0;
  } catch {}
  n += 1;
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ rev: n, at: Date.now() }), "utf-8");
  return n;
}

export async function revisionOf(sub: string): Promise<number> {
  const account = await accountOf(sub);
  const file = account ? REV_FILE(account) : join(USER_DIR_SYNC(sub), "revision.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")).rev ?? 0;
  } catch {
    return 0;
  }
}
const caches = new Map<string, Map<string, unknown>>();

/**
 * v2.38.12 — la clave es el DIRECTORIO, no el dispositivo.
 *
 * Antes era el subject, que era lo mismo que el directorio mientras
 * cada dispositivo tenía sus datos. Con una cuenta compartida ya no:
 * el móvil leía su copia cacheada y no veía lo que acababa de escribir
 * el portátil, en el mismo proceso y con el disco al día. El síntoma
 * era "la tinta se guarda pero el otro dispositivo no la ve".
 *
 * Con la clave por directorio, los dispositivos de una cuenta comparten
 * cache —que es lo correcto, comparten datos— y los de cuentas
 * distintas siguen aislados.
 */
function cacheKeyFor(sub: string): string {
  const dir = USER_DIR_SYNC(sub);
  return "dir:" + dir;
}

function cacheFor(sub: string): Map<string, unknown> {
  const key = cacheKeyFor(sub);
  let c = caches.get(key);
  if (!c) { c = new Map(); caches.set(key, c); }
  return c;
}

/** Drop one collection from the cache (used after an external write). */
export function invalidate(sub: string, name: string): void {
  cacheFor(sub).delete(name);
}

const MIGRATED = new Set<string>();

export function invalidateAll(): void {
  caches.clear();
  // The migration claim is derived state too. Leaving it behind means a
  // later call in the same process silently refuses to adopt, which is
  // the right behaviour in production and the wrong one in a test.
  MIGRATED.clear();
}

/* ------------------------------------------------------------------ *
 * Read / write
 * ------------------------------------------------------------------ */


/**
 * Read a collection for one subject.
 *
 * On first read, if the legacy global file exists and has content, it
 * is copied into this user's directory and the original is renamed to
 * `.migrated`. Exactly one user adopts it; the rest start empty, which
 * is correct — they never had those notes.
 */
export async function readCollection<T>(sub: string, name: string, fallback: T): Promise<T> {
  const c = cacheFor(sub);
  if (c.has(name)) return c.get(name) as T;

  const userPath = USER_FILE(sub, name);
  try {
    const buf = await fs.readFile(userPath, "utf-8");
    const parsed = JSON.parse(buf) as T;
    c.set(name, parsed);
    return parsed;
  } catch {
    // No per-user file yet.
  }

  const legacy = await adoptLegacy<T>(sub, name);
  if (legacy !== undefined) {
    c.set(name, legacy);
    return legacy;
  }

  c.set(name, fallback);
  return fallback;
}

let adoptionForced: boolean | null = null;

/**
 * Allow adoption regardless of environment. Only for tests that are
 * specifically about the migration.
 */
export function allowAdoption(on: boolean): void {
  adoptionForced = on;
}

function adoptionEnabled(): boolean {
  if (adoptionForced !== null) return adoptionForced;
  // A test run is not a deployment. Several services (recordings, for
  // one) resolve their data path at module load, so a test that chdirs
  // into a scratch directory still has some code writing to the real
  // data/ — and whichever device reads notes first would adopt — and
  // rename — the repository's actual notes.json. Adoption has to be an
  // event a deployment triggers, not something any first reader causes.
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return process.env.MNEXUS_STORE_ADOPT !== "0";
}

async function adoptLegacy<T>(sub: string, name: string): Promise<T | undefined> {
  if (sub === DEFAULT_SUBJECT || MIGRATED.has(sub)) return undefined;
  if (!adoptionEnabled()) return undefined;
  const legacyPath = LEGACY_FILE(name);
  try {
    const buf = await fs.readFile(legacyPath, "utf-8");
    const parsed: any = JSON.parse(buf);
    const empty =
      parsed === null ||
      (Array.isArray(parsed) && parsed.length === 0) ||
      (Array.isArray(parsed?.notes) && parsed.notes.length === 0) ||
      (Array.isArray(parsed?.cards) && parsed.cards.length === 0) ||
      (Array.isArray(parsed?.folders) && parsed.folders.length === 0);
    if (empty) return undefined;

    // Claim it. The marker stops a second user adopting the same file.
    MIGRATED.add(sub);
    await fs.mkdir(USER_DIR(sub), { recursive: true });
    await fs.writeFile(USERPathFor(sub, name), buf, "utf-8");
    try {
      await fs.rename(legacyPath, `${legacyPath}.migrated`);
    } catch { /* the copy is enough; the rename is tidiness */ }
    logOp("store", "legacy adopted", true, { sub, name });
    return parsed as unknown as T;
  } catch {
    return undefined;
  }
}

const USERPathFor = (sub: string, name: string) => USER_FILE(sub, name);

export async function writeCollection<T>(sub: string, name: string, value: T): Promise<void> {
  cacheFor(sub).set(name, value);
  const dir = USER_DIR(sub);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(USER_FILE(sub, name), JSON.stringify(value, null, 2), "utf-8");
  // v2.38.13 — toda escritura del store pasa por aqui, asi que es el
  // unico sitio al que hay que colgarlo para que ningun camino se
  // escape. Ademas avisa por el canal en tiempo real, que es lo que
  // hace que el otro dispositivo recargue en vez de quedarse con una
  // foto vieja.
  const rev = await bumpRevision(sub);
  // v2.38.14 — la clave del canal es la cuenta si la hay, y
  // "sub:<subject>" si no. Antes solo se publicaba con cuenta, asi que
  // un usuario SIN cuenta —que es el caso por defecto— se suscribia a
  // un canal donde nunca se publicaba nada. Parecia funcionar porque
  // el saludo si llegaba.
  const key = (await accountOf(sub)) || `sub:${sub}`;
  const { publish } = await import("./realtime.js");
  publish({ account: key, revision: rev, collection: name, by: sub });
}

/* ------------------------------------------------------------------ *
 * Inspection
 * ------------------------------------------------------------------ */

/** Which users have data on disk. Used by the settings screen. */
export async function listUsers(): Promise<string[]> {
  try {
    const dir = join(DATA(), "users");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** True when the legacy global files are still lying around. */
export async function hasLegacyData(): Promise<boolean> {
  for (const n of ["notes.json", "flashcards.json", "folders.json", "tasks.json"]) {
    try {
      const buf = await fs.readFile(LEGACY_FILE(n), "utf-8");
      const j = JSON.parse(buf);
      if (Array.isArray(j) && j.length) return true;
    } catch { /* absent or unreadable */ }
  }
  return false;
}
