// audit_text.cjs — dos cosas que no se ven en una captura bonita.
//
// v2.38.24.
//
//   1. Los textos en ingles que quedan. Se recorren las pantallas
//    y se saca el texto VISIBLE, que es el que se
//      lee, no las claves de i18n.
//
//   2. La densidad a 360 px. El diseno nuevo tiene mas aire, y con
//      mas aire y el mismo contenido, en una pantalla estrecha algo
//      tiene que salir. Lo que se mide es cuanto.
//
//   node scripts/audit_text.cjs
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.WEB || 'http://localhost:8080';
const API = process.env.API || 'http://localhost:4000';
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const RUTAS = [
  'overview', 'notes', 'study', 'progress', 'calendar', 'subjects',
  'capture', 'rag', 'generate', 'probe', 'mood', 'occlusion',
  'journal', 'pdf', 'todos', 'cluster', 'ai', 'diagnostic', 'settings', 'v232',
];

// Palabras inglesas que NO son marcas, nombres propios ni codigo.
// "Study" fuera, "Hoy" dentro.
const SOSPECHOSAS = [
  'Today', 'Yesterday', 'No events', 'Schedule', 'Subjects', 'Settings',
  'Overview', 'Dashboard', 'Quick', 'Recent', 'Search', 'Save', 'Delete',
  'Cancel', 'Create', 'Update', 'Loading', 'Error', 'Retry', 'Refresh',
  'Continue', 'Start', 'Stop', 'Reset', 'Export', 'Import', 'Print',
  'Add', 'Edit', 'Remove', 'Clear', 'Apply', 'Filter', 'Sort', 'Next',
  'Previous', 'Back', 'Close', 'Open', 'Submit', 'Required', 'Optional',
  'Nothing', 'Empty', 'Total', 'Average', 'Grade', 'Streak', 'Cards',
  'Review', 'Reviews', 'Due', 'Notes', 'Tasks', 'Goals', 'Study',
  'Not enough', 'Not set', 'Not found', 'No data', 'All', 'None',
  'Minutes', 'Hours', 'Days', 'Week', 'Month', 'Score', 'Progress',
  'Journal', 'Cluster', 'Diagnostic', 'Settings', 'Generate', 'Mood',
  'Capture', 'Calendar', 'Welcome', 'Sign in', 'Log out', 'Account',
  'deadline', 'across', 'minutes today', 'cards due', 'quick notes',
  'intelligent overview', 'new flashcard', 'no deadline',
  'pending approval', 'cross verify', 'exam', 'views',
];

