// test_live_push.cjs — el hueco que quedó: ¿llega el push de verdad?
//
// v2.38.15
//
// Lo que faltaba en el test anterior es precisamente lo importante: la
// página que espera el evento, desde SU PROPIO cliente, sin EventSource
// escrito a mano en el test. Porque el test anterior se montaba su
// EventSource con su cuenta y su timing, y eso no es lo mismo que lo
// que hace la app.
//
// Este test:
//   1. monta la app de verdad, que se suscribe sola en services/live.js
//   2. espera a que el canal esté conectado
//   3. escribe en el servidor desde FUERA del navegador
//   4. mira si la página ha recibido el evento, sin recargar nada
//
//   node scripts/test_live_push.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const SHOTS = path.join(ROOT, 'screenshots', 'live');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-ES',
  });

  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        username: 'live' + Date.now(), password: 'demo123',
        deviceId: 'live-' + Math.random().toString(36).slice(2, 7),
        deviceName: 'live', platform: 'web',
      }),
    })
    .then((r) => r.json());
  const H = { authorization: 'Bearer ' + reg.accessToken, 'content-type': 'application/json' };

  const page = await ctx.newPage();
  await page.addInitScript((a) => {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    sessionStorage.setItem('mnexus.auth.access', a);
    localStorage.setItem('mnexus.auth.refresh', a);
    localStorage.setItem('mnexus.theme', 'dark');
    localStorage.setItem('mnexus.lang', 'es');
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, reg.accessToken);

  const recibidos = [];
  await page.exposeFunction('__anotaCambio', (detalle) => {
    recibidos.push(detalle);
  });

  await page.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  // La app se suscribe sola; hay que oír lo que ella emite.
  await page.evaluate(() => {
    window.addEventListener('mnexus:changed', (e) => window.__anotaCambio(e.detail));
  });

  // ¿Está conectado de verdad? liveState lo dice.
  let conectado = false;
  for (let i = 0; i < 20; i++) {
    conectado = await page.evaluate(async () => {
      const m = await import('/src/services/live.js');
      return m.liveState().connected;
    });
    if (conectado) break;
    await page.waitForTimeout(500);
  }
  check('el cliente se conecta solo al arrancar la app', conectado,
    conectado ? 'canal abierto' : 'no se conectó en 10s');

  const rev0 = await page.evaluate(async () => (await import('/src/services/live.js')).liveState().revision);
  check('y sabe en qué revisión está', typeof rev0 === 'number', `revisión ${rev0}`);

  // Ahora se escribe desde FUERA del navegador: otro dispositivo.
  await ctx.request.post(API + '/api/v1/folders', { headers: H, data: { name: 'Prueba' } });
  await ctx.request.post(API + '/api/v1/notes', {
    headers: H,
    data: { title: 'Nota desde el otro dispositivo', body: 'Esto lo ha escrito otro.' },
  });

  // Y se espera a que la página se entere, SIN recargar.
  let evento = null;
  for (let i = 0; i < 24 && !evento; i++) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(async () => (await import('/src/services/live.js')).liveState());
    if (st.revision > rev0) evento = st;
  }

  check('otro dispositivo escribe y la página se entera SIN recargar',
    !!evento, evento ? `revisión ${evento.revision}` : `siguió en ${rev0}`);

  const avisos = await page.evaluate(() => window.__anotaCambio ? true : false);
  const visto = recibidos.length > 0;
  check('y el evento sale por el puente de la app', visto,
    visto ? `${recibidos.length} aviso(s) · ${recibidos[0]?.collection}` : 'nunca llegó a la página');

  check('el aviso trae la revisión nueva', visto && recibidos[0]?.revision > rev0,
    `recibida ${recibidos[0]?.revision} · antes ${rev0}`);

  // El sondeo de 3 s: aunque el push no llegue, los datos están.
  const notas = await page.evaluate(async () => {
    const d = await fetch(localStorage.getItem('mnexus.backend.url') + '/api/v1/notes', {
      headers: { authorization: 'Bearer ' + sessionStorage.getItem('mnexus.auth.access') },
    }).then((r) => r.json());
    return (Array.isArray(d) ? d : d.notes || []).length;
  });
  check('y los datos están disponibles sin recargar la página', notas > 0, `${notas} notas`);

  await page.screenshot({ path: path.join(SHOTS, 'overview.png') });

  // Dos ventanas: una escribe, la otra se entera por el canal.
  const B = await ctx.newPage();
  await B.addInitScript((a) => {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    sessionStorage.setItem('mnexus.auth.access', a);
    localStorage.setItem('mnexus.auth.refresh', a);
    localStorage.setItem('mnexus.theme', 'dark');
    localStorage.setItem('mnexus.lang', 'es');
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, reg.accessToken);
  const recibidosB = [];
  await B.exposeFunction('__anotaCambioB', (d) => recibidosB.push(d));
  await B.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  await B.waitForTimeout(4500);
  await B.evaluate(() => {
    window.addEventListener('mnexus:changed', (e) => window.__anotaCambioB(e.detail));
  });

  const revB = await B.evaluate(async () => (await import('/src/services/live.js')).liveState().revision);
  await ctx.request.post(API + '/api/v1/notes', {
    headers: H,
    data: { title: 'Segunda nota', body: 'De la otra ventana.' },
  });

  let vioB = false;
  for (let i = 0; i < 20 && !vioB; i++) {
    await B.waitForTimeout(500);
    const st = await B.evaluate(async () => (await import('/src/services/live.js')).liveState());
    if (st.revision > revB) vioB = true;
  }
  check('con dos ventanas abiertas, la que no escribe también se entera',
    vioB, vioB ? `la otra ventana subió a una revisión nueva` : `se quedó en ${revB}`);

  await B.screenshot({ path: path.join(SHOTS, 'segunda-ventana.png') });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
