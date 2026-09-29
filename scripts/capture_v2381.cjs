// capture_v2381.cjs — capturas de las pantallas nuevas de v2.38.1.
//
// Una captura de una pantalla vacía no demuestra nada: #/mood sin
// registros muestra tres guiones, y un generador sin notas no genera.
// Este script siembra material real por HTTP y luego conduce la interfaz
// como lo haría una persona, comprobando en el DOM que hay contenido
// antes de capturar.
//
// Eso es exactamente lo que destapó los dos peores defectos de la
// release: el selector de carpeta de #/generate no enviaba folderId, y
// el árbol de notas salía con títulos blancos sobre panel blanco. Los
// tests de HTTP no ven ninguna de las dos cosas.
//
//   node scripts/capture_v2381.cjs
//
// Requiere el backend en :4000 y el frontend servido en :8080.
// Salida: screenshots/v2381/*.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
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

const authScript = (tok) => function (a) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', a);
  localStorage.setItem('mnexus.auth.refresh', a);
  localStorage.setItem('mnexus.backend.url', a.__api || 'http://localhost:4000');
  // "auto" follows prefers-color-scheme, and a headless context reports
  // light. The notes tree then renders unstyled against a white page,
  // which looks like a broken screen rather than a colour preference.
  localStorage.setItem('mnexus.theme', 'dark');
};

