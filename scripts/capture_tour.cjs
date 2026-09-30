// capture_tour.cjs — recorre cada pantalla y cada función, y saca una
// captura por cada una.
//
// El audit anterior contaba problemas en abstracto. Esto abre las
// pantallas una a una, espera a que el contenido real este en el DOM,
// dispara la funcion (abrir el companion, generar un resumen, entrar
// en occlusion...) y guarda una imagen con su nombre.
//
//   node scripts/capture_tour.cjs [--phone] [--desktop]
//
// Requiere backend en :4000 y frontend en :8080.

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'tour');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const MOBILE = !process.argv.includes('--desktop');
const SIZE = MOBILE
  ? { width: 414, height: 896 }
  : { width: 1440, height: 900 };

// Cada parada: la ruta, y una funcion opcional que se dispara una vez
// que la pantalla esta lista.
const TOUR = [
  { name: '01-overview', route: 'overview' },
  { name: '02-notes', route: 'notes' },
  { name: '03-calendar', route: 'calendar' },
  { name: '04-capture', route: 'capture' },
  { name: '05-rag', route: 'rag' },
  { name: '06-generate', route: 'generate' },
  {
    name: '07-ai-companion',
    route: 'overview',
    async act(page) {
      // El FAB abre captura, no el companion: este se abre con su
      // propio evento (el mismo que usa Ctrl+K), no con un click.
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('mnexus:open-ai')),
      );
      await page.waitForTimeout(1400);
    },
  },
  { name: '08-study', route: 'study' },
  { name: '09-progress', route: 'progress' },
  { name: '10-mood', route: 'mood' },
  { name: '11-journal', route: 'journal' },
  { name: '12-occlusion', route: 'occlusion' },
  { name: '13-todos', route: 'todos' },
  { name: '14-settings', route: 'settings' },
];

async function seed(ctx) {
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'tour' + Date.now(),
        password: 'demo123',
        deviceId: 'tour-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'tour',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const h = { authorization: 'Bearer ' + reg.accessToken };
  const folder = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Genética' } })
    .then((r) => r.json());
  const folder2 = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Fisiología' } })
    .then((r) => r.json());

  const NOTES = [
    ['Fibrosis quística', 'La fibrosis quística se debe a una mutación en el gen CFTR. La proteína reguladora de conductancia de cloruros defective dificulta el transporte de sal y agua, espesando el moco. Afecta sobre todo a pulmones, páncreas e intestino.'],
    ['Herencia mendeliana', 'Cada progenitor transmite dos alelos. El fenotipo recesivo aparece en homocigosis, la recesiva, heterocigosis.'],
    ['Ciclo cardíaco', 'Sístole y diástole. La sístole auricular llena los ventrículos y la ventricular los expulsa. 60-100 latidos por minuto en reposo.'],
  ];
  for (const [title, body] of NOTES) {
    await ctx.request
      .post(API + '/api/v1/notes', { headers: h, data: { title, body, folderId: folder.id } })
      .catch(() => {});
  }
  await ctx.request
    .post(API + '/api/v1/notes', {
      headers: h,
      data: { title: 'Secreción de insulina', body: 'Las células beta del islote de Langerhans liberan insulina en respuesta a la glucosa.', folderId: folder2.id },
    })
    .catch(() => {});

  // Tarjetas con vencimientos repartidos, para que Progreso y Estudiar
  // tengan algo real que enseñar.
  const CARDS = [
    ['¿Qué mutación causa la fibrosis quística?', 'CFTR, cromosoma 7'],
    ['¿Qué transporta defectuoso tiene la CF?', 'Cloruro y agua'],
    ['¿Quéreptasas el moco?', 'La disolución de sales, la capa de NaCl'],
    ['¿En qué cromosoma está el gen CFTR?', '7'],
    ['¿A qué sistema pertenece el páncreas?', 'Digestivo y endocrino'],
  ];
  const deck = await ctx.request
    .post(API + '/api/v1/flashcards', { headers: h, data: { name: 'Genética', folderId: folder.id } })
    .then((r) => r.json())
    .catch(() => ({}));
  if (deck.id) {
    for (const [front, back] of CARDS) {
      await ctx.request
        .post(API + '/api/v1/flashcards/cards', { headers: h, data: { deckId: deck.id, front, back } })
        .catch(() => {});
    }
  }

  for (const [text, kind] of [
    ['comprar leche el viernes a las 18:00', 'shopping'],
    ['estudiar el ciclo cardíaco mañana a las 20:00', 'task'],
  ]) {
    await ctx.request
      .post(API + '/api/v1/tasks', { headers: h, data: { text, kind, done: false } })
      .catch(() => {});
  }

  // Un año de ánimo, para que el heatmap y las medias tengan forma.
  for (let d = 330; d >= 0; d -= 1) {
    if (d % 3 === 1) continue; // algunos dias sin registro, como en la vida real
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const j = await ctx.request
      .post(API + '/api/v1/journal/today', { headers: h, data: { date: day } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (j.id) {
      await ctx.request
        .post(API + '/api/v1/journal/' + j.id + '/mood', {
          headers: h,
          data: { score: 2 + ((d * 7) % 3) },
        })
        .catch(() => {});
    }
  }
  return reg.accessToken;
}

async function settled(page) {
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 14000) {
    const splash = await page.evaluate(() => !!document.querySelector('.splash'));
    if (splash) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 750) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1300);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: SIZE,
    isMobile: MOBILE,
    hasTouch: MOBILE,
    deviceScaleFactor: 2,
    locale: 'es-ES',
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

  const suffix = MOBILE ? '' : '-desktop';
  for (const stop of TOUR) {
    await page.goto(WEB + '/index.html#/' + stop.route, { waitUntil: 'load' });
    await settled(page);
    if (stop.act) await stop.act(page);
    const file = path.join(OUT, stop.name + suffix + '.png');
    await page.screenshot({ path: file, fullPage: !MOBILE });
    // Que la captura diga si de verdad tenia contenido: una pantalla
    // vacia renderizada igual sale bonita.
    const n = await page.evaluate(
      () => document.querySelectorAll('#app .card, #app .note-card, #app .m-card, #app [data-testid]').length,
    );
    console.log(stop.name + suffix + '  bloques=' + n);
  }
  await browser.close();
  console.log('\n' + OUT);
})();
