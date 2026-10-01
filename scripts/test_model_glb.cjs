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
const GLB = process.argv[2] || '/tmp/caja.glb';
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
  await page.goto(`${BASE}/prueba.html`, { waitUntil: 'load' });
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
  chk('el .glb se carga y se dice que es propio',
    /Modelo propio/.test(despues.pie), despues.pie.slice(0, 60));
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

  chk('sin errores en consola durante todo el proceso',
    errores.length === 0, errores.slice(0, 2).join(' | ') || 'ninguno');

  await br.close();
  server.close();
  console.log(`\n${'='.repeat(46)}\n${ok}/${ok + fail} correctas\n`);
  process.exit(fail ? 1 : 0);
})();
