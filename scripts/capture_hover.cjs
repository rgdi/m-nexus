// capture_hover.cjs — el efecto mientras se arrastra, no después.
//
// La captura anterior del arrastre se sacaba con la ficha ya soltada: el
// fantasma, la ficha levantada y la máscara destino no aparecen nunca en
// una imagen estática. Y eso es exactamente la sensación que faltaba —
// "algo se solapa sin efecto". Aquí se congela el gesto a mitad de camino.
//
//   node scripts/capture_hover.cjs
//
// Salida: screenshots/core/06-arrastre-en-curso.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const OUT = path.join(ROOT, 'screenshots', 'core');

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
  const page = await ctx.newPage();
  await page.addInitScript(
    function () {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      localStorage.setItem('mnexus.theme', 'dark');
      localStorage.setItem('mnexus.lang', 'es');
    },
  );
  await page.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  // The splash swallows pointer events for the first second and a half.
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 12000) {
    const present = await page.evaluate(() => !!document.querySelector('.splash'));
    if (present) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 700) break;
    await page.waitForTimeout(150);
  }

  await page.evaluate(async (fig) => {
    const { mountOcclusionDragExercise } = await import('/src/screens/occlusion_screen.js');
    const host = document.createElement('div');
    host.id = 'demo';
    host.style.cssText = 'padding:16px;background:#0b0b12;position:relative;z-index:5';
    document.body.appendChild(host);
    const app = document.getElementById('app');
    if (app) app.style.setProperty('display', 'none');
    mountOcclusionDragExercise(host, {
      imageUrl: fig,
      subject: 'Cardiología',
      occlusions: [
        { id: 'o1', label: 'Corazón', x: 0.1, y: 0.24, w: 0.4, h: 0.32 },
        { id: 'o2', label: 'Arterias', x: 0.6, y: 0.24, w: 0.32, h: 0.32 },
      ],
      chips: [
        { id: 'c1', text: 'Corazón' },
        { id: 'c2', text: 'Arterias' },
        { id: 'c3', text: 'Pulmones' },
        { id: 'c4', text: 'Riñones' },
      ],
    });
  }, FIGURE);
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('#demo .do-stage')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);

  const geom = await page.evaluate(() => {
    const chip = document.querySelector('#demo .do-chip');
    const mask = document.querySelector('#demo [data-mask]');
    const c = chip.getBoundingClientRect();
    const m = mask.getBoundingClientRect();
    return { from: { x: c.x + c.width / 2, y: c.y + c.height / 2 }, to: { x: m.x + m.width / 2, y: m.y + m.height / 2 } };
  });

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 14, radiusY: 14, force: 1 }],
    });

  // Start, drag most of the way, and stop there: the ghost under the
  // finger, the hole left in the tray and the pulsing target are only
  // visible mid-gesture.
  await touch('touchStart', geom.from.x, geom.from.y);
  for (let i = 1; i <= 7; i++) {
    await touch('touchMove', geom.from.x + ((geom.to.x - geom.from.x) * i) / 8, geom.from.y + ((geom.to.y - geom.from.y) * i) / 8);
    await page.waitForTimeout(30);
  }
  // One more step so the mask is under the pointer and lit.
  await touch('touchMove', geom.to.x, geom.to.y - 6);
  await page.waitForTimeout(120);

  const state = await page.evaluate(() => ({
    ghost: !!document.querySelector('.do-ghost'),
    dragging: !!document.querySelector('.do-chip.is-dragging'),
    hot: !!document.querySelector('.do-mask.is-hot'),
  }));
  await page.screenshot({ path: path.join(OUT, '06-arrastre-en-curso.png') });
  console.log('a mitad del gesto:', JSON.stringify(state));

  await touch('touchEnd', geom.to.x, geom.to.y);
  await page.waitForTimeout(300);
  const placed = await page.evaluate(
    () => document.querySelectorAll('#demo [data-mask].is-filled').length,
  );
  console.log('colocadas al soltar:', placed);
  await browser.close();
})();
