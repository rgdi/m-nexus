// capture_evidence.cjs — las capturas que pidió el usuario, una a una.
//
// v2.38.5
//
// Captura pantallas donde hay que *usar* algo, no solo mirarlo: el
// editor de notas a media escritura, el companion con una respuesta
// real, el RAG con citas, el PDF con resaltado en dos páginas a la vez,
// y un documento enlazado a una parte concreta de una nota.
//
// Y simula la actividad de oclusión: una imagen con una máscara puesta,
// y la misma a mitad de arrastre con el hueco y el objetivo hot.
//
//   node scripts/capture_evidence.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'evidence');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

async function seed(ctx) {
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'ev' + Date.now(),
        password: 'demo123',
        deviceId: 'ev-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'ev',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const h = { authorization: 'Bearer ' + reg.accessToken };
  const folder = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Genética' } })
    .then((r) => r.json());
  const note = await ctx.request
    .post(API + '/api/v1/notes', {
      headers: h,
      data: {
        title: 'Fibrosis quística',
        folderId: folder.id,
        body:
          'La fibrosis quística se debe a una mutación en el gen CFTR, en el cromosoma 7.\n\n' +
          'La proteína reguladora de conductancia de cloruros defectuosa dificulta el transporte de sal y agua.\n\n' +
          'El moco se espesa. Afecta sobre todo a pulmones, páncreas e intestino.',
      },
    })
    .then((r) => r.json());

  // Un documento enlazado a una parte concreta de la nota.
  await ctx.request
    .post(API + '/api/v1/notes/' + note.id + '/links', {
      headers: h,
      data: {
        kind: 'document',
        title: 'Guía 2024 — capítulo 3',
        anchor: 'El moco se espesa. Afecta sobre todo a pulmones, páncreas e intestino.',
        url: 'assets/occlusion/ear-es.png',
        page: 12,
      },
    })
    .catch(() => {});

  // Controles para la excavación de conocimiento previo.
  await ctx.request
    .post(API + '/api/v1/_seed/diag', {
      headers: h,
      data: {
        sameTopic: [
          { cardId: 'c1', front: 'La fibrosis quística', back: 'Mucoviscidosis: mutación en CFTR, cronosoma 7' },
        ],
        controls: [
          { id: 'k1', question: '¿Qué cromosoma porta el gen CFTR?', options: ['7', '11', '17', 'X'] },
          { id: 'k2', question: '¿Qué es el páncreas en la CF?', options: ['Afectado', 'Intacto', 'Solo IMPORTANTE'] },
          { id: 'k3', question: '¿Qué se transporta mal?', options: ['Cloruro y agua', 'Glucosa', 'Hierro', 'Oxígeno'] },
        ],
      },
    })
    .catch(() => {});

  return { token: reg.accessToken, noteId: note.id, folderId: folder.id };
}

async function settled(page, ms = 1200) {
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 14000) {
    const splash = await page.evaluate(() => !!document.querySelector('.splash'));
    if (splash) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 750) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(ms);
}

const DESKTOP = process.argv.includes('--desktop');
const VIEW = DESKTOP ? { width: 1440, height: 900 } : { width: 414, height: 896 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: VIEW,
    isMobile: !DESKTOP,
    hasTouch: !DESKTOP,
    deviceScaleFactor: 2,
    locale: 'es-ES',
  });
  const info = await seed(ctx);
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
    info.token,
  );

  const suffix = DESKTOP ? '-pc' : '';
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + suffix + '.png') });
  const go = async (r, wait) => {
    await page.goto(WEB + '/index.html#/' + r, { waitUntil: 'load' });
    await settled(page, wait);
  };

  // --- 1. Editor de notas, a media escritura -----------------------------
  await go('notes');
  // v2.38.6 — la fila real es .tree-note. El selector anterior
  // ([data-note-id], .note-row) no existe en el DOM: por eso la
  // captura salia con la lista de carpetas y sin editor.
  await page.evaluate(() => document.querySelector('.tree-note')?.click());
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const ta =
      document.querySelector('.note-editor textarea, .editor textarea') ||
      document.querySelector('textarea');
    if (!ta) return;
    ta.focus();
    ta.value = (ta.value || '') + '\n\n[leyendo] El páncreas es lo que suele fallar antes.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1400);
  await shot('01-editor-notas');

  // --- 2. El documento enlazado a esa parte ------------------------------
  await go('notes');
  await page.evaluate(() => document.querySelector('.tree-note')?.click());
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const link = document.querySelector('.note-link, [data-link], a[href*="assets/occlusion"]');
    if (link) link.click();
  });
  await page.waitForTimeout(1400);
  await shot('02-documento-enlazado');

  // --- 3. Companion IA con respuesta real --------------------------------
  await go('overview');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mnexus:open-ai')));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const box = document.querySelector('.ai-input, textarea, [contenteditable="true"]');
    if (box) {
      box.focus();
      box.value = '¿Por qué se espesa el moco en la fibrosis quística?';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const f = box.closest('form');
      if (f) f.requestSubmit();
      else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });
  await page.waitForTimeout(9000);
  await shot('03-ia-chat');

  // --- 4. RAG con citas ---------------------------------------------------
  await go('rag');
  // v2.38.6 — el campo real es textarea.rag-input y el boton .m-btn.
  // La captura anterior no llego a preguntar nada.
  await page.evaluate(() => {
    const box = document.querySelector('textarea.rag-input');
    if (!box) return;
    box.focus();
    box.value = '¿Qué cromosoma tiene el gen CFTR?';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.m-btn')?.click());
  await page.waitForTimeout(13000);
  await shot('04-rag-citas');

  // --- 5. Oclusión: la biblioteca ---------------------------------------
  await go('occlusion');
  await shot('05-occlusion-biblioteca');

  // --- 6. Oclusión: el editor con una máscara puesta --------------------
  await page.evaluate(() => {
    const item = document.querySelector('.occlusion-library-item');
    if (item) item.click();
  });
  await page.waitForTimeout(3500);
  await shot('06-occlusion-editor');

  // --- 7. Oclusión: a mitad del arrastre --------------------------------
  const canvas = await page.$('.occlusion-stage, .occl-stage, [data-occl-canvas]');
  if (canvas) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.46, { steps: 12 });
      await page.waitForTimeout(400);
      await shot('07-occlusion-arrastre');
      await page.mouse.up();
    }
  }

  // --- 8. PDF con resaltado ---------------------------------------------
  await go('pdf');
  await shot('08-pdf');

  // --- 9. La excavación de conocimiento previo -------------------------
  await go('probe');
  await shot('09-probe-L0');
  await page.evaluate(() => {
    const b = document.querySelector('#diag-dunno, .diag-option');
    if (b) b.click();
  });
  await page.waitForTimeout(2200);
  await shot('10-probe-L1');

  console.log('capturas en ' + OUT);
  await browser.close();
})();
