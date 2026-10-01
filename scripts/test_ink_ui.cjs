// test_ink_ui.cjs — la tinta en el navegador, con dos ventanas abiertas.
//
// v2.38.14
//
// Dos páginas del MISMO navegador, con la misma sesión, escribiendo a la
// vez. Es el caso real del portátil con dos ventanas y —más importante—
// es como se comprueba que el canal de tiempo real llega a la pantalla,
// que es lo que faltaba.
//
// Se simula un lápiz de verdad: Playwright no puede dar presión con el
// ratón, así que se despachan PointerEvents con `pointerType: "pen"` y
// `pressure` variable. Es lo que llega de un Apple Pencil.
//
//   node scripts/test_ink_ui.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const SHOTS = path.join(ROOT, 'screenshots', 'ink');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** Escribe como lo haría un lápiz: con presión. */
async function writeWithStylus(page, sel, path01) {
  return page.evaluate(
    ([s, pts]) => {
      const el = document.querySelector(s);
      if (!el) return 'no hay superficie';
      const r = el.getBoundingClientRect();
      const ev = (type, x, y, pressure) =>
        el.dispatchEvent(new PointerEvent(type, {
          pointerId: 1, pointerType: 'pen', isPrimary: true,
          pressure, clientX: r.left + x * r.width, clientY: r.top + y * r.height,
          bubbles: true, cancelable: true,
        }));
      ev('pointerdown', pts[0][0], pts[0][1], 0.2);
      for (let i = 1; i < pts.length; i++) {
        // Presión que sube y baja, como un trazo real.
        ev('pointermove', pts[i][0], pts[i][1], 0.25 + 0.6 * Math.abs(Math.sin(i / 3)));
      }
      ev('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], 0);
      return 'ok';
    },
    [sel, path01],
  );
}

const curva = Array.from({ length: 24 }, (_, i) => [
  0.12 + i * 0.03,
  0.5 + Math.sin(i / 2.2) * 0.22,
]);

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
        username: 'ink' + Date.now(), password: 'demo123',
        deviceId: 'ink-' + Math.random().toString(36).slice(2, 7),
        deviceName: 'ink', platform: 'web',
      }),
    })
    .then((r) => r.json());

  const DOC = 'nota-mano';
  const mkPage = async () => {
    const p = await ctx.newPage();
    await p.addInitScript((a) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.theme', 'dark');
      localStorage.setItem('mnexus.lang', 'es');
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
    }, reg.accessToken);
    await p.goto(WEB + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(3000);
    return p;
  };

  const A = await mkPage();
  const B = await mkPage();

  // Montar la superficie en las dos.
  const montar = async (p) => p.evaluate(async (docId) => {
    const { mountInkPad } = await import('/src/widgets/ink_pad.js');
    const { loadInk, createInkSync } = await import('/src/services/inkSync.js');
    const doc = await loadInk(docId);
    const byPage = new Map();
    for (const page of doc.pages || []) {
      for (const s of page.strokes || []) {
        if (!byPage.has(s.page)) byPage.set(s.page, []);
        byPage.get(s.page).push(s);
      }
    }
    const host = document.createElement('div');
    host.id = 'ink-host';
    host.className = 'ink-pad';
    document.body.appendChild(host);
    // El sync se monta JUNTO a la superficie, que es como lo hace el
    // widget de verdad. Sin esto el trazo se dibuja y no sale de aqui.
    const sync = createInkSync(docId, {
      deviceId: 'web',
      onRemote: (incoming) => {
        for (const s of incoming) {
          const arr = byPage.get(s.page) || [];
          if (!arr.some((x) => x.id === s.id)) arr.push(s);
          byPage.set(s.page, arr);
        }
        window.__pad?.merge(incoming);
        window.__remotos = (window.__remotos || 0) + incoming.length;
      },
    });
    sync.start(2000);
    const pad = mountInkPad(host, {
      strokes: byPage.get(0) || [], deviceId: 'web',
      onStrokeEnd: (_s, nuevos) => { sync.push(nuevos); },
    });
    window.__pad = pad;
    window.__sync = sync;
    window.__host = host;
    return (byPage.get(0) || []).length;
  }, DOC);

  const sA = await montar(A);
  const sB = await montar(B);
  check('las dos superficies arrancan vacías y sin errores', sA === 0 && sB === 0, `${sA} / ${sB}`);

  // Escribir en A como un lápiz.
  const r = await writeWithStylus(A, '#ink-host .ink-stage', curva);
  check('el lápiz dibuja', r === 'ok', r);
  await A.waitForTimeout(400);

  const enA = await A.evaluate(() => ({
    trazos: window.__pad.strokes.length,
    puntos: window.__pad.strokes[0]?.points.length ?? 0,
    presion: window.__pad.strokes[0]?.points.map((p) => Math.round(p.p * 100) / 100).slice(0, 5),
    paths: document.querySelectorAll('#ink-host .ink-svg path').length,
    enFraccion: window.__pad.strokes[0]?.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
  }));
  check('el trazo se guarda en fracciones de página',
    enA.enFraccion && enA.trazos === 1, `${enA.trazos} trazo · x,y entre 0 y 1`);
  check('guarda la presión del lápiz, no una línea plana',
    new Set(enA.presion).size > 1, `presiones ${enA.presion.join(', ')}`);
  check('y el SVG sale con varios grosores, no uno solo',
    enA.paths >= 2, `${enA.paths} segmentos`);

  // Se empuja al servidor.
  await A.waitForTimeout(2500);
  const guardado = await ctx.request.get(API + '/api/v1/ink/' + DOC, {
    headers: { authorization: 'Bearer ' + reg.accessToken },
  }).then((x) => x.json());
  const enServidor = (guardado.pages || []).flatMap((p) => p.strokes);
  check('el trazo llega al servidor', enServidor.length === 1, `${enServidor.length} trazo(s)`);

  await A.screenshot({ path: path.join(SHOTS, '1-escribiendo.png') });

  // Y llega a la OTRA ventana. Esta es la parte que faltaba.
  const llegado = await B.evaluate(async (docId) => {
    const { loadInk } = await import('/src/services/inkSync.js');
    const doc = await loadInk(docId);
    return (doc.pages || []).flatMap((p) => p.strokes).length;
  }, DOC);
  check('la otra ventana lo ve sin haber escrito ella', CHECK_GE(llegado, 1), `${llegado} trazo(s) en B`);

  // El canal de tiempo real: ¿llega sin recargar?
  //
  // Se abre el canal en B, se escribe en A, y se espera el evento. La
  // version anterior de este test abria el canal despues de escribir y
  // se quedaba esperando un cambio que ya habia pasado: 8 segundos de
  // reloj para no comprobar nada.
  const esperando = B.evaluate(() => new Promise((resolve) => {
    // El token va por query: EventSource no puede mandar cabeceras.
    const url = `${localStorage.getItem('mnexus.backend.url')}/api/v1/stream?token=` +
      encodeURIComponent(sessionStorage.getItem('mnexus.auth.access'));
    const es = new EventSource(url);
    const t = setTimeout(() => { es.close(); resolve('sin evento en 9s'); }, 9000);
    es.addEventListener('change', (ev) => {
      clearTimeout(t);
      es.close();
      let d = {}; try { d = JSON.parse(ev.data); } catch {}
      resolve(`revisión ${d.revision} · ${d.collection}`);
    });
  }));
  await B.waitForTimeout(900);
  await writeWithStylus(A, '#ink-host .ink-stage', curva.map(([x, y]) => [x + 0.05, y - 0.05]));
  await A.waitForTimeout(3000);
  const enCanal = await esperando;
  check('el canal en tiempo real avisa al otro dispositivo, sin recargar',
    typeof enCanal === 'string' && enCanal.startsWith('revisión'), enCanal);

  const remotos = await B.evaluate(() => window.__remotos || 0);
  check('y el trazo se le fusiona sin romper lo suyo', remotos >= 1, `${remotos} trazo(s) recibidos`);

  await A.screenshot({ path: path.join(SHOTS, '2-dos-ventanas.png') });

  // Undo de verdad.
  const antes = await A.evaluate(() => window.__pad.strokes.length);
  await A.click('#ink-host [data-undo]');
  await A.waitForTimeout(300);
  const despues = await A.evaluate(() => window.__pad.strokes.length);
  check('deshacer quita el último trazo entero', despues < antes, `${antes} → ${despues}`);

  await browser.close();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((x) => x.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();

function CHECK_GE(n, min) { return n >= min; }
