// capture_ink.cjs — capturas de la tinta, del PDF anotado y del canal.
//
// v2.38.15
//
// Lo que se ve en el test corre con un contenedor de la nada. Esto monta
// las superficies donde las usa la persona de verdad, con contenido
// real detrás, y saca la foto.
//
//   node scripts/capture_ink.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const OUT = path.join(ROOT, 'screenshots', 'ink');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });

  for (const [nombre, vp, movil] of [
    ['movil', { width: 414, height: 896 }, true],
    ['ipad', { width: 820, height: 1180 }, true],
    ['pc', { width: 1440, height: 900 }, false],
  ]) {
    const ctx = await browser.newContext({
      viewport: vp, isMobile: movil, hasTouch: movil, deviceScaleFactor: 2, locale: 'es-ES',
    });
    const reg = await ctx.request
      .post(API + '/api/v1/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        data: JSON.stringify({
          username: nombre + Date.now(), password: 'demo123',
          deviceId: nombre + '-' + Math.random().toString(36).slice(2, 7),
          deviceName: nombre, platform: 'web',
        }),
      })
      .then((r) => r.json());
    const H = { authorization: 'Bearer ' + reg.accessToken, 'content-type': 'application/json' };

    // Una nota con texto de verdad detrás de la tinta.
    const folder = await ctx.request.post(API + '/api/v1/folders', { headers: H, data: { name: 'Fisiología' } }).then((r) => r.json());
    await ctx.request.post(API + '/api/v1/notes', {
      headers: H,
      data: {
        title: 'Ciclo cardíaco', folderId: folder.id,
        body: 'La sístole auricular llena los ventrículos.\nLa sístole ventricular los expulsa.\n60-100 latidos por minuto en reposo.',
      },
    });

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
    await page.goto(WEB + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(4000);

    // --- 1. La superficie de escritura, con una nota detrás -------------
    await page.evaluate(async () => {
      const { mountInkPad } = await import('/src/widgets/ink_pad.js');
      const { createInkSync, loadInk } = await import('/src/services/inkSync.js');
      const doc = 'cap-' + Math.random().toString(36).slice(2, 8);
      const loaded = await loadInk(doc);
      const app = document.createElement('div');
      app.id = 'ink-demo';
      app.className = 'ink-pad';
      app.style.cssText =
        'position:fixed;inset:0;z-index:9999;background:var(--bg,#0d0d10);padding:14px;display:grid;' +
        'grid-template-rows:auto minmax(0,1fr) auto;gap:10px';
      app.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:10px">
          <strong style="font-size:16px">Ciclo cardíaco</strong>
          <span style="font-size:12px;color:var(--fg-muted)">escribe encima con el lápiz o el dedo</span>
        </div>
        <div id="ink-stage-host" style="position:relative;min-height:0;display:grid;grid-template-rows:1fr;
             border-radius:12px;background:#f6f5f2;overflow:hidden">
          <div style="padding:26px 30px;font-size:15px;line-height:2.4;color:#1b1b20;font-family:Georgia,serif">
            <p style="margin:0 0 10px">La sístole auricular llena los ventrículos.</p>
            <p style="margin:0 0 10px">La sístole ventricular los expulsa.</p>
            <p style="margin:0">60-100 latidos por minuto en reposo.</p>
          </div>
        </div>
        <div style="font-size:12px;color:var(--fg-muted)" data-note>Pulsa y arrastra para escribir</div>`;
      document.body.appendChild(app);
      const sync = createInkSync(doc, { deviceId: 'demo' });
      // mountInkPad hace innerHTML del host, asi que la superficie
      // tiene que ser HERMANA del texto, no su madre: si no, se lo
      // come. Por eso el texto va en un wrapper y la superficie encima,
      // occupying the same box.
      const target = app.querySelector('#ink-stage-host');
      target.style.position = 'relative';
      const inkLayer = document.createElement('div');
      inkLayer.style.cssText = 'position:absolute;inset:0';
      target.appendChild(inkLayer);
      window.__pad = mountInkPad(inkLayer, {
        strokes: (loaded.pages || []).flatMap((p) => p.strokes || []),
        deviceId: 'demo',
        onStrokeEnd: (_s, nuevos) => {
          sync.push(nuevos);
          app.querySelector('[data-note]').textContent = 'Guardado · sincronizado con el otro dispositivo';
        },
      });
      app.querySelector('#ink-stage-host').style.minHeight = '300px';
    });

    // Escribir como lo haría un lápiz: con presión.
    await page.evaluate(() => {
      const el = document.querySelector('#ink-demo .ink-stage');
      const r = el.getBoundingClientRect();
      const ev = (t, x, y, pr) =>
        el.dispatchEvent(new PointerEvent(t, {
          pointerId: 1, pointerType: 'pen', isPrimary: true, pressure: pr,
          clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, cancelable: true,
        }));
      // Un subrayado sobre la primera frase, con presión variable.
      const y0 = 0.13;
      ev('pointerdown', 0.06, y0, 0.15);
      for (let i = 1; i <= 26; i++) {
        ev('pointermove', 0.06 + i * 0.031, y0 + Math.sin(i / 2) * 0.006, 0.3 + 0.55 * Math.abs(Math.sin(i / 3)));
      }
      ev('pointerup', 0.86, y0, 0);
      // Una flecha al margen.
      ev('pointerdown', 0.93, 0.3, 0.2);
      for (let i = 1; i <= 14; i++) ev('pointermove', 0.93 - i * 0.012, 0.3 + i * 0.018, 0.55);
      ev('pointerup', 0.78, 0.55, 0);
      // Y una anotación al pie.
      ev('pointerdown', 0.12, 0.78, 0.2);
      for (let i = 1; i <= 30; i++) {
        ev('pointermove', 0.12 + i * 0.024, 0.78 + Math.sin(i / 2.4) * 0.035, 0.25 + 0.5 * Math.abs(Math.cos(i / 4)));
      }
      ev('pointerup', 0.86, 0.78, 0);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `1-escritura-${nombre}.png`) });

    // El mismo trazo con el resaltador, que es la otra forma de uso.
    await page.evaluate(() => {
      document.querySelector('[data-tool="highlighter"]').click();
      const el = document.querySelector('#ink-demo .ink-stage');
      const r = el.getBoundingClientRect();
      const ev = (t, x, y) =>
        el.dispatchEvent(new PointerEvent(t, {
          pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5,
          clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, cancelable: true,
        }));
      ev('pointerdown', 0.08, 0.26);
      for (let i = 1; i <= 22; i++) ev('pointermove', 0.08 + i * 0.035, 0.26 + Math.sin(i / 2) * 0.004);
      ev('pointerup', 0.86, 0.26);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `2-resaltador-${nombre}.png`) });

    // --- 2. El PDF anotado ----------------------------------------------
    await page.evaluate(async () => {
      const { mountPdfAnnotate } = await import('/src/widgets/pdf_annotate.js');
      const host = document.createElement('div');
      host.id = 'pdf-demo';
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg,#0d0d10);padding:14px;overflow:auto';
      document.body.appendChild(host);
      // Un "PDF" de fondo: el diagrama del oído, que es de lo que
      // hablaría una clase de anatomía.
      const doc = 'pdfdemo-' + Math.random().toString(36).slice(2, 8);
      mountPdfAnnotate(host, {
        docId: doc,
        pageCount: 1,
        getPage: () => 'assets/occlusion/ear-es.png',
        onStatus: (m) => { window.__pdfStatus = m; },
      });
      window.__pdfDoc = doc;
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const el = document.querySelector('#pdf-demo .ink-stage');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ev = (t, x, y, pr) =>
        el.dispatchEvent(new PointerEvent(t, {
          pointerId: 1, pointerType: 'pen', isPrimary: true, pressure: pr,
          clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true, cancelable: true,
        }));
      ev('pointerdown', 0.2, 0.42, 0.2);
      for (let i = 1; i <= 24; i++) ev('pointermove', 0.2 + i * 0.026, 0.42 + Math.sin(i / 3) * 0.02, 0.5);
      ev('pointerup', 0.82, 0.42, 0);
    });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `3-pdf-anotado-${nombre}.png`), fullPage: !movil });

    console.log(`${nombre}: 3 capturas`);
    await ctx.close();
  }

  await browser.close();
  console.log(OUT);
})();
