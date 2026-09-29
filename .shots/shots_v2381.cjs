// shots_v2381.cjs — capturas de las pantallas nuevas de v2.38.1.
//
// Una captura de una pantalla vacía no demuestra nada: "mood" sin
// registros muestra tres guiones, y un generador sin notas no genera.
// Este script siembra material real por HTTP y luego conduce la interfaz
// como lo haría una persona, comprobando en el DOM que hay contenido
// antes de capturar.
//
//   node .shots/shots_v2381.cjs
//
// Salida: screenshots/v2381/*.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = '/workspace/m-nexus';
const WEB = 'http://localhost:8080';
const API = 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'v2381');

const FIGURE =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="460">
      <rect width="720" height="460" fill="#101018"/>
      <text x="360" y="34" font-size="20" fill="#8a8aa8" text-anchor="middle" font-family="sans-serif">Ciclo cardiaco — diagrama</text>
      <ellipse cx="250" cy="230" rx="150" ry="125" fill="#2a2a44" stroke="#6c6c9c" stroke-width="3"/>
      <text x="250" y="378" font-size="15" fill="#7a7a96" text-anchor="middle" font-family="sans-serif">sístole y diástole</text>
      <rect x="430" y="120" width="230" height="200" rx="18" fill="#22303f" stroke="#5c8ca0" stroke-width="3"/>
      <text x="545" y="350" font-size="15" fill="#7a7a96" text-anchor="middle" font-family="sans-serif">aorta y pulmonar</text>
      <text x="360" y="420" font-size="17" fill="#8a8aa8" text-anchor="middle" font-family="sans-serif">Figura 2 — circulación</text>
    </svg>`,
  ).toString('base64');

async function settle(page) {
  // The splash covers the viewport and swallows pointer events for the
  // first second and a half, and it appears only after the backend
  // probe resolves — so a single "is it gone" check passes too early.
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 12000) {
    const present = await page.evaluate(() => !!document.querySelector('.splash'));
    if (present) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 700) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
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
        username: 'shots' + Date.now(),
        password: 'demo123',
        deviceId: 'shots-' + Math.random().toString(36).slice(2, 10),
        deviceName: 'v2381-shots',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const tok = reg.accessToken;
  const auth = { authorization: 'Bearer ' + tok };
  const results = [];

  const page = await ctx.newPage();
  await page.addInitScript(
    function (a) {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
    },
    tok,
  );

  // ── Material real ────────────────────────────────────────────────
  const bio = await ctx.request
    .post(API + '/api/v1/folders', { headers: auth, data: { name: 'Genética' } })
    .then((r) => r.json());
  const histo = await ctx.request
    .post(API + '/api/v1/folders', { headers: auth, data: { name: 'Cardiología' } })
    .then((r) => r.json());
  const notes = [
    ['Fibrosis quística', 'gen', 'La fibrosis quística es una enfermedad autosómica recesiva causada por una mutación en el gen CFTR.\n\nEl tratamiento incluye mucolíticos, fisioterapia respiratoria y una dieta rica en fósforo.'],
    ['Herencia mendeliana', 'gen', 'La herencia mendeliana sigue las leyes de Mendel: segregación y distribución independiente.\n\nLa consanguinidad aumenta la probabilidad de enfermedades autosómicas recesivas.'],
    ['Cromosomas', 'gen', 'Los cromosomas se emparejan por tamaño y forma; el cromosoma 7 porta el gen CFTR.\n\nLas mutaciones puntuales incluyen sustituciones, inserciones y deleciones.'],
    ['Ciclo cardíaco', 'histo', 'El ciclo cardíaco tiene dos fases: sístole y diástole.\n\nLa sístole ventricular expulsa sangre hacia la aorta y la arteria pulmonar.'],
    ['Arterias y venas', 'histo', 'Las arterias llevan sangre desde el corazón y las venas la devuelven.\n\nLa aorta es la mayor arteria del cuerpo humano.'],
  ];
  for (const [title, which, body] of notes) {
    await ctx.request.post(API + '/api/v1/notes', {
      headers: auth,
      data: { title, body, folderId: which === 'gen' ? bio.id : histo.id, subject: which, tags: [which] },
    });
  }
  for (const [text, kind] of [
    ['comprar leche el viernes a las 18:00 urgente', 'shopping'],
    ['estudiar el ciclo cardiaco mañana a las 20:00', 'task'],
    ['beber 2 litros de agua todos los días', 'habit'],
  ]) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: auth, data: { text, kind, done: false } });
  }
  // 12 días de ánimo con valores variados
  for (let d = 11; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const j = await ctx.request
      .post(API + '/api/v1/journal/today', { headers: auth, data: { date: day } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (j.id) {
      await ctx.request.post(API + `/api/v1/journal/${j.id}/mood`, {
        headers: auth,
        data: { score: [3, 4, 2, 4, 5, 3, 4, 4, 2, 3, 4, 5][11 - d] },
      });
    }
  }
  // Una nota ya editada, para que el editor no salga en blanco
  const first = await ctx.request
    .get(API + '/api/v1/notes', { headers: auth })
    .then((r) => r.json())
    .catch(() => ({ notes: [] }));
  if (first.notes && first.notes[0]) {
    await ctx.request.patch(API + `/api/v1/notes/${first.notes[0].id}`, {
      headers: auth,
      data: { body: first.notes[0].body },
    });
  }

  const go = async (route, name, check) => {
    await page.evaluate(() => document.getElementById('app')?.style.removeProperty('display')).catch(() => {});
    await page.goto(WEB + '/index.html#/' + route, { waitUntil: 'load' });
    await settle(page);
    let ok = true;
    let why = '';
    const visible = await page.evaluate(() => {
      const el = document.querySelector('.m-screen') || document.getElementById('app');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    });
    if (check && !visible) {
      results.push({ name, ok: false, why: 'la pantalla no se ve (¿app oculta?)' });
      console.log(`VACIO ${name} — la pantalla no se ve`);
      return;
    }
    if (check) {
      const r = await page.evaluate(check);
      ok = !!r.ok;
      why = r.why || '';
    }
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    results.push({ name, ok, why });
    console.log(`${ok ? 'OK  ' : 'VACIO'} ${name}${why ? ' — ' + why : ''}`);
  };

  // ── 1. Animo, con datos ──────────────────────────────────────────
  await go('mood', '01-mood', () => {
    const nums = [...document.querySelectorAll('.m-stat-num')].map((e) => e.textContent.trim());
    return { ok: nums.some((n) => n !== '—' && n !== '0'), why: 'racha/media: ' + nums.join(' / ') };
  });

  // ── 2. Generador: el formulario ─────────────────────────────────
  await go('generate', '02-generar-form', () => ({
    ok: document.querySelectorAll('select, .gen-kinds *').length > 3,
    why: 'carpetas y formatos cargados',
  }));

  // ── 3. Generador: con resultado real ────────────────────────────
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Resumen/.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Generar/.test(b.textContent || '') && !b.disabled)?.click();
  });
  await page.waitForTimeout(4500);
  await page.evaluate(() => document.querySelector('.gen-result')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  const genOk = await page.evaluate(() => {
    const t = document.querySelector('.gen-result')?.innerText || '';
    return { ok: /pasajes|Generado/.test(t), why: t.split('\n').filter(Boolean).slice(0, 2).join(' · ') };
  });
  await page.screenshot({ path: path.join(OUT, '03-generar-resultado.png') });
  results.push({ name: '03-generar-resultado', ok: genOk.ok, why: genOk.why });
  console.log(`${genOk.ok ? 'OK  ' : 'VACIO'} 03-generar-resultado — ${genOk.why}`);

  // ── 4. Captura con voz ───────────────────────────────────────────
  await page.goto(WEB + '/index.html#/capture', { waitUntil: 'load' });
  await settle(page);
  // The mic only appears where the browser can transcribe. Stub the API
  // so the control is visible — otherwise the capture would prove
  // nothing on a machine without it.
  await page.addInitScript(() => {
    window.SpeechRecognition = function () {
      return {
        continuous: true,
        interimResults: true,
        lang: 'es-ES',
        start() { this.onstart?.({}); },
        stop() { this.onend?.({}); },
        abort() { this.onend?.({}); },
      };
    };
    window.webkitSpeechRecognition = window.SpeechRecognition;
  });
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      ta.value = 'revisar el ciclo cardiaco el jueves a las 19:00 urgente';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(1200);
  const capOk = await page.evaluate(() => {
    const t = document.body.innerText;
    return { ok: /micrófono|🎤|dictar/i.test(t) || !!document.querySelector('[data-voice], .cap-mic'),
             why: t.split('\n').filter(Boolean).slice(0, 2).join(' · ') };
  });
  await page.screenshot({ path: path.join(OUT, '04-captura-voz.png') });
  results.push({ name: '04-captura-voz', ok: capOk.ok, why: capOk.why });
  console.log(`${capOk.ok ? 'OK  ' : 'AVISO'} 04-captura-voz — ${capOk.why}`);

  // ── 5. Arrastre sobre la imagen ──────────────────────────────────
  await page.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  await settle(page);
  await page.evaluate(async (fig) => {
    const { mountOcclusionDragExercise } = await import('/src/screens/occlusion_screen.js');
    const h = document.createElement('div');
    h.id = 'demo';
    h.style.cssText = 'padding:16px;background:#0b0b12;position:relative;z-index:5';
    document.getElementById('app')?.style.setProperty('display', 'none');
    document.body.appendChild(h);
    mountOcclusionDragExercise(h, {
      imageUrl: fig,
      subject: 'Cardiología',
      occlusions: [
        { id: 'o1', label: 'Corazón', x: 0.14, y: 0.24, w: 0.36, h: 0.30 },
        { id: 'o2', label: 'Arterias', x: 0.60, y: 0.24, w: 0.32, h: 0.30 },
      ],
      chips: [
        { id: 'c1', text: 'Corazón' },
        { id: 'c2', text: 'Arterias' },
        { id: 'c3', text: 'Pulmones' },
        { id: 'd1', text: 'Riñones' },
      ],
    });
  }, FIGURE);
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('#demo .do-stage')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);

  const targets = await page.evaluate(() =>
    [...document.querySelectorAll('#demo [data-mask]')].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
    });
  const chips = await page.$$('#demo .do-chip');
  for (let i = 0; i < 2 && i < chips.length; i++) {
    const cb = await chips[i].boundingBox();
    if (!cb) continue;
    const sx = cb.x + cb.width / 2;
    const sy = cb.y + cb.height / 2;
    await touch('touchStart', sx, sy);
    for (let s = 1; s <= 8; s++) {
      await touch('touchMove', sx + ((targets[i].x - sx) * s) / 8, sy + ((targets[i].y - sy) * s) / 8);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', targets[i].x, targets[i].y);
    await page.waitForTimeout(250);
  }
  const dragOk = await page.evaluate(() => {
    const filled = [...document.querySelectorAll('#demo [data-mask]')].filter((m) => m.classList.contains('is-filled'));
    return { ok: filled.length >= 2, why: filled.map((m) => m.querySelector('.do-mask-label')?.textContent?.trim()).join(' + ') };
  });
  await page.screenshot({ path: path.join(OUT, '05-arrastre-imagen.png') });
  results.push({ name: '05-arrastre-imagen', ok: dragOk.ok, why: dragOk.why });
  console.log(`${dragOk.ok ? 'OK  ' : 'VACIO'} 05-arrastre-imagen — ${dragOk.why}`);

  // ── 5b. Mapa mental: determinista, sin modelo ───────────────────
  // Restore the app: the drag demo hid it to sit on a clean page, and
  // leaving it hidden made this capture photograph the previous step.
  await page.evaluate(() => {
    document.getElementById('demo')?.remove();
    document.getElementById('app')?.style.removeProperty('display');
  });
  await page.goto(WEB + '/index.html#/generate', { waitUntil: 'load' });
  await settle(page);
  // Pick it the way a person does. Before v2.38.1-fix this was cosmetic:
  // the repaint reset the <select> and the request carried folderId: null.
  const gi = await page.evaluate(() =>
    [...document.querySelectorAll('select option')].findIndex((o) => /Genética/.test(o.textContent)));
  await page.selectOption('select', { index: gi });
  await page.waitForTimeout(400);
  // Touching a format repaints; the choice has to survive it.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Resumen/.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(300);
  const stillThere = await page.evaluate(() => document.querySelector('select')?.value || '');
  console.log(`     carpeta tras repintar: ${stillThere ? 'conservada' : 'PERDIDA'}`);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Mapa mental/.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Generar/.test(b.textContent || '') && !b.disabled)?.click();
  });
  await page.waitForTimeout(3000);
  const mmOk = await page.evaluate(() => {
    const t = document.querySelector('.gen-result')?.innerText || '';
    return { ok: /CFTR|mendeliana|cromosoma|Mendel/i.test(t) && !/mock AI/i.test(t),
             why: t.split('\n').filter(Boolean).slice(0, 3).join(' · ') };
  });
  await page.evaluate(() => document.querySelector('.gen-result')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-mapa-mental.png') });
  results.push({ name: '06-mapa-mental', ok: mmOk.ok, why: mmOk.why });
  console.log(`${mmOk.ok ? 'OK  ' : 'VACIO'} 06-mapa-mental — ${mmOk.why}`);

  // ── 7. Notas: editor con contenido ───────────────────────────────
  // A fresh page: this one follows the drag demo, and reusing the same
  // document caught the list half-painted with placeholder thumbnails.
  const page2 = await ctx.newPage();
  await page2.addInitScript(
    function (a) {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
      // "auto" follows prefers-color-scheme, and this headless context
      // reports light — the notes tree then renders unstyled against a
      // white page. Pin it so the capture is of the app, not of the
      // sandbox's colour preference.
      localStorage.setItem('mnexus.theme', 'dark');
    },
    tok,
  );
  await page2.goto(WEB + '/index.html#/notes', { waitUntil: 'load' });
  await settle(page2);
  await page2.waitForFunction(
    () => /Fibrosis|Herencia|Cromosoma/.test(document.body.innerText),
    null,
    { timeout: 8000 },
  ).catch(() => {});
  await page2.waitForTimeout(1200);
  const notesOk = await page2.evaluate(() => {
    const t = document.body.innerText;
    // The list is only usable if the rows actually occupy the screen:
    // empty rows with tofu glyphs pass a text check and look broken.
    const row = document.querySelector('.tree-note');
    const r = row ? row.getBoundingClientRect() : null;
    return {
      ok: /Fibrosis/.test(t) && !!r && r.height > 24,
      why: (t.match(/\d+ notes?/) || ['—'])[0] + ', alto de fila ' + (r ? r.height | 0 : 0) + 'px',
    };
  });
  await page2.screenshot({ path: path.join(OUT, '07-notas.png') });
  results.push({ name: '07-notas', ok: notesOk.ok, why: notesOk.why });
  console.log(`${notesOk.ok ? 'OK  ' : 'VACIO'} 07-notas — ${notesOk.why}`);
  await page2.close();

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} capturas con contenido real`);
  if (bad.length) console.log('sin contenido:', bad.map((b) => b.name).join(', '));
  await browser.close();
})();
