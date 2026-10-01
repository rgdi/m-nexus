// verify_matrix.cjs — el layout en todos los tamaños, comprobado.
//
// Una captura dice cómo se ve una pantalla. Esto responde a otra
// pregunta: ¿está rota? Un desbordamiento horizontal, un elemento
// fuera de la ventana, el FAB encima de la barra, o el mismo título
// dos veces no se ven a simple vista en una imagen.
//
//   node scripts/verify_matrix.cjs
//
// Requiere backend en :4000 y frontend en :8080.
// Salida: screenshots/matrix/<device>-<route>.png y un resumen por consola.

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'matrix');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const DEVICES = [
  { id: 'phone-360', w: 360, h: 740, touch: true, ua: null, dsf: 2 },
  { id: 'phone-390', w: 390, h: 844, touch: true, ua: null, dsf: 2 },
  { id: 'phone-414', w: 414, h: 896, touch: true, ua: null, dsf: 2 },
  { id: 'ipad-820', w: 820, h: 1180, touch: true, ua: IPAD_UA, dsf: 2 },
  { id: 'ipad-1194', w: 1194, h: 820, touch: true, ua: IPAD_UA, dsf: 2 },
  { id: 'android-900', w: 900, h: 1200, touch: true, ua: ANDROID_UA, dsf: 2 },
  { id: 'laptop-1280', w: 1280, h: 800, touch: false, ua: null, dsf: 1 },
  { id: 'laptop-1440', w: 1440, h: 900, touch: false, ua: null, dsf: 1 },
  { id: 'desktop-1920', w: 1920, h: 1080, touch: false, ua: null, dsf: 1 },
  { id: 'wide-2560', w: 2560, h: 1200, touch: false, ua: null, dsf: 1 },
];

const ROUTES = ['overview', 'notes', 'calendar', 'capture', 'study', 'progress', 'mood', 'generate', 'settings'];

async function seed(ctx) {
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'm' + Date.now(),
        password: 'demo123',
        deviceId: 'mx-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'm',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const h = { authorization: 'Bearer ' + reg.accessToken };
  const gen = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Genética' } })
    .then((r) => r.json());
  for (const [title, body] of [
    ['Fibrosis quística', 'La fibrosis quística es autosómica recesiva por mutación en CFTR.'],
    ['Herencia mendeliana', 'Segregación y distribución independiente.'],
  ]) {
    await ctx.request.post(API + '/api/v1/notes', { headers: h, data: { title, body, folderId: gen.id } });
  }
  for (const [text, kind] of [
    ['comprar leche el viernes a las 18:00', 'shopping'],
    ['estudiar el ciclo cardíaco mañana a las 20:00', 'task'],
  ]) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: h, data: { text, kind, done: false } });
  }
  const now = Date.now();
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now - d * 86400000).toISOString().slice(0, 10);
    const j = await ctx.request
      .post(API + '/api/v1/journal/today', { headers: h, data: { date: day } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (j.id) {
      await ctx.request
        .post(API + '/api/v1/journal/' + j.id + '/mood', { headers: h, data: { score: [3, 4, 4, 2, 5, 3, 4][6 - d] } })
        .catch(() => {});
    }
  }
  return reg.accessToken;
}

/** The checks. Each one is a defect a screenshot would not show. */
const PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const out = {
    vw,
    scrollW: document.documentElement.scrollWidth,
    device: document.documentElement.getAttribute('data-device'),
    escaped: [],
    fabOverBar: false,
    duplicateTitle: false,
    underBar: 0,
  };
  let bar = document.querySelector('.m-appbar');
  // A hidden bar (display:none) has a zero rect but is not a header
  // here; counting content under it would flag every desktop screen.
  if (bar && getComputedStyle(bar).display === 'none') bar = null;
  const barH = bar ? bar.getBoundingClientRect().height : 0;
  out.hasBar = !!bar;

  document.querySelectorAll('#app *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.right > vw + 2) {
      // A child of a deliberately scrollable strip is not an overflow.
      let sc = el.parentElement, scrolls = false;
      while (sc && sc !== document.body) {
        const o = getComputedStyle(sc).overflowX;
        if (o === 'auto' || o === 'scroll') { scrolls = true; break; }
        sc = sc.parentElement;
      }
      if (scrolls) return;
      out.escaped.push({
        cls: (el.className || '').toString().slice(0, 34),
        right: Math.round(r.right),
      });
    }
    // Content hidden under the fixed top bar.
    if (!barH || !r.height || !r.top) return;
    if (r.top < barH - 1 && r.bottom > barH + 2 && r.left >= 0 && r.width > 40) {
      if (!el.closest('.m-appbar') && getComputedStyle(el).position !== 'fixed') out.underBar++;
    }
  });
  out.escaped = out.escaped.slice(0, 3);

  // v2.38.17 — el mismo trato que la barra de arriba: un elemento con
  // display:none tiene rect a cero, y compararlo contra otro da
  // "solapan" o "no solapan" sin decir nada. En escritorio los dos
  // estan ocultos y la comprobacion marcaba las nueve pantallas como
  // rotas por un boton que no existe en pantalla.
  const visible = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? r : null;
  };
  const fab = visible(document.querySelector('.mn-capture-fab'));
  const tab = visible(document.querySelector('.m-tabbar'));
  if (fab && tab) {
    out.fabOverBar = !(fab.right <= tab.left || fab.left >= tab.right ||
                       fab.bottom <= tab.top || fab.top >= tab.bottom);
  }

  // The same screen name in the bar and in the page.
  if (bar) {
    const barTitle = (bar.querySelector('.m-appbar-title')?.textContent || '').trim();
    const dup = [...document.querySelectorAll('.screen-header .h-title, .screen-header h1')]
      .filter((e) => getComputedStyle(e).display !== 'none')
      .map((e) => (e.textContent || '').trim());
    out.duplicateTitle = barTitle && dup.some((d) => d && d.toLowerCase() === barTitle.toLowerCase());
  }
  return out;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const problems = [];
  let cells = 0;

  for (const d of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: d.w, height: d.h },
      deviceScaleFactor: d.dsf,
      isMobile: d.touch,
      hasTouch: d.touch,
      userAgent: d.ua || undefined,
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

    const marks = [];
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
      await page.waitForTimeout(1100);
      const r = await page.evaluate(PROBE);
      cells++;
      const bad = [];
      if (r.scrollW > r.vw + 2) bad.push('desborda ' + r.scrollW + '>' + r.vw);
      if (r.escaped.length) bad.push('fuera: ' + r.escaped.map((e) => e.cls).join(','));
      if (r.fabOverBar) bad.push('FAB sobre la barra');
      if (r.duplicateTitle) bad.push('título duplicado');
      if (r.underBar > 2) bad.push(r.underBar + ' bajo la barra');
      marks.push({ route, bad, device: r.device });
      if (bad.length) problems.push(d.id + ' / ' + route + ' → ' + bad.join('; '));
      if (route === 'notes' || route === 'overview' || route === 'study') {
        await page.screenshot({ path: path.join(OUT, d.id + '-' + route + '.png') });
      }
    }
    const clean = marks.filter((m) => !m.bad.length).length;
    console.log(
      d.id.padEnd(15) +
        (marks[0].device || '?').padEnd(9) +
        clean + '/' + marks.length +
        (clean === marks.length ? '  ✓' : '  ← ' + marks.filter((m) => m.bad.length).map((m) => m.route).join(', ')),
    );
    await ctx.close();
  }

  console.log('\n' + (problems.length ? problems.length + ' problemas:' : 'sin problemas'));
  for (const p of problems) console.log('  ' + p);
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
