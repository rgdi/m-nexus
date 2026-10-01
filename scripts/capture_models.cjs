// capture_models.cjs — los seis modelos de anatomia, de uno en uno.
//
// v2.38.18. Un modelo que no se reconoce no sirve para estudiar
// anatomía, y eso no se ve en un test: hay que mirar la imagen.
//
//   node scripts/capture_models.cjs
//
// Salida: screenshots/modelos/<id>.png
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const FE = join(ROOT, 'frontend');
const OUT = join(ROOT, 'screenshots', 'modelos');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

(async () => {
  await mkdir(OUT, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/sw.js') { res.writeHead(404); res.end(''); return; }
      // Una pagina propia para cada modelo. setContent() deja la
      // pagina sin origen y el import de un modulo NO resuelve: sale
      // un fallo de CORS y no se ve nada.
      if (url.pathname === '/modelo.html') {
        const id = url.searchParams.get('id') || 'corazon';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><meta charset="utf-8">
          <link rel="stylesheet" href="/src/styles/tokens.css"></head>
          <body style="margin:0;background:#0e1118">
            <div id="h" style="width:1100px;height:900px"></div>
            <script type="module">
              import { mountModel3D } from "/src/widgets/model3d_block.js";
              await mountModel3D(document.getElementById("h"), { modelId: ${JSON.stringify(id)} });
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
  const page = await br.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).split('\n')[0]));
  await page.goto(`${BASE}/index.html#/overview`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const ids = await page.evaluate(async () => {
    const m = await import('/src/widgets/model3d_block.js');
    return m.MODEL_IDS;
  });

  const log = [];
  for (const id of ids) {
    // Cada modelo en su propia escena, sin interfaz alrededor: lo que
    // hay que mirar es la forma, no la pantalla.
    await page.goto(`${BASE}/modelo.html?id=${id}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const ok = await page.evaluate(() => document.body.dataset.ok === '1');
    if (!ok) {
      log.push(`${id}: el modulo no cargo desde setContent`);
      continue;
    }
    await page.waitForTimeout(1800);
    await page.locator('.m3d-stage').screenshot({ path: join(OUT, `${id}.png`) });
    log.push(`${id}: captura`);
  }

  await br.close();
  server.close();
  await writeFile(join(OUT, '_log.txt'), log.join('\n') + '\n');
  console.log(log.join('\n'));
})();
