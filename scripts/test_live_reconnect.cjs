// test_live_reconnect.cjs — lo que pasa mientras no estás.
//
// v2.38.19. La pieza que faltaba del canal en tiempo real.
//
// El test anterior (`test_live_push.cjs`) comprobaba el camino feliz:
// la página está conectada, alguien escribe fuera, y llega. Eso ya
// estaba.
//
// Lo que NO estaba comprobado, y era un agujero:
//   1. Te vas (el móvil se duerme, la red se cae). Otro dispositivo
//      escribe. Vuelves. ¿Te enters de lo que pasó?
//   2. Te vas MUCHO rato. El historial del servidor se limpia —10
//      minutos, 200 eventos— y ya no queda. ¿Te enteras de que te has
//      quedado atrás, o te lo crees al día para siempre?
//
// La respuesta anterior a las dos era "no", y en el segundo caso era
// peor: no era que no te enterases, es que el servidor te DECÍA que
// estabas al día.
//
//   node scripts/test_live_reconnect.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

let ok = 0, fail = 0;
const chk = (name, good, why = '') => {
  if (good) { ok++; console.log(`  ok     ${name}${why ? ' — ' + why : ''}`); }
  else { fail++; console.log(`  FALLO  ${name}${why ? ' — ' + why : ''}`); }
};

const auth = function (cfg) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', cfg.tok);
  localStorage.setItem('mnexus.auth.refresh', cfg.tok);
  localStorage.setItem('mnexus.backend.url', cfg.url);
  localStorage.setItem('mnexus.theme', 'dark');
};

async function registrar() {
  const r = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'rc' + Date.now(), password: 'demo123',
      deviceId: 'rc-' + Math.random().toString(36).slice(2, 9),
      deviceName: 'rc', platform: 'web',
    }),
  });
  return r.json();
}

