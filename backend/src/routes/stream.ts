// routes/stream.ts — que un dispositivo sepa que el otro ha escrito.
//
// v2.38.13
//
// El problema que resuelve, dicho tal cual: sin esto, el móvil y el
// portátil pueden mostrar dos verdades durante minutos y el usuario no
// tiene por dónde saber cuál es la buena. El servidor va bien —los dos
// leen del mismo sitio— pero el cliente no se entera de que ha
// cambiado, y lo que muestra es una foto vieja.
//
// Server-Sent Events y no WebSocket porque es un canal de una sola
// dirección, que es lo único que hace falta: el dispositivo avisa de
// lo suyo con push, y este canal solo le dice "hay algo nuevo". Abrir un
// WebSocket para eso sería una dependencia, un handshake y un cierre
// limpio que hay que mantener, a cambio de nada.
//
// El mensaje lleva la REVISIÓN, que es un contador. El cliente compara
// con la suya y, si no coincide, recarga lo que tenga que recargar. No
// le decimos qué ha cambiado porque no siempre se sabe —cualquier
// escritura puede haber tocado cualquier cosa— y adivinarlo peor que
// recargar de más.
//
// Reconexión: el navegador la hace sola. Cada mensaje lleva el id de
// evento, así que al reconectar puede pedir "desde el 42" y el servidor
// le manda lo que se perdió en vez de todo.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentSubject, accountOf, revisionOf } from "../services/userStore.js";
import { addListener, removeListener, historyFor, publish, activeListenerCount, type ChangeEvent } from "../services/realtime.js";

const HEARTBEAT_MS = 25_000;
const MAX_CLIENTS = 500;

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { since?: string } }>("/api/v1/stream", async (req, reply) => {
    const sub = currentSubject();
    const account = (await accountOf(sub)) || `sub:${sub}`;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx: sin esto se bufferea y no llega
    });

    const send = (event: string, data: unknown, id?: number) => {
      try {
        if (id !== undefined) reply.raw.write(`id: ${id}\n`);
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* la conexión se fue */
      }
    };

    const startRev = await revisionOf(sub);
    send("hello", { account, revision: startRev, at: Date.now() });
    if (activeListenerCount() >= MAX_CLIENTS) {
      send("bye", { reason: "demasiados clientes" });
      reply.raw.end();
      return;
    }

    const since = Number(req.query.since);
    const listenerId = addListener(account, (ev: ChangeEvent) => send("change", ev, ev.revision));

    // Lo perdido mientras no estábamos: desde `since` hasta ahora.
    if (Number.isFinite(since) && since >= 0) {
      for (const ev of backlog(account, since)) send("change", ev, ev.revision);
    }

    // Latido: sin esto, proxies y móviles cierran la conexión por
    // inactividad y el usuario ve "se ha desconectado" cada minuto.
    const beat = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        clearInterval(beat);
      }
    }, HEARTBEAT_MS);

    const bye = () => {
      clearInterval(beat);
      removeListener(account, listenerId);
    };
    req.raw.on("close", bye);
    req.raw.on("error", bye);
  });
}

function backlog(account: string, since: number): ChangeEvent[] {
  return historyFor(account).filter((e) => e.revision > since);
}

export { publish };
