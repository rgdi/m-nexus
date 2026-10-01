// capture_notes_doc.cjs — la nota nueva, con datos de verdad.
//
// v2.38.16. Tres preguntas que solo se contestan mirando:
//   1. ¿Se entiende sin explicacion?
//   2. ¿El modelo 3D sale, con etiqueta y con oclusion?
//   3. En movil, ¿la tinta solo aparece si hay lapiz?
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.WEB || 'http://localhost:8080';
const API = process.env.API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'notes-doc');
fs.mkdirSync(OUT, { recursive: true });

// addInitScript serializa la funcion y la ejecuta en el navegador: el
// cierre deariables NO viaja. El token tiene que pasar como ARGUMENTO.
const auth = function (cfg) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', cfg.tok);
  localStorage.setItem('mnexus.auth.refresh', cfg.tok);
  localStorage.setItem('mnexus.backend.url', cfg.url);
  localStorage.setItem('mnexus.theme', 'dark');
  localStorage.setItem('mnexus.lang', 'es');
};

(async () => {
  const br = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext({ deviceScaleFactor: 2 });
  const reg = await ctx.request.post(API + '/api/v1/register', { data: {
    username: 'doc' + Date.now(), password: 'demo123',
    deviceId: 'doc-' + Math.random().toString(36).slice(2, 10),
    deviceName: 'doc-cap', platform: 'web' } }).then((r) => r.json());
  const tok = reg.accessToken;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

  // Una nota por dispositivo: si la comparten, el bloque que mete uno
  // aparece en la captura del siguiente y se cuentan dos.
  const n1 = await ctx.request.post(API + '/api/v1/notes', { headers: h, data: {
    title: 'Sistema de conducción cardíaca',
    tags: ['cardio', 'anatomía'],
    body: 'El impulso eléctrico nace en el ==nodo sinoauricular== y viaja por el nodo auriculoventricular.\n\nDe ahí baja por el ==haz de His== hacia el ápex, y desde ahí sube por las ramas de Tawara hasta las fibras de Purkinje.\n\n!!La（金 aurícula derecha y la izquierda se contraen a la vez!!, y por eso las aurículas van antes que los ventrículos.\n\nVer también: [[Ciclo cardíaco]] y [[Válvulas cardíacas]].\n\n#anatomía',
  }}).then((r) => r.json());
  await ctx.request.post(API + '/api/v1/notes', { headers: h, data: {
    title: 'Ciclo cardíaco',
    tags: ['cardio'],
    body: 'Sístole y diástole.\n\nVuelve a [[Sistema de conducción cardíaca]].',
  }}).then((r) => r.json());

  const log = [];
  for (const d of [
    { k: 'pc', w: 1440, h: 900, lapiz: false },
    { k: 'movil', w: 390, h: 844, lapiz: false },
    { k: 'tablet', w: 820, h: 1180, lapiz: true },
  ]) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: d.w, height: d.h });
    await p.addInitScript(auth, { tok, url: API });
    if (d.lapiz) {
      // Un iPad se identifica por UA de Mac con puntos tactiles.
      await p.addInitScript(() => {
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(navigator, 'userAgent', {
          get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        });
      });
    }
    p.on('pageerror', (e) => log.push(`${d.k}: pageerror ${e.message} @ ${String(e.stack||'').split('\n').slice(1,4).join(' <- ')}`));
    // El campillo de notificaciones se abre solo en las capturas y
    // tapa la mitad de la pantalla. Se cierra antes de cada foto.
    const cerrarCampanita = async () => {
      await p.evaluate(() => {
        // hidden no basta: el CSS del panel le pone display.
        document.querySelectorAll('[data-dropdown],.notif-dropdown')
          .forEach((n) => { n.setAttribute('hidden',''); n.style.setProperty('display','none','important'); });
        document.body.querySelectorAll('.notif-bell-btn[aria-expanded="true"]')
          .forEach((b) => b.setAttribute('aria-expanded', 'false'));
      });
      await p.waitForTimeout(200);
    };

    // Nota propia para cada dispositivo.
    const propia = await ctx.request.post(API + '/api/v1/notes', { headers: h, data: {
      title: 'Sistema de conducción cardíaca',
      tags: ['cardio', 'anatomía'],
      body: 'El impulso eléctrico nace en el ==nodo sinoauricular== y baja por el ==haz de His==.\n\n!!Las aurículas van antes que los ventrículos!!\n\nVer también: [[Ciclo cardíaco]].\n\n#anatomía',
    } }).then((r) => r.json());
    await p.goto(WEB + '/index.html#/notes', { waitUntil: 'load' });
    await p.waitForTimeout(2600);
    await cerrarCampanita();
    await p.screenshot({ path: path.join(OUT, `${d.k}-1-lista.png`) });

    await p.click(`.doc-card[data-id="${propia.id}"]`);
    await p.waitForTimeout(2200);
    await cerrarCampanita();
    await p.screenshot({ path: path.join(OUT, `${d.k}-2-nota.png`) });

    // Meter un modelo 3D desde el menu "+".
    await p.click('#doc-add');
    await p.waitForTimeout(350);
    await cerrarCampanita();
    await p.screenshot({ path: path.join(OUT, `${d.k}-3-menu.png`) });
    await p.click('[data-add="3d"]');
    await p.waitForTimeout(3500);
    await cerrarCampanita();
    await p.screenshot({ path: path.join(OUT, `${d.k}-4-modelo3d.png`) });

    const info = await p.evaluate(() => ({
      lienzo: !!document.querySelector('.m3d-stage canvas'),
      nota3d: !!document.querySelector('.doc-block .m3d'),
      bloques: document.querySelectorAll('.doc-block').length,
      tinta: !document.querySelector('#doc-ink')?.hidden,
      punteroLateral: getComputedStyle(document.querySelector('#doc-rail') || document.body).display !== 'none',
      meta: (document.querySelector('#doc-meta')?.textContent || '').slice(0, 60),
      texto: (document.querySelector('#doc-content')?.innerText || '').length,
      editorOculto: document.querySelector('#doc-editor')?.hidden,
    }));
    log.push(`${d.k}: ${JSON.stringify(info)}`);

    // Poner una etiqueta y una oclusion sobre el modelo.
    // locator.click() hace scroll si hace falta y calcula las
    // coordenadas en el momento. Con page.mouse las coordenadas son
    // del viewport en ese instante: si el bloque estaba fuera de
    // pantalla, el clic se perdia en otro sitio y no pasaba nada.
    const stage = p.locator('.m3d-stage canvas').last();
    try {
    if (info.lienzo) {
      await stage.scrollIntoViewIfNeeded();
      await p.locator('.m3d-label-btn').last().scrollIntoViewIfNeeded();
      await p.waitForTimeout(250);
      await p.locator('.m3d-label-btn').last().click();
      const dim = await (await p.locator('.m3d-stage').last().boundingBox());
      const pt = (fx, fy) => ({ x: Math.round(dim.width * fx), y: Math.round(dim.height * fy) });
      await stage.click({ position: pt(0.42, 0.4) });
      await p.waitForTimeout(500);
      await p.locator('.m3d-input').last().fill('Aurícula derecha');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(600);

      await p.locator('.m3d-occ-btn').last().scrollIntoViewIfNeeded();
      await p.waitForTimeout(250);
      await p.locator('.m3d-occ-btn').last().click();
      await stage.click({ position: pt(0.6, 0.62) });
      await p.waitForTimeout(800);
      await cerrarCampanita();
      await p.screenshot({ path: path.join(OUT, `${d.k}-5-etiqueta-oclusion.png`) });

      const m3 = await p.evaluate(() => ({
        etiquetas: document.querySelectorAll('.m3d-pin').length,
        oclusiones: document.querySelectorAll('.m3d-occ').length,
        nombre: document.querySelector('.m3d-name')?.textContent || '',
      }));
      log.push(`${d.k}: 3D ${JSON.stringify(m3)}`);
    }
    } catch (e) { log.push(`${d.k}: fallo al etiquetar — ${String(e).split('\n')[0]}`); }
    await p.close();
  }
  await br.close();
  await fs.promises.writeFile(path.join(OUT, '_log.txt'), log.join('\n') + '\n');
  console.log(log.join('\n'));
})();
