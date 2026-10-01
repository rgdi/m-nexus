// glbModels.ts — los modelos 3D que tú subes.
//
// v2.16.0, y v2.38.21 reescrito entero.
//
//   POST   /api/v1/models/upload  →  { id, nombre, bytes }
//   GET    /api/v1/models         →  los tuyos y los que vienen de serie
//   GET    /api/v1/models/:id     →  descargarlo
//   DELETE /api/v1/models/:id     →  borrarlo
//
// ── Lo que estaba, y por qué se reescribe ────────────────────────
//
// v2.16.0 guardaba TODO lo que sube cualquiera en UN directorio
// compartido, `public/models/user/`, y lo servía por una RUTA
// PÚBLICA: `/models/user/<archivo>.glb`.
//
// Eso quiere decir tres cosas, y las tres malas:
//
//   1. **Los modelos de un usuario son los de todos.** Cualquiera que
//      sepa el nombre puede bajarlos sin autenticarse, porque la ruta
//      la sirve el servidor de ficheros estáticos, no esta API.
//   2. **`GET /api/v1/models` no miraba quién pregunta.** Ni token, ni
//      nada: listaba el directorio entero.
//   3. **`DELETE` recibía un nombre de archivo.** Uno podía borrar el
//      modelo de otro con pedir la baja por su nombre.
//
// En una aplicación donde las notas ya están aisladas por usuario, esto
// es un agujero del mismo tipo que el que ya se cerró para el resto.
//
// Ahora cada modelo vive en el directorio de QUIEN LO SUBIÓ —el mismo
// que sus notas, con cuenta o sin ella— y la descarga comprueba la
// propiedad contra el índice antes de devolver un byte. Los modelos que
// vienen de serie (`public/models/`) siguen siendo públicos, porque son
// nuestros.
//
// Lo de "público" para los del usuario se va: el visor los pide por
// API con el token, que es lo único que un EventSource, un <img> y un
// fetch pueden hacer igual.

import { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { currentSubject, userDirFor } from "../services/userStore.js";
import { logger } from "../utils/log.js";

const BUILTIN_MODELS = new Set(["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]);

// v2.38.21 — los límites se comprueban ANTES de tragar el cuerpo, y se
// dicen en la respuesta. Un cuerpo de 60 MB cargado en memoria para
// devolver un 413 despues es peor que un 413 inmediato.
const MAX_POR_MODELO = 60 * 1024 * 1024;
const MAX_POR_USUARIO = 240 * 1024 * 1024;

interface ModelRecord {
  id: string;
  name: string;
  displayName: string;
  bytes: number;
  at: number;
}

const dirDe = (sub: string) => join(userDirFor(sub), "models");
const indiceDe = (sub: string) => join(dirDe(sub), "index.json");
const archivoDe = (sub: string, id: string) => join(dirDe(sub), `${id}.glb`);

async function leerIndice(sub: string): Promise<ModelRecord[]> {
  try {
    const arr = JSON.parse(await readFile(indiceDe(sub), "utf-8"));
    return Array.isArray(arr) ? (arr as ModelRecord[]) : [];
  } catch {
    return [];
  }
}

async function escribirIndice(sub: string, list: ModelRecord[]): Promise<void> {
  await mkdir(dirDe(sub), { recursive: true });
  await writeFile(indiceDe(sub), JSON.stringify(list, null, 2));
}

const usadoPor = async (sub: string) =>
  (await leerIndice(sub)).reduce((n, m) => n + (m.bytes || 0), 0);

const ID_VALIDO = /^mdl-[A-Za-z0-9-]{4,48}$/;

export async function glbModelsRoutes(app: FastifyInstance): Promise<void> {
  /* ── subir ───────────────────────────────────────────────────── */
  app.post("/api/v1/models/upload", async (req, reply) => {
    const sub = currentSubject();
    if (!sub) return reply.code(401).send({ error: "unauthorized" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });
    if (!/\.glb$/i.test(file.filename)) {
      return reply.code(415).send({ error: "Only .glb files accepted" });
    }
    // El tamaño se mira del archivo, antes de leerlo: `toBuffer()`
    // afterwards ya tiene los 60 MB en memoria.
    // El stream marca `truncated` cuando pasa del límite del servidor, así
    // que se puede cortar antes de tenerlo entero en memoria.
    if ((file as unknown as { file?: { truncated?: boolean } }).file?.truncated) {
      return reply.code(413).send({ error: "El modelo es demasiado grande" });
    }

    const buf = await file.toBuffer();
    // Magic bytes: un GLB empieza con 'glTF'. Sin esto se subiría
    // cualquier cosa con extension .glb.
    if (buf.byteLength < 12 || buf.slice(0, 4).toString("ascii") !== "glTF") {
      return reply.code(400).send({ error: "Invalid GLB header (expected 'glTF' magic)" });
    }
    if (buf.byteLength > MAX_POR_MODELO) {
      return reply.code(413).send({
        error: `un modelo no puede pasar de ${Math.round(MAX_POR_MODELO / 1024 / 1024)} MB`,
        max: MAX_POR_MODELO,
      });
    }
    const antes = await usadoPor(sub);
    if (antes + buf.byteLength > MAX_POR_USUARIO) {
      return reply.code(413).send({
        error:
          `no queda sitio: ya llevas ${Math.round(antes / 1024 / 1024)} MB ` +
          `de ${Math.round(MAX_POR_USUARIO / 1024 / 1024)} MB`,
        used: antes,
        max: MAX_POR_USUARIO,
      });
    }

    const id = `mdl-${randomUUID().slice(0, 8)}${Date.now().toString(36)}`;
    const displayName = file.filename
      .replace(/\.glb$/i, "")
      .replace(/[^A-Za-z0-9 _-]/g, "")
      .slice(0, 60) || "modelo";
    const name = `${displayName}.glb`;

    await mkdir(dirDe(sub), { recursive: true });
    await writeFile(archivoDe(sub, id), buf);
    const rec: ModelRecord = { id, name, displayName, bytes: buf.byteLength, at: Date.now() };
    const list = await leerIndice(sub);
    list.push(rec);
    await escribirIndice(sub, list);
    logger.info({ sub, id, bytes: buf.byteLength }, "modelo 3D subido");

    return reply.code(201).send({ ...rec, builtin: false });
  });

  /* ── listar ──────────────────────────────────────────────────── */
  app.get("/api/v1/models", async (req, reply) => {
    const sub = currentSubject();
    if (!sub) return reply.code(401).send({ error: "unauthorized" });

    const mios: ModelRecord[] = await leerIndice(sub);

    // Los de serie, que son nuestros y van públicos.
    const deSerie = new Set(BUILTIN_MODELS);
    for (const f of deSerie) {
      const fp = join(process.cwd(), "public", "models", f);
      if (!existsSync(fp)) continue;
      const s = await stat(fp);
      mios.unshift({
        id: `builtin-${f.replace(/\.glb$/, "")}`,
        name: f,
        displayName: f.replace(/\.glb$/, "").replace(/_/g, " "),
        bytes: s.size,
        at: s.mtimeMs,
      });
    }

    return reply.send({
      models: mios.sort((a, b) => (a.id.startsWith("builtin-") ? -1 : 1) - (b.id.startsWith("builtin-") ? -1 : 1) || b.at - a.at),
      used: await usadoPor(sub),
      max: MAX_POR_USUARIO,
      maxPerModel: MAX_POR_MODELO,
    });
  });

  /* ── descargar ───────────────────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/api/v1/models/:id", async (req, reply) => {
    const sub = currentSubject();
    if (!sub) return reply.code(401).send({ error: "unauthorized" });
    const id = String(req.params.id || "");

    // Los de serie, por su ruta pública de siempre.
    if (id.startsWith("builtin-")) {
      const f = `${id.slice("builtin-".length)}.glb`;
      if (!BUILTIN_MODELS.has(f)) return reply.code(404).send({ error: "no existe" });
      const fp = join(process.cwd(), "public", "models", f);
      if (!existsSync(fp)) return reply.code(404).send({ error: "no existe" });
      const s = await stat(fp);
      reply.header("content-type", "model/gltf-binary");
      reply.header("content-length", String(s.size));
      reply.header("cache-control", "public, max-age=86400");
      return reply.send(createReadStream(fp));
    }

    if (!ID_VALIDO.test(id)) return reply.code(400).send({ error: "id no valido" });
    // La propiedad se comprueba en el ÍNDICE, no en el nombre del
    // fichero: un id que no esté en tu índice no es tuyo, aunque el
    // archivo exista en el disco.
    const rec = (await leerIndice(sub)).find((m) => m.id === id);
    if (!rec) return reply.code(404).send({ error: "no tienes ese modelo" });

    const ruta = archivoDe(sub, id);
    let info;
    try {
      info = await stat(ruta);
    } catch {
      // Índice y disco desincronizados: se limpia la entrada, que si no
      // el usuario ve un modelo roto para siempre.
      await escribirIndice(sub, (await leerIndice(sub)).filter((m) => m.id !== id));
      return reply.code(410).send({ error: "el archivo no esta; se ha quitado de tu lista" });
    }

    reply.header("content-type", "model/gltf-binary");
    reply.header("content-length", String(info.size));
    // El id no cambia nunca, asi que el navegador puede guardarlo para
    // siempre sin volver a preguntar. `private`: es tuyo.
    reply.header("cache-control", "private, max-age=31536000, immutable");
    reply.header("content-disposition", `inline; filename="${rec.name.replace(/["\\\r\n]/g, "_")}"`);
    // v2.38.21 — `reply.send(stream)`, no `pipe(reply.raw)`. Con el
    // pipe, Fastify cerraba la respuesta al volver de la ruta y el
    // cuerpo se iba entero: las cabeceras llegaban bien —el cliente
    // veía el 200 y la cache— y el archivo, cero bytes. Un 200 con
    // el cuerpo vacío, que es lo peor que puede pasar: parece que
    // funciona.
    return reply.send(createReadStream(ruta));
  });

  /* ── borrar ─────────────────────────────────────────────────── */
  app.delete<{ Params: { id: string } }>("/api/v1/models/:id", async (req, reply) => {
    const sub = currentSubject();
    if (!sub) return reply.code(401).send({ error: "unauthorized" });
    const id = String(req.params.id || "");
    if (!ID_VALIDO.test(id)) return reply.code(400).send({ error: "id no valido" });

    const list = await leerIndice(sub);
    if (!list.some((m) => m.id === id)) {
      return reply.code(404).send({ error: "no tienes ese modelo" });
    }
    await rm(archivoDe(sub, id), { force: true });
    await escribirIndice(sub, list.filter((m) => m.id !== id));
    return reply.send({ ok: true, id });
  });
}
