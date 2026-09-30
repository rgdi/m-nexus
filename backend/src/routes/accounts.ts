// routes/accounts.ts — la cuenta y sus dispositivos.
//
// v2.38.12
//
//   POST /api/v1/accounts            crea una cuenta
//   POST /api/v1/accounts/link       añade este dispositivo a una cuenta
//   GET  /api/v1/accounts/me         quién soy y qué dispositivos tengo
//   POST /api/v1/accounts/unlink     saca este dispositivo
//   GET  /api/v1/accounts/invite      el código para meter otro dispositivo
//
// El modelo anterior —la identidad ES el dispositivo— era simple y
// por eso se eligió. El problema es que hace imposibles tres cosas que
// el producto necesita: la tablet y el portátil a la vez sobre la misma
// nota, no perder lo escrito al reinstalar, y no duplicar el temario
// entre el móvil y el portátil.
//
// No se sustituye: se añade. Un dispositivo sin cuenta sigue
// funcionando exactamente igual y con sus mismos datos. Vincularse es
// un movimiento opcional y reversible.
//
// Sobre la seguridad: un código de invitación es una contraseña. Va por
// HTTP, contra un servidor del que nadie audita el despliegue, y sin
// límite de intentos. Por eso son 8 caracteres de un alfabeto sin
// ambiguos —nada de 0/O, 1/l/I— y duran 15 minutos. Es suficiente para
// pasar un dispositivo al otro lado de una habitación, y no es
// suficiente para nada más. Quien necesite más, necesita HTTPS y un
// limite de intentos, y las dos cosas son decisiones suyas, no mías.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { currentSubject, accountOf, invalidateAccounts, sanitise } from "../services/userStore.js";
import { logOp } from "../utils/log.js";

const DATA = () => join(process.cwd(), "data");
const ACCOUNTS = () => join(DATA(), "accounts");
const LINKS = () => join(ACCOUNTS(), "_links");
const ACCOUNT_FILE = (id: string) => join(ACCOUNTS(), sanitise(id), "account.json");
const INVITES = () => join(ACCOUNTS(), "_invites.json");