(async () => {
  const br = await chromium.launch({
    executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext();
  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: {
      username: 'aud' + Date.now(), password: 'demo123',
      deviceId: 'aud-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'audit', platform: 'web',
    },
  }).then((r) => r.json());
  const tok = reg.accessToken;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

  const carpeta = await ctx.request.post(API + '/api/v1/folders', {
    headers: h, data: { name: 'Cardiología' },
  }).then((r) => r.json());
  const n = await ctx.request.post(API + '/api/v1/notes', {
    headers: h,
    data: { title: 'Ciclo cardíaco', body: 'Sístole y diástole.\n\n[[Presión]]', folderId: carpeta.id },
  }).then((r) => r.json());
  for (let i = 0; i < 8; i++) {
    await ctx.request.post(API + '/api/v1/flashcards', {
      headers: h, data: { noteId: n.id, front: `Pregunta ${i}`, back: 'Respuesta' },
    }).catch(() => {});
  }
  for (const s of ['cardio', 'anatomía']) {
    await ctx.request.post(API + '/api/v1/subjects', { headers: h, data: { name: s } }).catch(() => {});
  }
  for (const t of ['Repasar el ciclo', 'Comprar atlas']) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: h, data: { title: t, done: false } }).catch(() => {});
  }

  /* ── 1. Los textos que no estan traducidos ─────────────────── */
  const ingles = new Map();
  for (const r of RUTAS) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.addInitScript((c) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', c.tok);
      localStorage.setItem('mnexus.auth.refresh', c.tok);
      localStorage.setItem('mnexus.backend.url', c.api);
      localStorage.setItem('mnexus.theme', 'light');
      localStorage.setItem('mnexus.lang', 'es');
    }, { tok, api: API });
    try {
      await p.goto(`${WEB}/index.html#/${r}`, { waitUntil: 'load', timeout: 20000 });
    } catch { await p.close(); continue; }
    await p.waitForTimeout(1900);
    if (r === 'notes') {
      await p.evaluate(() => {
        [...document.querySelectorAll('.doc-card, .note-name, [data-note-id]')][0]?.click();
      });
      await p.waitForTimeout(1300);
    }
    const textos = await p.evaluate(() => {
      // Solo lo visible: un `hidden` o un `display:none` no se lee.
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const t = (n.nodeValue || '').trim();
        if (!t || t.length < 2 || t.length > 60) continue;
        const el = n.parentElement;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        if (el.closest('script, style, [aria-hidden="true"]')) continue;
        out.push({ t, donde: r.top < 90 ? 'barra' : 'cuerpo' });
      }
      return out;
    });
    for (const { t } of textos) {
      for (const s of SOSPECHOSAS) {
        if (new RegExp('(^|[^A-Za-z])' + s + '([^A-Za-z]|$)', 'i').test(t)) {
          if (!ingles.has(t)) ingles.set(t, r);
          break;
        }
      }
    }
    await p.close();
  }

  /* ── 2. La densidad a 360 ─────────────────────────────────── */
  const densidad = [];
  for (const r of ['overview', 'notes', 'study', 'progress', 'calendar', 'capture', 'settings']) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 360, height: 740 });
    await p.addInitScript((c) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      sessionStorage.setItem('mnexus.auth.access', c.tok);
      localStorage.setItem('mnexus.auth.refresh', c.tok);
      localStorage.setItem('mnexus.backend.url', c.api);
      localStorage.setItem('mnexus.theme', 'light');
    }, { tok, api: API });
    try {
      await p.goto(`${WEB}/index.html#/${r}`, { waitUntil: 'load', timeout: 20000 });
    } catch { await p.close(); continue; }
    await p.waitForTimeout(1900);
    if (r === 'notes') {
      await p.evaluate(() => {
        [...document.querySelectorAll('.doc-card, .note-name, [data-note-id]')][0]?.click();
      });
      await p.waitForTimeout(1200);
    }
    const d = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const scrollers = document.querySelectorAll("#app *");
      let hScroll = 0, scrollables = 0;
      for (const el of scrollers) {
        if (el.scrollWidth > el.clientWidth + 2) {
          scrollables++;
          if (el.getBoundingClientRect().width > vw * 0.8) hScroll++;
        }
      }
      const objetivo = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.top < 900;
        });
      const pequenos = objetivo.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.height < 44 || r.width < 44;
      });
      const doc = document.documentElement;
      return {
        vw,
        altoTotal: doc.scrollHeight,
        pantallas: +(doc.scrollHeight / vh()).toFixed(1),
        scrollH: hScroll,
        objetivosPequenos: pequenos.length,
        deObjetivos: objetivo.length,
      };
      function vh() { return window.innerHeight; }
    });
    densidad.push({ ruta: r, ...d });
    await p.close();
  }

  await br.close();

  console.log(`\n=== 1. Texto visible en ingles (${ingles.size} distintos) ===`);
  const porPantalla = [...ingles.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  let actual = '';
  for (const [t, r] of porPantalla) {
    if (r !== actual) { actual = r; console.log(`\n  [${r}]`); }
    console.log(`    "${t}"`);
  }

  console.log(`\n=== 2. Densidad a 360 px ===`);
  console.log('  ruta        pantallas  scroll-h  objetivos <44px');
  for (const d of densidad) {
    console.log(`  ${d.ruta.padEnd(11)} ${String(d.pantallas).padStart(6)}` +
      `${String(d.scrollH).padStart(11)}${String(d.objetivosPequenos + '/' + d.deObjetivos).padStart(18)}`);
  }
})();