async function settle(page) {
  // The splash covers the viewport and swallows pointer events for the
  // first second and a half, and it only appears after the backend
  // probe resolves — so a single "is it gone yet" check passes too early
  // and every drag silently misses.
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
    executablePath:
      process.env.CHROME_PATH ||
      '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
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

  // ── Material real ────────────────────────────────────────────────
  const gen = await ctx.request
    .post(API + '/api/v1/folders', { headers: auth, data: { name: 'Genética' } })
    .then((r) => r.json());
  const car = await ctx.request
    .post(API + '/api/v1/folders', { headers: auth, data: { name: 'Cardiología' } })
    .then((r) => r.json());
  for (const [title, folder, body] of [
    ['Fibrosis quística', gen.id, 'La fibrosis quística es una enfermedad autosómica recesiva causada por una mutación en el gen CFTR.\n\nEl tratamiento incluye mucolíticos, fisioterapia respiratoria y una dieta rica en fósforo.'],
    ['Herencia mendeliana', gen.id, 'La herencia mendeliana sigue las leyes de Mendel: segregación y distribución independiente.\n\nLa consanguinidad aumenta la probabilidad de enfermedades autosómicas recesivas.'],
    ['Cromosomas', gen.id, 'Los cromosomas se emparejan por tamaño y forma; el cromosoma 7 porta el gen CFTR.\n\nLas mutaciones puntuales incluyen sustituciones, inserciones y deleciones.'],
    ['Ciclo cardíaco', car.id, 'El ciclo cardíaco tiene dos fases: sístole y diástole.\n\nLa sístole ventricular expulsa sangre hacia la aorta y la arteria pulmonar.'],
    ['Arterias y venas', car.id, 'Las arterias llevan sangre desde el corazón y las venas la devuelven.\n\nLa aorta es la mayor arteria del cuerpo humano.'],
  ]) {
    await ctx.request.post(API + '/api/v1/notes', {
      headers: auth,
      data: { title, body, folderId: folder },
    });
  }
  for (const [text, kind] of [
    ['comprar leche el viernes a las 18:00 urgente', 'shopping'],
    ['estudiar el ciclo cardiaco mañana a las 20:00', 'task'],
    ['beber 2 litros de agua todos los días', 'habit'],
  ]) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: auth, data: { text, kind, done: false } });
  }
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

  const page = await ctx.newPage();
  await page.addInitScript(authScript(), tok);

  const shoot = async (name, ok, why) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    results.push({ name, ok, why });
    console.log(`${ok ? 'OK  ' : 'VACIO'} ${name}${why ? ' — ' + why : ''}`);
  };

  // ── 1. Ánimo ─────────────────────────────────────────────────────
  await page.goto(WEB + '/index.html#/mood', { waitUntil: 'load' });
  await settle(page);
  const mood = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.m-stat-num')].map((e) => e.textContent.trim());
    return { ok: n.some((x) => x !== '—' && x !== '0'), why: 'racha/media/anotados: ' + n.join(' / ') };
  });
  await shoot('01-mood', mood.ok, mood.why);

  // ── 2. Generador: el formulario ─────────────────────────────────
  await page.goto(WEB + '/index.html#/generate', { waitUntil: 'load' });
  await settle(page);
  await shoot(
    '02-generar-form',
    (await page.evaluate(() => document.querySelectorAll('select, .gen-kinds *').length)) > 3,
    'carpetas y formatos cargados',
  );

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
  const genRes = await page.evaluate(() => {
    const t = document.querySelector('.gen-result')?.innerText || '';
    return { ok: /pasajes|Generado/.test(t), why: t.split('\n').filter(Boolean).slice(0, 2).join(' · ') };
  });
  await shoot('03-generar-resultado', genRes.ok, genRes.why);

  // ── 4. Captura con voz ───────────────────────────────────────────
  await page.goto(WEB + '/index.html#/capture', { waitUntil: 'load' });
  await settle(page);
  // The mic only appears where the browser can transcribe; stub the API
  // so the control is visible instead of absent for the wrong reason.
  await page.addInitScript(() => {
    window.SpeechRecognition = function () {
      return {
        continuous: true, interimResults: true, lang: 'es-ES',
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
  const cap = await page.evaluate(() => {
    const t = document.body.innerText;
    return { ok: /Tareas|Compras|Hábitos/.test(t), why: t.split('\n').filter(Boolean).slice(0, 2).join(' · ') };
  });
  await shoot('04-captura-voz', cap.ok, cap.why);

  // ── 5. Arrastre sobre la imagen ──────────────────────────────────
  await page.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  await settle(page);
  await page.evaluate(async (fig) => {
    const { mountOcclusionDragExercise } = await import('/src/screens/occlusion_screen.js');
    const h = document.createElement('div');
    h.id = 'demo';
    h.style.cssText = 'padding:16px;background:#0b0b12;position:relative;z-index:5';
    document.body.appendChild(h);
    document.getElementById('app')?.style.setProperty('display', 'none');
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
  // Real touch input through CDP: the widget is built on Pointer Events
  // with setPointerCapture, and this is the path a finger takes.
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
  const drag = await page.evaluate(() => {
    const filled = [...document.querySelectorAll('#demo [data-mask]')].filter((m) =>
      m.classList.contains('is-filled'),
    );
    return {
      ok: filled.length >= 2,
      why: filled.map((m) => m.querySelector('.do-mask-label')?.textContent?.trim()).join(' + '),
    };
  });
  await shoot('05-arrastre-imagen', drag.ok, drag.why);

  // ── 6. Mapa mental: determinista, sin modelo ────────────────────
  // Restore the app: the drag demo hid it to sit on a clean page, and
  // leaving it hidden makes this capture photograph the previous step.
  await page.evaluate(() => {
    document.getElementById('demo')?.remove();
    document.getElementById('app')?.style.removeProperty('display');
  });
  await page.goto(WEB + '/index.html#/generate', { waitUntil: 'load' });
  await settle(page);
  const gi = await page.evaluate(() =>
    [...document.querySelectorAll('select option')].findIndex((o) => /Genética/.test(o.textContent)),
  );
  await page.selectOption('select', { index: gi });
  await page.waitForTimeout(400);
  // Touch a format: this repaints. The chosen folder has to survive it.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Resumen/.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(300);
  const kept = await page.evaluate(() => document.querySelector('select')?.value || '');
  console.log(`     carpeta tras repintar: ${kept ? 'conservada' : 'PERDIDA'}`);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Mapa mental/.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Generar/.test(b.textContent || '') && !b.disabled)?.click();
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('.gen-result')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  const mm = await page.evaluate(() => {
    const t = document.querySelector('.gen-result')?.innerText || '';
    return {
      // Cardiología content here would mean the folder filter leaked.
      ok: /CFTR|Mendel/i.test(t) && !/ciclo cardiaco/i.test(t) && !/mock AI/i.test(t),
      why: t.split('\n').filter(Boolean).slice(0, 3).join(' · '),
    };
  });
  await shoot('06-mapa-mental', mm.ok, mm.why);

  // ── 7. Notas ─────────────────────────────────────────────────────
  // A fresh page: reusing this one after the drag demo caught the list
  // half-painted with placeholder thumbnails.
  const p2 = await ctx.newPage();
  await p2.addInitScript(authScript(), tok);
  await p2.goto(WEB + '/index.html#/notes', { waitUntil: 'load' });
  await settle(p2);
  await p2.waitForFunction(() => /Fibrosis|Cromosoma/.test(document.body.innerText), null, { timeout: 8000 })
    .catch(() => {});
  await p2.waitForTimeout(1200);
  const notes = await p2.evaluate(() => {
    const tree = document.querySelector('.notes-tree');
    const name = document.querySelector('.note-name');
    if (!tree || !name) return { ok: false, why: 'árbol o título ausente' };
    const bg = getComputedStyle(tree).backgroundColor;
    const fg = getComputedStyle(name).color;
    // The bug this catches: a light panel with light text, which passes
    // every text assertion and is unreadable.
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+/g).map(Number);
      return (r * 299 + g * 587 + b * 114) / 1000;
    };
    return {
      ok: Math.abs(lum(bg) - lum(fg)) > 60,
      why: `panel ${bg} / texto ${fg} (contraste ${Math.abs(lum(bg) - lum(fg)) | 0})`,
    };
  });
  await p2.screenshot({ path: path.join(OUT, '07-notas.png') });
  results.push({ name: '07-notas', ok: notes.ok, why: notes.why });
  console.log(`${notes.ok ? 'OK  ' : 'VACIO'} 07-notas — ${notes.why}`);
  await p2.close();

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} capturas con contenido real`);
  if (bad.length) console.log('sin contenido:', bad.map((b) => b.name).join(', '));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
