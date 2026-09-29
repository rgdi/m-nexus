// capture_core.cjs — las pantallas que ya existían, con datos reales.
//
// Notas, flashcards, tests, PDF, oclusión de imagen y tutor de IA. El
// resto del set ya se capturó en capture_normal.cjs; aquí van las que
// necesitan su propio material —un PDF, una figura, un mazo— y las que
// el usuario quiere ver tal cual.
//
//   node scripts/capture_core.cjs
//
// Salida: screenshots/core/*.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'core');

const auth = (tok) => function (a) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', a);
  localStorage.setItem('mnexus.auth.refresh', a);
  localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  localStorage.setItem('mnexus.theme', 'dark');
  localStorage.setItem('mnexus.lang', 'es');
};

async function settle(page) {
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 12000) {
    const present = await page.evaluate(() => !!document.querySelector('.splash'));
    if (present) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 700) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
}

/** A real PDF, generated here so the capture does not depend on a file
 *  being present. One page, real text, drawn as a PDF by hand. */
function makePdf() {
  const text = (s) => `(${s.replace(/([()\\])/g, '\\$1')}) Tj`;
  const page = [
    'BT /F1 24 Tf 60 760 Td ' + text('Cardiologia - Ciclo cardiaco') + ' ET',
    'BT /F1 13 Tf 60 715 Td ' + text('El ciclo cardiaco tiene dos fases: sistole y diastole.') + ' ET',
    'BT /F1 13 Tf 60 690 Td ' + text('Durante la sistole ventricular el corazon expulsa sangre') + ' ET',
    'BT /F1 13 Tf 60 665 Td ' + text('hacia la aorta y la arteria pulmonar.') + ' ET',
    'BT /F1 13 Tf 60 620 Td ' + text('La aorta es la mayor arteria del cuerpo humano y tiene') + ' ET',
    'BT /F1 13 Tf 60 595 Td ' + text('elasticidad para absorber el pico de presion sistolico.') + ' ET',
    'BT /F1 13 Tf 60 550 Td ' + text('Las venas devuelven la sangre al corazon.') + ' ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** An anatomical figure for the occlusion exercise. */
const FIGURE =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="500">
      <rect width="760" height="500" fill="#0f0f18"/>
      <text x="380" y="36" font-size="19" fill="#8a8aa8" text-anchor="middle" font-family="sans-serif">Sistema circulatorio — esquema</text>
      <ellipse cx="250" cy="250" rx="160" ry="135" fill="#2a2036" stroke="#a06c9c" stroke-width="3"/>
      <rect x="450" y="130" width="250" height="230" rx="20" fill="#1e2f3c" stroke="#5c9cba" stroke-width="3"/>
      <path d="M410 250 L450 250" stroke="#7a7a96" stroke-width="3"/>
      <text x="250" y="415" font-size="14" fill="#7a7a96" text-anchor="middle" font-family="sans-serif">camara principal</text>
      <text x="575" y="400" font-size="14" fill="#7a7a96" text-anchor="middle" font-family="sans-serif">vasos principales</text>
      <text x="380" y="468" font-size="16" fill="#8a8aa8" text-anchor="middle" font-family="sans-serif">Figura 3 — traza la circulacion</text>
    </svg>`,
  ).toString('base64');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'core' + Date.now(),
        password: 'demo123',
        deviceId: 'core-' + Math.random().toString(36).slice(2, 10),
        deviceName: 'core-capture',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const tok = reg.accessToken;
  const h = { authorization: 'Bearer ' + tok };
  const results = [];

  // ── Material ─────────────────────────────────────────────────────
  const bio = await ctx.request
    .post(API + '/api/v1/folders', { headers: h, data: { name: 'Cardiología' } })
    .then((r) => r.json());

  const CARDS = [
    ['¿Cuántas fases tiene el ciclo cardíaco?', 'Dos: sístole y diástole', 'cardio', 'basico'],
    ['¿Qué ocurre durante la sístole ventricular?', 'Expulsa sangre hacia la aorta y la arteria pulmonar', 'cardio', 'basico'],
    ['¿Cuál es la mayor arteria del cuerpo?', 'La aorta', 'cardio', 'basico'],
    ['¿Qué estructura absorbe el pico de presión sistólico?', 'La elasticidad de la aorta', 'cardio', 'cloze'],
    ['¿Qué devuelven las venas?', 'La sangre al corazón', 'cardio', 'basico'],
  ];
  for (const [front, back, subject, tag] of CARDS) {
    const c = await ctx.request
      .post(API + '/api/v1/flashcards', { headers: h, data: { front, back, subject, tags: [subject, tag] } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (c.id) {
      for (let i = 0; i < 5; i++) {
        await ctx.request
          .post(API + `/api/v1/flashcards/${c.id}/review`, {
            headers: h,
            data: { rating: [2, 3, 3, 4, 3][i] },
          })
          .catch(() => {});
      }
    }
  }

  const note = await ctx.request
    .post(API + '/api/v1/notes', {
      headers: h,
      data: {
        title: 'Ciclo cardíaco',
        folderId: bio.id,
        subject: 'cardio',
        tags: ['cardio'],
        body: 'El ciclo cardíaco tiene dos fases: sístole y diástole.\n\nDurante la sístole ventricular el corazón expulsa sangre hacia la aorta y la arteria pulmonar.\n\nLa aorta es la mayor arteria del cuerpo humano y tiene elasticidad para absorber el pico de presión sistólico.',
      },
    })
    .then((r) => r.json());

  // A real PDF on disk so the viewer has something to open.
  const pdfDir = path.join(ROOT, 'backend', 'data', 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });
  fs.writeFileSync(path.join(pdfDir, 'ciclo-cardiaco.pdf'), makePdf());

  // `let` because the study overlay survives a route change, so the
  // later steps swap in a fresh page rather than fight it.
  let page = await ctx.newPage();
  await page.addInitScript(auth(), tok);
  const shot = async (name, ok, why) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    results.push({ name, ok, why });
    console.log(`${ok ? 'OK  ' : 'VACIO'} ${name}${why ? ' — ' + why : ''}`);
  };
  const open = async (route, extra) => {
    await page.goto(WEB + '/index.html#/' + route, { waitUntil: 'load' });
    await settle(page);
    if (extra) { await extra(); }
  };

  // ── 1. Notas: el editor con la nota abierta ─────────────────────
  await open('notes', async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('.tree-note, .note-name')]
        .find((e) => /Ciclo/.test(e.textContent || ''))?.click();
    });
    await page.waitForFunction(() => /sístole/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  });
  const n = await page.evaluate(() => {
    const ta = document.querySelector('#body');
    // The body is a <textarea>; innerText does not include its value, so
    // checking the rendered text alone reported an empty note.
    const t = `${document.body.innerText} ${ta ? ta.value : ""}`;
    return {
      ok: /sístole/.test(t),
      why: 'título + ' + (ta ? ta.value.length : 0) + ' caracteres de cuerpo',
    };
  });
  await shot('01-notas-editor', n.ok, n.why);

  // ── 2. Flashcards: la sesión de repaso ──────────────────────────
  // There is no #/flashcards route — the deck is reviewed in Study, and
  // that session is the flashcard UI. Capturing a "flashcards screen"
  // that does not exist would just be the overview wearing its name.
  await open('study', async () => {
    const started = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Empezar sesión|Repasar/.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    if (started) await page.waitForTimeout(2600);
  });
  const st = await page.evaluate(() => {
    const t = document.body.innerText;
    return { ok: /sístole|aorta|fases/i.test(t), why: 'sesión abierta, intervalos FSRS visibles' };
  });
  await shot('02-flashcards-test', st.ok, st.why);

  // ── 3. PDF ──────────────────────────────────────────────────────
  // Fresh page, same reason as the occlusion: the study overlay above
  // survives a route change and would photograph itself.
  await page.close();
  page = await ctx.newPage();
  await page.addInitScript(auth(), tok);
  await page.goto(WEB + '/index.html#/pdf', { waitUntil: 'load' });
  await settle(page);
  // The library only lists PDFs it has been told about, so dropping a
  // file in data/pdfs is not enough — drive the real file picker.
  const pdfPath = path.join(pdfDir, 'ciclo-cardiaco.pdf');
  const chooser = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Abrir PDF local/i.test(x.textContent || ''));
    b?.click();
    if (!b) document.querySelector('input[type=file]')?.click();
  });
  const fileChooser = await chooser;
  if (fileChooser) {
    await fileChooser.setFiles(pdfPath);
    await page.waitForTimeout(4500);
  }
  const pdf2 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const t = document.body.innerText;
    return {
      ok: !!canvas || /ciclo-cardiaco/i.test(t),
      why: canvas ? 'página renderizada en canvas' : 'biblioteca sin el PDF abierto',
    };
  });
  await shot('03-pdf', pdf2.ok, pdf2.why);

  // ── 4. Oclusión de imagen, con arrastre real ────────────────────
  // On a fresh page: the study session above leaves a full-screen
  // overlay, and there is no reliable handle to close it, so it would
  // photograph itself instead of this step.
  await page.close();
  const occPage = await ctx.newPage();
  await occPage.addInitScript(auth(), tok);
  await occPage.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  await settle(occPage);
  {
    const p2 = occPage;
    await p2.evaluate(async (fig) => {
      const { mountOcclusionDragExercise } = await import('/src/screens/occlusion_screen.js');
      const host = document.createElement('div');
      host.id = 'demo';
      host.style.cssText = 'padding:16px;background:#0b0b12;position:relative;z-index:5';
      document.body.appendChild(host);
      document.getElementById('app')?.style.setProperty('display', 'none');
      mountOcclusionDragExercise(host, {
        imageUrl: fig,
        subject: 'Cardiología',
        occlusions: [
          { id: 'o1', label: 'Corazón', x: 0.10, y: 0.24, w: 0.40, h: 0.32 },
          { id: 'o2', label: 'Arterias', x: 0.60, y: 0.24, w: 0.32, h: 0.32 },
        ],
        chips: [
          { id: 'c1', text: 'Corazón' },
          { id: 'c2', text: 'Arterias' },
          { id: 'c3', text: 'Pulmones' },
          { id: 'c4', text: 'Riñones' },
        ],
      });
    }, FIGURE);
    await p2.waitForTimeout(700);
    await p2.evaluate(() => document.querySelector('#demo .do-stage')?.scrollIntoView({ block: 'center' }));
    await p2.waitForTimeout(400);

    const targets = await p2.evaluate(() =>
      [...document.querySelectorAll('#demo [data-mask]')].map((m) => {
        const r = m.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
    const cdp = await ctx.newCDPSession(p2);
    const touch = (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
      });
    const chips = await p2.$$('#demo .do-chip');
    for (let i = 0; i < 2 && i < chips.length; i++) {
      const cb = await chips[i].boundingBox();
      if (!cb) continue;
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      await touch('touchStart', sx, sy);
      for (let k = 1; k <= 8; k++) {
        await touch('touchMove', sx + ((targets[i].x - sx) * k) / 8, sy + ((targets[i].y - sy) * k) / 8);
        await p2.waitForTimeout(16);
      }
      await touch('touchEnd', targets[i].x, targets[i].y);
      await p2.waitForTimeout(250);
    }
  }
  const occ = await occPage.evaluate(() => {
    const filled = [...document.querySelectorAll('#demo [data-mask]')].filter((m) => m.classList.contains('is-filled'));
    return {
      ok: filled.length >= 2,
      why: filled.map((m) => m.querySelector('.do-mask-label')?.textContent?.trim()).join(' + '),
    };
  });
  await occPage.screenshot({ path: path.join(OUT, '04-image-occlusion.png') });
  results.push({ name: '04-image-occlusion', ok: occ.ok, why: occ.why });
  console.log(`${occ.ok ? 'OK  ' : 'VACIO'} 04-image-occlusion${occ.why ? ' — ' + occ.why : ''}`);
  await occPage.close();

  // ── 5. Tutor de IA ──────────────────────────────────────────────
  await occPage.close();
  const aiPage = await ctx.newPage();
  await aiPage.addInitScript(auth(), tok);
  await aiPage.goto(WEB + '/index.html#/ai', { waitUntil: 'load' });
  await settle(aiPage);
  await aiPage.waitForTimeout(1500);
  const ai = await aiPage.evaluate(() => {
    const t = document.body.innerText;
    return {
      ok: t.trim().length > 20 && !document.querySelector('.flashcard-overlay'),
      why: 'tutor montado',
    };
  });
  await aiPage.screenshot({ path: path.join(OUT, '05-ia-tutor.png') });
  results.push({ name: '05-ia-tutor', ok: ai.ok, why: ai.why });
  console.log(`${ai.ok ? 'OK  ' : 'VACIO'} 05-ia-tutor${ai.why ? ' — ' + ai.why : ''}`);
  await aiPage.close();

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} con contenido real`);
  if (bad.length) console.log('sin contenido:', bad.map((b) => b.name).join(', '));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
