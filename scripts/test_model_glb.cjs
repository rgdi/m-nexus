// test_model_glb.cjs — abrir un .glb propio desde el dispositivo.
//
// v2.38.19. Lo que promete el botón «Abrir .glb»: que el archivo se
// abre, que se encuadra, y que encima se puede etiquetar y tapar.
//
// Un .glb de verdad, generado aquí, no un archivo inventado: el
// cargador tiene que poder leerlo.
//
//   node scripts/test_model_glb.cjs
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const FE = join(ROOT, 'frontend');
const OUT = join(ROOT, 'screenshots', 'modelos');
const GLB = process.argv[2] || join(__dirname, 'fixtures', 'caja.glb');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary',
};

let ok = 0, fail = 0;
const chk = (name, good, why = '') => {
  if (good) { ok++; console.log(`  ok     ${name}${why ? ' — ' + why : ''}`); }
  else { fail++; console.log(`  FALLO  ${name}${why ? ' — ' + why : ''}`); }
};

if (!existsSync(GLB)) { console.error(`No existe ${GLB}`); process.exit(1); }

(async () => {
  await mkdir(OUT, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/sw.js') { res.writeHead(404); res.end(''); return; }
      if (url.pathname === '/prueba.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/src/styles/tokens.css"></head>
          <body style="margin:0;background:#0e1118">
            <div id="h" style="width:1000px;height:760px"></div>
            <script type="module">
              import { mountModel3D } from "/src/widgets/model3d_block.js";
              const inst = await mountModel3D(document.getElementById("h"), { modelId: "corazon" });
              window.__inst = inst;
              document.body.dataset.ok = "1";
            </script></body></html>`);
        return;
      }
      let p = join(FE, decodeURIComponent(url.pathname));
      if (!existsSync(p) || extname(p) === '') p = join(FE, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(await readFile(p));
    } catch { res.writeHead(500); res.end('error'); }
  });
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}`;

  const br = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await br.newPage({ viewport: { width: 1000, height: 760 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e).split('\n')[0]));
  // v2.38.21 — elegir un modelo lo sube al servidor, asi que hace
  // falta sesion. Antes se guardaba solo en el navegador y por eso
  // este test no necesitaba token.
  await page.addInitScript((cfg) => {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    sessionStorage.setItem('mnexus.auth.access', cfg.tok);
    localStorage.setItem('mnexus.auth.refresh', cfg.tok);
    localStorage.setItem('mnexus.backend.url', cfg.api);
    localStorage.setItem('mnexus.theme', 'dark');
  }, { tok: process.env.GLBT || (await (async () => {
    const r = await fetch(API + '/api/v1/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'glb' + Date.now(), password: 'demo123',
        deviceId: 'glb-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'glb', platform: 'web',
      }),
    });
    return (await r.json()).accessToken;
  })()), api: API });

  // La pagina tiene que servirse desde :8080, no desde un puerto
  // aleatorio: el backend solo acepta los origenes de la aplicacion,
  // asi que desde un puerto inventado la subida la para CORS. Y no es
  // un detalle del arnes: es la misma politica que vera el usuario si
  // abriera la app desde cualquier otra parte.
  await page.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { mountModel3D } = await import('/src/widgets/model3d_block.js');
    const h = document.createElement('div');
    h.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0e1118';
    const inner = document.createElement('div');
    inner.style.cssText = 'width:1000px;height:760px;margin:20px auto';
    h.appendChild(inner);
    document.body.appendChild(h);
    await mountModel3D(inner, { modelId: 'corazon' });
  });
  await page.waitForTimeout(1800);
  await page.waitForTimeout(2500);

  const antes = await page.evaluate(() => {
    const l = document.querySelector('.m3d-foot')?.textContent || '';
    return { pie: l, canvas: !!document.querySelector('.m3d-stage canvas') };
  });
  chk('sin archivo propio, sale el modelo generado', /Corazón/.test(antes.pie), antes.pie.slice(0, 50));
  chk('y hay lienzo', antes.canvas);

  // Elegir el archivo por el input REAL, como lo haría una persona.
  await page.setInputFiles('.m3d [data-file]', GLB);
  await page.waitForTimeout(2500);

  const despues = await page.evaluate(() => ({
    pie: document.querySelector('.m3d-foot')?.textContent || '',
    lienzo: !!document.querySelector('.m3d-stage canvas'),
  }));
  // "Modelo guardado", no "Modelo propio": el archivo se queda en el
  // dispositivo y hay que decirlo, para que se sepa que es de esta
  // máquina y no viaja con la nota.
  // El pie dice "Modelo — <crédito>". Lo que NO puede decir es el
  // aviso de "se abrió solo en este aparato": eso sería que la subida
  // falló, y hay una comprobación aparte para eso.
  chk('el .glb se carga y no cae en el modo "solo aquí"',
    /caja/.test(despues.pie) && !/solo en este aparato/.test(despues.pie),
    despues.pie.slice(0, 70));
  chk('el crédito se rellena con el nombre del archivo',
    /caja/.test(despues.pie), despues.pie.slice(0, 60));
  chk('sigue habiendo lienzo', despues.lienzo);

  // Y encima se puede etiquetar y ocluir, como con cualquier modelo.
  await page.locator('.m3d-label-btn').click();
  const box = await page.locator('.m3d-stage canvas').boundingBox();
  await page.locator('.m3d-stage canvas').click({
    position: { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.45) },
  });
  await page.waitForTimeout(600);
  const hayInput = await page.evaluate(() => !!document.querySelector('.m3d-input'));
  chk('se puede etiquetar sobre el modelo cargado', hayInput);
  if (hayInput) {
    await page.locator('.m3d-input').fill('Estructura de prueba');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => document.querySelectorAll('.m3d-pin').length);
    chk('la etiqueta se queda pegada a la geometría', n === 1, `${n} etiquetas`);
  }
  await page.locator('.m3d-occ-btn').click();
  await page.locator('.m3d-stage canvas').click({
    position: { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.6) },
  });
  await page.waitForTimeout(700);
  const occ = await page.evaluate(() => document.querySelectorAll('.m3d-occ').length);
  chk('y se puede tapar una zona', occ === 1, `${occ} oclusiones`);

  await page.locator('.m3d-stage').screenshot({ path: join(OUT, 'glb-propio.png') });

  /* ── La parte que faltaba: que sobreviva a recargar ─────────── */
  // v2.38.20 — hasta aquí el modelo vivía en la sesión. Al recargar
  // la página se apagaba y volvía al de ejemplo sin decir por qué.
  // v2.38.21 — ahora hay servidor Y cache. Los dos, o el modelo no
  // llega al otro aparato.
  const enServidor = await page.evaluate(async () => {
    const m = await import('/src/services/model_store.js');
    const d = await m.listarServidor();
    return { n: (d.models || []).length, usados: d.used, max: d.max,
             error: d.error || null,
             sinMiId: (d.models || []).some((x) => !x.builtin) };
  });
  chk('el archivo se sube al servidor, no se queda en el aparato',
    enServidor.sinMiId,
    enServidor.error ? `error: ${enServidor.error}`
      : `${enServidor.n} modelo(s), ${enServidor.usados} de ${enServidor.max} bytes`);

  const guardado = await page.evaluate(async () => {
    const m = await import('/src/services/model_store.js');
    const lista = await m.listarCache();
    return { n: lista.length, nombre: lista[0]?.nombre, bytes: lista[0]?.bytes };
  });
  chk('y además queda en caché, para no bajarlo cada vez',
    guardado.n >= 1, `${guardado.n} en caché, ${guardado.nombre}, ${guardado.bytes} bytes`);

  // Recargar de verdad.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const trasRecarga = await page.evaluate(() => ({
    notas: (window.__modeloGuardado || null),
    estado: null,
  }));
  // La página de prueba monta de nuevo sin archivo: lo que se comprueba
  // es que el almacén devuelve el Blob y que el visor lo abre.
  const rehidratado = await page.evaluate(async () => {
    const m = await import('/src/services/model_store.js');
    const l = await m.listarCache();
    if (!l.length) return { ok: false, motivo: 'el almacén quedó vacío' };
    const url = await m.urlDeModelo(l[0].id);
    if (!url) return { ok: false, motivo: 'no hay Blob' };
    if (!url) return { ok: false, motivo: 'ni en cache ni en el servidor' };
    const r = await fetch(url);
    const b = await r.blob();
    const tipo = b.type || '(sin tipo)';
    URL.revokeObjectURL(url);
    return { ok: b.size === l[0].bytes, id: l[0].id, deCache: r.deCache,
             motivo: `id=${l[0].id} · ${r.deCache ? 'de la cache' : 'bajado del servidor'} · ${b.size} vs ${l[0].bytes} · ${tipo}` };
  });
  chk('tras recargar la página, el modelo sigue en la caché del aparato',
    rehidratado.ok && rehidratado.deCache === true, rehidratado.motivo);

  // Y ahora sí, el circuito entero: un modelo guardado que se abre
  // desde su id, sin volver a elegir el archivo.
  const desdeId = await page.evaluate(async () => {
    const m = await import('/src/services/model_store.js');
    const l = await m.listarCache();
    const { mountModel3D } = await import('/src/widgets/model3d_block.js');
    const h = document.createElement('div');
    h.style.cssText = 'width:600px;height:460px';
    document.body.appendChild(h);
    await mountModel3D(h, { modelId: 'corazon', assetId: l[0].id, credit: l[0].nombre });
    await new Promise((r) => setTimeout(r, 1500));
    return {
      pie: h.querySelector('.m3d-foot')?.textContent || '',
      canvas: !!h.querySelector('.m3d-stage canvas'),
    };
  });
  chk('el visor abre el modelo por su id, sin volver a elegir el archivo',
    /caja/.test(desdeId.pie) && !/solo en este aparato/.test(desdeId.pie),
    desdeId.pie.slice(0, 70));
  chk('y pinta', desdeId.canvas);

  chk('sin errores en consola durante todo el proceso',
    errores.length === 0, errores.slice(0, 2).join(' | ') || 'ninguno');

  await br.close();
  server.close();
  console.log(`\n${'='.repeat(46)}\n${ok}/${ok + fail} correctas\n`);
  process.exit(fail ? 1 : 0);
})();
