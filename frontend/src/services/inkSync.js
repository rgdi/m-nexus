// services/inkSync.js — la tinta y su sincronización, del lado del cliente.
//
// v2.38.14
//
// El servidor ya sabe fusionar. Aquí solo hay que hablar su idioma:
//
//   · al terminar un trazo, se empuja
//   · cada cierto tiempo se tira de lo que haya del otro lado
//   · lo que llega del otro se fusiona con lo local, y el servidor
//     decide; no decide este fichero
//
// El empuje no es por trazo. Con un lápiz rápido son veinte trazos por
// segundo y veinte peticiones por segundo es saturar el router del
// portátil. Se empuja al soltar el lápiz, y como mucho una vez cada dos
// segundos mientras se escribe, que es lo que tarda en notarse un
// retraso y lo que no ahoga la red del móvil.

import { detectApiBase } from "./api_base.js";
import { authHeaders } from "./auth.js";

const PUSH_MIN_MS = 2000;

export function createInkSync(docId, { onRemote, deviceId = "web", onError } = {}) {
  const base = detectApiBase();
  let since = 0;
  let pushed = 0;
  let lastPush = 0;
  let poll = null;
  let stopped = false;

  const push = async (strokes) => {
    if (stopped || !strokes?.length) return null;
    const now = Date.now();
    if (now - lastPush < PUSH_MIN_MS) return null;
    lastPush = now;
    try {
      const r = await fetch(`${base}/api/v1/ink/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ docId, strokes, seq: ++pushed, deviceId }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      since = Math.max(since, d.seq || 0);
      return d;
    } catch (e) {
      if (onError) onError(e);
      return null;
    }
  };

  const pull = async () => {
    if (stopped) return [];
    try {
      const r = await fetch(`${base}/api/v1/ink/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ docId, since }),
      });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.seq) since = Math.max(since, d.seq);
      if (d.incoming?.length && onRemote) onRemote(d.incoming, d);
      return d.incoming || [];
    } catch {
      return [];
    }
  };

  return {
    push,
    pull,
    get since() { return since; },
    /** Cada cuánto mira. 3s es un equilibrio: sin esto se nota el
     *  retraso de lo que escribe el otro; con menos, la batería del
     *  móvil se va en peticiones que no devuelven nada. */
    start(intervalMs = 3000) {
      if (poll) return;
      poll = setInterval(pull, intervalMs);
      // Al volver a la pestaña, enseguida: nadie quiere esperar tres
      // segundos a que aparezca lo que acaba de escribir el otro.
      document?.addEventListener?.("visibilitychange", () => {
        if (document.visibilityState === "visible") pull();
      });
    },
    stop() { stopped = true; if (poll) { clearInterval(poll); poll = null; } },
  };
}

/** El documento completo, para abrirlo en otro dispositivo. */
export async function loadInk(docId) {
  try {
    const r = await fetch(`${detectApiBase()}/api/v1/ink/${encodeURIComponent(docId)}`, {
      headers: authHeaders(),
    });
    if (!r.ok) return { pages: [] };
    return await r.json();
  } catch {
    return { pages: [] };
  }
}
