// audit_overlays.cjs — ¿cuántas capas flotantes hay encima a la vez?
//
// El complaint es concreto: hay menús por debajo de otros y solo
// debería verse uno, el redondeado. Eso se comprueba recorriendo la
// app, contando lo que flota por encima del contenido en cada
// pantalla, y anotando québuttons hay y si alguno está muerto o
// solapado.
//
//   node scripts/audit_overlays.cjs
//
// Requiere backend en :4000 y frontend en :8080.

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'overlay-audit');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const ROUTES = [
  'overview', 'notes', 'calendar', 'capture', 'rag', 'generate', 'study',
  'progress', 'mood', 'journal', 'ai', 'occlusion', 'settings', 'todos',
  'subjects', 'cluster', 'kg', 'v232',
];

/** What is layered over the page content, and what buttons are there. */
const PROBE = () => {
  const layers = [];
  const seen = new Set();
  document.querySelectorAll('body > *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    if (seen.has(el)) return;
    seen.add(el);
    layers.push({
      cls: (el.className || el.id || el.tagName).toString().slice(0, 40),
      z: Number(cs.zIndex) || 0,
      rounded: Math.min(r.width, r.height) > 60,
      covers: r.width >= window.innerWidth * 0.6,
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  });
  layers.sort((a, b) => b.z - a.z);

  // Buttons: reachable, big enough, and not buried under a layer.
  const buttons = [];
  document.querySelectorAll('button, a[href], [role="button"]').forEach((b) => {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (getComputedStyle(b).visibility === 'hidden') return;
    const cs = getComputedStyle(b);
    const top = document.elementFromPoint(
      Math.min(r.x + r.width / 2, window.innerWidth - 2),
      Math.min(r.y + r.height / 2, window.innerHeight - 2),
    );
    const buried = top && !b.contains(top) && !top.contains(b);
    buttons.push({
      label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 22),
      w: Math.round(r.width),
      h: Math.round(r.height),
      small: r.height < 44 && r.width < 44,
      disabled: !!b.disabled,
      buried: !!buried,
    });
  });

  return {
    layers,
    stacked: layers.filter((l) => l.covers && l.rounded).length,
    buttons: buttons.length,
    small: buttons.filter((b) => b.small).length,
    buried: buttons.filter((b) => b.buried).length,
  };
};

async function seed(ctx) {
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'a' + Date.now(),
        password: 'demo123',
        deviceId: 'ax-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'a',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const h = { authorization: 'Bearer ' + reg.accessToken };
  const f = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Genética' } })
    .then((r) => r.json());
  await ctx.request.post(API + '/api/v1/notes', {
    headers: h,
    data: { title: 'Fibrosis quística', body: 'Se debe al gen CFTR.', folderId: f.id },
  });
  for (const [text, kind] of [
    ['comprar leche el viernes a las 18:00', 'shopping'],
    ['estudiar el ciclo cardíaco mañana a las 20:00', 'task'],
  ]) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: h, data: { text, kind, done: false } });
  }
  for (let d = 6; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const j = await ctx.request
      .post(API + '/api/v1/journal/today', { headers: h, data: { date: day } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (j.id) {
      await ctx.request
        .post(API + '/api/v1/journal/' + j.id + '/mood', { headers: h, data: { score: 4 } })
        .catch(() => {});
    }
  }
  return reg.accessToken;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const tok = await seed(ctx);
  const page = await ctx.newPage();
  await page.addInitScript(
    (a) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.theme', 'dark');
      localStorage.setItem('mnexus.lang', 'es');
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
    },
    tok,
  );

  console.log('ruta'.padEnd(11) + 'capas  apiladas  botones  <44px  enterrados');
  let badStacks = 0;
  let totalSmall = 0;
  let totalBuried = 0;
  for (const route of ROUTES) {
    await page.goto(WEB + '/index.html#/' + route, { waitUntil: 'load' });
    const t0 = Date.now();
    let clear = 0;
    while (Date.now() - t0 < 12000) {
      const p = await page.evaluate(() => !!document.querySelector('.splash'));
      if (p) clear = 0;
      else if (!clear) clear = Date.now();
      else if (Date.now() - clear > 700) break;
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1200);
    const r = await page.evaluate(PROBE);
    if (r.stacked > 1) badStacks++;
    totalSmall += r.small;
    totalBuried += r.buried;
    console.log(
      route.padEnd(11) +
        String(r.layers.length).padEnd(7) +
        String(r.stacked).padEnd(10) +
        String(r.buttons).padEnd(9) +
        String(r.small).padEnd(7) +
        String(r.buried),
    );
    if (r.layers.length > 3) {
      console.log(
        '   capas: ' + r.layers.map((l) => l.cls + '(z' + l.z + ')').join(' '),
      );
    }
  }
  console.log(
    '\napiladas: ' + badStacks + ' rutas · botones <44px: ' + totalSmall + ' · enterrados: ' + totalBuried,
  );
  await browser.close();
})();