/** 32 sin 0/O ni 1/l/I: se dicta por teléfono sin ambigüedad. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 15 * 60_000;

function makeCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

const hashCode = (c: string) => createHash("sha256").update(c.trim().toUpperCase()).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // Comparacion en tiempo constante y sinFallar por longitudes
  // distintas: si no, el tiempo de respuesta ya dice cuántos
  // caracteres lleva correctos.
  if (ba.length !== bb.length) {
    // Se compara igualmente contra algo del mismo tamaño.
    timingSafeEqual(ba, Buffer.alloc(ba.length));
    return false;
  }
  return timingSafeEqual(ba, bb);
}

interface AccountFile {
  id: string;
  createdAt: number;
  label: string;
  devices: { subject: string; linkedAt: number; label: string; platform: string }[];
}

async function readAccount(id: string): Promise<AccountFile | null> {
  try {
    return JSON.parse(await fs.readFile(ACCOUNT_FILE(id), "utf-8")) as AccountFile;
  } catch {
    return null;
  }
}

async function writeAccount(a: AccountFile): Promise<void> {
  await fs.mkdir(join(ACCOUNTS(), sanitise(a.id)), { recursive: true });
  await fs.writeFile(ACCOUNT_FILE(a.id), JSON.stringify(a, null, 2), "utf-8");
}

async function writeLink(subject: string, accountId: string): Promise<void> {
  await fs.mkdir(LINKS(), { recursive: true });
  await fs.writeFile(join(LINKS(), `${sanitise(subject)}.link`), accountId.trim(), "utf-8");
}

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const sub = (_req: FastifyRequest) => currentSubject();

  app.post("/api/v1/accounts", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ label: z.string().max(60).optional() }).safeParse(req.body ?? {});
    const label = body.success ? (body.data.label ?? "Mi cuenta") : "Mi cuenta";

    const id = "acc-" + randomInt(0x100000000).toString(36) + Date.now().toString(36);
    const account: AccountFile = {
      id,
      createdAt: Date.now(),
      label,
      devices: [{ subject: s, linkedAt: Date.now(), label, platform: "web" }],
    };
    await writeAccount(account);
    await writeLink(s, id);
    invalidateAccounts();

    // v2.38.12 — esto faltaba y rompia media cosa: los datos de quien
    // CREA la cuenta se quedan en data/users/<subject>/ mientras que
    // los del que se une van a data/accounts/<id>/. Dos directorios
    // para la misma cuenta, y el movil no veia lo que escribia el
    // portatil ni al reves. Se migra tambien al crear.
    const moved = await migrateSubject(s, id);

    // Se refresca para que este mismo request ya caiga en la cuenta.
    await accountOf(s);
    logOp("accounts", "create", true, { account: id, devices: 1, moved: moved.moved, kept: moved.kept });
    return { id, label, devices: account.devices, migrated: moved };
  });

  app.get("/api/v1/accounts/me", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const accountId = await accountOf(s);
    if (!accountId) {
      return {
        account: null,
        subject: s,
        message: "Este dispositivo todavía no pertenece a ninguna cuenta. Se puede usar igual así.",
      };
    }
    const account = await readAccount(accountId);
    return { account: accountId, subject: s, label: account?.label, devices: account?.devices ?? [] };
  });

  /**
   * Un código para meter otro dispositivo. Se genera en un dispositivo
   * y se teclea en el otro.
   */
  app.post("/api/v1/accounts/invite", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const accountId = await accountOf(s);
    if (!accountId) {
      return reply.code(409).send({
        error: "no_account",
        warning: "Este dispositivo no pertenece a ninguna cuenta. Crea una primero.",
      });
    }
    const code = makeCode();
    let invites: Record<string, { account: string; at: number; used: boolean }> = {};
    try {
      invites = JSON.parse(await fs.readFile(INVITES(), "utf-8"));
    } catch {}
    invites[hashCode(code)] = { account: accountId, at: Date.now(), used: false };
    await fs.mkdir(ACCOUNTS(), { recursive: true });
    await fs.writeFile(INVITES(), JSON.stringify(invites), "utf-8");
    return { code, ttlMinutes: 15, account: accountId };
  });

  app.post("/api/v1/accounts/link", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ code: z.string().min(6).max(16) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    let invites: Record<string, { account: string; at: number; used: boolean }> = {};
    try {
      invites = JSON.parse(await fs.readFile(INVITES(), "utf-8"));
    } catch {}

    const key = hashCode(body.data.code);
    const inv = invites[key];
    if (!inv || inv.used || Date.now() - inv.at > INVITE_TTL_MS) {
      return reply.code(400).send({ error: "bad_code", warning: "El código no vale, ya se usó o caducó." });
    }

    const account = await readAccount(inv.account);
    if (!account) return reply.code(404).send({ error: "account_not_found" });

    // Vincular mueve los datos del dispositivo a la cuenta, para que
    // no se pierda lo que ya habia en el.
    inv.used = true;
    invites[key] = inv;
    await fs.writeFile(INVITES(), JSON.stringify(invites), "utf-8");

    await migrateSubject(s, inv.account);
    if (!account.devices.some((d) => d.subject === s)) {
      account.devices.push({ subject: s, linkedAt: Date.now(), label: "Otro dispositivo", platform: "web" });
    }
    await writeAccount(account);
    await writeLink(s, inv.account);
    invalidateAccounts();
    await accountOf(s);

    logOp("accounts", "link", true, { account: inv.account, subject: s });
    return { account: inv.account, devices: account.devices, moved: true };
  });

  app.post("/api/v1/accounts/unlink", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const accountId = await accountOf(s);
    if (!accountId) return reply.code(409).send({ error: "not_linked" });
    const account = await readAccount(accountId);
    if (!account) return reply.code(404).send({ error: "account_not_found" });
    if (account.devices.length <= 1) {
      return reply.code(409).send({
        error: "last_device",
        warning: "Es el último dispositivo de la cuenta. Si lo sacas, la cuenta se queda sin acceso.",
      });
    }
    try {
      await fs.unlink(join(LINKS(), `${sanitise(s)}.link`));
    } catch {}
    account.devices = account.devices.filter((d) => d.subject !== s);
    await writeAccount(account);
    invalidateAccounts();
    return { ok: true, devices: account.devices };
  });
}

/**
 * Mueve lo que hay en data/users/<subject>/ a data/accounts/<id>/.
 *
 * Los ficheros quesi dos dispositivos ponen el mismo nombre, gana el que ya estaba y el otro se
 * deja como <nombre>.importado-<subject>. Perder el trabajo del otro
 * dispositivo sería peor que tener dos versiones.
e ya estaba y el otro se
 * deja como <nombre>.importado-<subject>. Perder el trabajo del otro
 * dispositivo sería peor que tener dos versiones.
 */
async function migrateSubject(subject: string, accountId: string): Promise<{ moved: number; kept: number }> {
  const from = join(DATA(), "users", sanitise(subject));
  const to = join(ACCOUNTS(), sanitise(accountId));
  let moved = 0, kept = 0;
  let files: string[] = [];
  try {
    files = await fs.readdir(from);
  } catch {
    return { moved, kept };
  }
  await fs.mkdir(to, { recursive: true });
  for (const f of files) {
    const src = join(from, f);
    const dst = join(to, f);
    try {
      const st = await fs.stat(src);
      if (!st.isFile()) continue;
      if (await exists(dst)) {
        await fs.rename(src, join(to, `${f}.importado-${sanitise(subject)}`));
        kept++;
      } else {
        await fs.rename(src, dst);
        moved++;
      }
    } catch {}
  }
  try {
    await fs.rmdir(from);
  } catch {}
  return { moved, kept };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
