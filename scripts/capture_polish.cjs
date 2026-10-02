// capture_polish.cjs — el rediseño, en las pantallas que mas se ven.
//
// v2.38.22. Los tokens cambian el color de TODO y el pulido cambia cómo
// se siente. Eso no se lee en un test: hay que mirarlo, en claro y en
// oscuro, en las pantallas de verdad con datos de verdad.
//
//   node scripts/capture_polish.cjs
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.WEB || 'http://localhost:8080';
const API = process.env.API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'diseno');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch({
    executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext({ deviceScaleFactor: 2 });
  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: {
      username: 'dis' + Date.now(), password: 'demo123',
      deviceId: 'dis-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'diseno', platform: 'web',
    },
  }).then((r) => r.json());
  const tok = reg.accessToken;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

  // Datos de verdad: si se captura una pantalla vacia no se está
  // capturando el diseño, se está capturando un hueco.
  const carpeta = await ctx.request.post(API + '/api/v1/folders', {
    headers: h, data: { name: 'Cardiología' },
  }).then((r) => r.json());
  for (const [title, body] of [
    ['Sistema de conducción cardíaca',
     'El impulso nace en el ==nodo sinoauricular== y baja por el ==haz de His==.\n\n!!Las aurículas van antes que los ventrículos!!\n\nVer también: [[Ciclo cardíaco]].'],
    ['Ciclo cardíaco', 'Sístole y diástole.\n\nVuelve a [[Sistema de conducción cardíaca]].'],
    ['Presión arterial', 'La aorta tiene elasticidad para absorber el pico sistólico.'],
  ]) {
    await ctx.request.post(API + '/api/v1/notes', {
      headers: h, data: { title, body, folderId: carpeta.id, tags: ['cardio'] },
    });
  }
  for (let i = 0; i < 6; i++) {
    await ctx.request.post(API + '/api/v1/flashcards', {
      headers: h, data: { noteId: 'x', front: `Cara ${i}`, back: 'Reverso' },
    }).catch(() => {});
  }
  await ctx.request.post(API + '/api/v1/tasks', {
    headers: h, data: { title: 'Repasar el ciclo cardíaco', done: false },
  }).catch(() => {});

  const RUTAS = ['overview', 'notes', 'study', 'calendar', 'progress', 'settings'];

  for (const tema of ['light', 'dark']) {
    for (const d of [{ k: 'pc', w: 1440, h: 900 }, { k: 'movil', w: 390, h: 844 }]) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: d.w, height: d.h });
      // El tema se fija ANTES de que arranque nada, o hay un parpadeo
      // en la captura y la foto no es la que ve la gente.
      await p.addInitScript((cfg) => {
        localStorage.setItem('mnexus.setup.completed', '1');
        localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
        sessionStorage.setItem('mnexus.auth.access', cfg.tok);
        localStorage.setItem('mnexus.auth.refresh', cfg.tok);
        localStorage.setItem('mnexus.backend.url', cfg.api);
        localStorage.setItem('mnexus.theme', cfg.tema);
        document.documentElement.setAttribute('data-theme', cfg.tema);
      }, { tok, api: API, tema });

      for (const r of RUTAS) {
        await p.goto(`${WEB}/index.html#/${r}`, { waitUntil: 'load' });
        await p.waitForTimeout(2200);
        if (r === 'notes') {
          await p.evaluate(() => {
            [...document.querySelectorAll('.doc-card, .note-name, [data-note-id]')]
              .find((e) => /conducción/i.test(e.textContent || ''))?.click();
          });
          await p.waitForTimeout(1400);
        }
        await p.screenshot({ path: path.join(OUT, `${tema}-${d.k}-${r}.png`) });
      }
      await p.close();
    }
  }

  // Y una comprobación que una foto no da: el contraste real del texto
  // terciario, que es el que se ve "sucio" y no se puede medir a ojo.
  const contraste = await (async () => {
    const p = await ctx.newPage();
    await p.addInitScript((cfg) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', cfg.tok);
      localStorage.setItem('mnexus.theme', 'claro');
      document.documentElement.setAttribute('data-theme', 'light');
    }, { tok });
    await p.goto(WEB + '/index.html#/overview', { waitUntil: 'load' });
    await p.waitForTimeout(2200);
    const r = await p.evaluate(() => {
      const lum = (c) => {
        const [r1, g1, b1] = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3)
          .map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * r1 + .7152 * g1 + .0722 * b1;
      };
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue('--bg').trim();
      const f1 = cs.getPropertyValue('--fg').trim();
      const f2 = cs.getPropertyValue('--fg-muted').trim();
      const f3 = cs.getPropertyValue('--fg-faint').trim();
      const doc = document.createElement('div');
      document.body.appendChild(doc);
      const a = document.body.appendChild(document.createElement('span'));
      const hex2rgb = (h) => {
        if (h.startsWith('#')) {
          const n = parseInt(h.slice(1), 16);
          return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
        }
        return h;
      };
      const ratio = (x, y) => {
        const L1 = lum(hex2rgb(x)), L2 = lum(hex2rgb(y));
        const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
        return Math.round(((hi + .05) / (lo + .05)) * 100) / 100;
      };
      return { principal: ratio(f1, bg), secundario: ratio(f2, bg), terciario: ratio(f3, bg) };
    });
    await p.close();
    return r;
  })();

  await br.close();
  console.log('Contraste sobre el fondo (WCAG):');
  console.log(`  principal  ${contraste.principal}:1`);
  console.log(`  secundario ${contraste.secundario}:1`);
  console.log(`  terciario  ${contraste.terciario}:1`);
  console.log(`\nCapturas en screenshots/diseno/`);
})();