(async () => {
  const br = await chromium.launch({
    executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext();
  const reg = await registrar();
  const tok = reg.accessToken;
  const h = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
  const mknote = (t) => fetch(API + '/api/v1/notes', {
    method: 'POST', headers: h, body: JSON.stringify({ title: t, body: 'x' }),
  }).then((r) => r.json());

  const page = await ctx.newPage();
  await page.addInitScript(auth, { tok, url: API });
  await page.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  /* ── 1. Cortar el canal, escribir, volver ─────────────────────── */
  console.log('\n1. Reconectar y recibir lo que se perdió');
  const liveEn = (p) => p.evaluate(async () => (await import('/src/services/live.js')).liveState());
  const esperarConectado = async (pg, ms = 15000) => {
    const t0 = Date.now();
    let st = await liveEn(pg);
    while (Date.now() - t0 < ms && !st.connected) {
      await pg.waitForTimeout(200);
      st = await liveEn(pg);
    }
    return st;
  };
  const antes = await esperarConectado(page);
  chk('el canal está conectado al empezar', antes.connected, `revisión ${antes.revision}`);

  // Cortar el cable: desde fuera del navegador, para que sea el
  // EventSource real el que se cae.
  await page.evaluate(async () => (await import('/src/services/live.js')).stopLive());

  // Otro dispositivo escribe tres veces.
  for (const t of ['Perdida 1', 'Perdida 2', 'Perdida 3']) await mknote(t);
  const revServidor = await fetch(API + '/api/v1/accounts/revision', { headers: h })
    .then((r) => r.json());
  chk('el servidor sí subió la revisión',
    revServidor.revision > antes.revision,
    `${antes.revision} → ${revServidor.revision}`);

  // Volver a conectarse desde la MISMA revisión, que es lo que hace
  // el cliente al reconectar.
  // Volver a conectarse desde la MISMA revisión, que es lo que hace
  // el cliente al reconectar: el `since` lo lleva el propio modulo.
  await page.evaluate(async () => (await import('/src/services/live.js')).startLive());
  await page.waitForTimeout(3000);

  const despues = await page.evaluate(async () => (await import('/src/services/live.js')).liveState());
  chk('al volver, la revisión alcanza la del servidor',
    despues.revision === revServidor.revision,
    `tiene ${despues.revision}, el servidor está en ${revServidor.revision}`);
  chk('y no se marca hueco: lo perdido sí estaba en el historial',
    despues.gap === false);
  chk('hubo sincronización al reconectar',
    (despues.lastSyncedAt || 0) > 0);

  /* ── 2. El hueco grande ──────────────────────────────────────── */
  console.log('\n2. Ausentarse tanto que el historial ya no está');
  // v2.38.19 — el historial son 200 eventos. Para que el hueco sea
  // REAL hay que pasarse de ahi, y ademas el cliente tiene que estar
  // FUERA mientras pasa: si nunca se fue, va al dia y no hay hueco que
  // avisar. Un test que fuerza un hueco de mentira no prueba nada.
  const p2 = await ctx.newPage();
  await p2.addInitScript(auth, { tok, url: API });
  await p2.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  const stAntes = await esperarConectado(p2);
  chk('la segunda página está conectada y al día', stAntes.connected,
    `revisión ${stAntes.revision}`);

  // Se va. Ahora sí.
  await p2.evaluate(async () => (await import('/src/services/live.js')).stopLive());

  // 205 cambios: el historial del servidor se queda con los últimos
  // 200 y los primeros desaparecen para siempre.
  for (let i = 0; i < 205; i += 1) {
    await fetch(API + '/api/v1/notes', {
      method: 'POST', headers: h,
      body: JSON.stringify({ title: 'relleno ' + i, body: '' }),
    });
  }

  // Vuelve.
  const conHueco = await p2.evaluate(async () => {
    const m = await import('/src/services/live.js');
    const vistos = [];
    m.onChange((e) => vistos.push(e));
    m.startLive();
    await new Promise((r) => setTimeout(r, 3500));
    return { st: m.liveState(), gaps: vistos.filter((e) => e.gap).length, total: vistos.length };
  });
  chk('el cliente marca el hueco en su estado',
    conHueco.st.gap === true,
    `gap=${conHueco.st.gap}, tenía ${stAntes.revision} y ahora ${conHueco.st.revision}`);
  chk('y avisa a quien escucha, en vez de tragárselo',
    conHueco.gaps >= 1,
    `${conHueco.gaps} aviso(s) de hueco de ${conHueco.total} eventos`);
  chk('pero solo uno, no uno por evento perdido',
    conHueco.gaps === 1, `${conHueco.gaps}`);
  chk('y tras avisar, queda al día de la revisión',
    conHueco.st.revision > stAntes.revision + 200,
    `${stAntes.revision} → ${conHueco.st.revision}`);
  await p2.close();

  /* ── 3. Conectado y mudo ────────────────────────────────────── */
  console.log('\n3. Conectado y mudo: el servidor acepta y no vuelve a hablar');
  // v2.38.20 — dos formas de simularlo, y ninguna servía:
  //
  //  - `context.setOffline(true)` no corta una conexión SSE ya abierta:
  //    el socket sigue vivo y el latido sigue llegando.
  //  - `route.fulfill` con un saludo y nada más: la respuesta se
  //    cierra al instante, el EventSource da error, y de eso se entera
  //    `onerror`, no el vigilante. Se prueba el camino equivocado.
  //
  // El caso de verdad es una conexión ABIERTA y silenciosa, y eso se
  // hace con un EventSource que se traga todo lo que llega después del
  // saludo. El cliente no puede distinguirlos: para él es un servidor
  // que ha dejado de hablar.
  const p3 = await ctx.newPage();
  await p3.addInitScript(auth, { tok, url: API });
  await p3.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  const st3 = await esperarConectado(p3);
  chk('con el servidor hablando, conectado', st3.connected, `revisión ${st3.revision}`);

  await p3.evaluate(async () => {
    const Real = window.EventSource;
    // A partir de ahora, el canal no vuelve a decir nada.
    window.EventSource = class Mudo extends Real {
      constructor(url, opts) {
        super(url, opts);
        this.addEventListener('hello', () => { this.__mudo = true; });
        for (const ev of ['change', 'synced', 'ping']) {
          this.addEventListener(ev, (e) => { if (this.__mudo) e.stopImmediatePropagation(); });
        }
      }
    };
    const m = await import('/src/services/live.js');
    m.stopLive();
    m.startLive();
  });
  await p3.waitForTimeout(2000);
  const abierto = await p3.evaluate(async () =>
    (await import('/src/services/live.js')).liveState());
  chk('el canal sigue "conectado": la conexión está abierta',
    abierto.connected === true);

  // Ahora sí, a esperar. El vigilante tiene que despertar solo.
  const t0 = Date.now();
  let caida = null;
  while (Date.now() - t0 < 45_000) {
    caida = await p3.evaluate(async () =>
      (await import('/src/services/live.js')).liveState());
    if (!caida.connected) break;
    await p3.waitForTimeout(500);
  }
  const enCuanto = Math.round((Date.now() - t0) / 1000);
  chk('el indicador deja de decir "en línea" cuando el servidor calla',
    caida.connected === false, `a los ${enCuanto} s de silencio`);
  chk('y se entera antes de un minuto',
    enCuanto < 45, `peor caso: ${enCuanto} s`);

  // Con el canal muerto, otro dispositivo escribe.
  for (let i = 0; i < 4; i++) await mknote('Canal muerto ' + i);
  const enServidor = await fetch(API + '/api/v1/accounts/revision', { headers: h })
    .then((r) => r.json());
  chk('el servidor registra lo que se escribió sin que lo viéramos',
    enServidor.revision > st3.revision, `${st3.revision} → ${enServidor.revision}`);

  // El servidor vuelve a hablar de verdad: se quita el EventSource mudo.
  await p3.evaluate(async () => {
    location.reload();
  });
  await p3.waitForTimeout(12000);
  const vuelta = await p3.evaluate(async () =>
    (await import('/src/services/live.js')).liveState());
  chk('al volver el servidor, se reconecta solo', vuelta.connected === true);
  chk('y recupera lo que se perdió mientras el canal estaba muerto',
    vuelta.revision === enServidor.revision,
    `tiene ${vuelta.revision}, el servidor está en ${enServidor.revision}`);
  chk('sin hueco: lo perdido cabía en el historial', vuelta.gap === false);
  await p3.close();

  await br.close();
  console.log(`\n${'='.repeat(46)}\n${ok}/${ok + fail} correctas\n`);
  process.exit(fail ? 1 : 0);
})();
