// capture_v238_drag.cjs — v2.38.1 drag-to-gap on an image.
//
// The point of this capture is the *after* state: answer chips actually
// sitting on the figure where the student dropped them. A screenshot of
// the empty exercise proves the widget mounted, not that dragging
// works, so this drives real pointer events and then checks the DOM.
//
//   node scripts/capture_v238_drag.cjs
//
// Output: screenshots/drag-occlusion.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = '/workspace/m-nexus';
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots');

// A tiny SVG diagram: two labelled shapes, so a chip dropped on the
// wrong one is visibly wrong rather than plausibly right.
const FIGURE = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
     <rect width="640" height="420" fill="#12121c"/>
     <circle cx="200" cy="180" r="105" fill="#2a2a44" stroke="#6c6c9c" stroke-width="3"/>
     <text x="200" y="190" font-size="30" fill="#dcdcf0" text-anchor="middle" font-family="sans-serif">A</text>
     <rect x="330" y="90" width="200" height="180" rx="18" fill="#22303f" stroke="#5c8ca0" stroke-width="3"/>
     <text x="430" y="190" font-size="30" fill="#dcdcf0" text-anchor="middle" font-family="sans-serif">B</text>
     <text x="320" y="360" font-size="22" fill="#8a8aa8" text-anchor="middle" font-family="sans-serif">Figura 1 — senales</text>
   </svg>`).toString('base64')}`;

(async () => {
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
        username: 'drag' + Date.now(),
        password: 'demo123',
        deviceId: 'drag-' + Math.random().toString(36).slice(2, 10),
        deviceName: 'drag-capture',
        platform: 'web',
      },
    })
    .then((r) => r.json())
    .catch(() => ({}));

  const page = await ctx.newPage();
  await page.addInitScript(
    function (a) {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
    },
    reg.accessToken || '',
  );

  await page.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });

  // The splash covers the viewport (z-index 9999) and swallows every
  // pointer event until it removes itself ~1.6s after load. Dragging
  // through it silently does nothing, which looks exactly like a broken
  // widget. Wait it out rather than shipping a screenshot that proves
  // nothing.
  // Not a one-shot check: showSplash() runs *after* the backend probe
  // resolves, so a fast first look passes and the splash then lands on
  // top. Require it to be absent for a stable stretch instead.
  const t0 = Date.now();
  let clearSince = 0;
  while (Date.now() - t0 < 10000) {
    const present = await page.evaluate(() => !!document.querySelector('.splash'));
    if (present) { clearSince = 0; }
    else if (!clearSince) { clearSince = Date.now(); }
    else if (Date.now() - clearSince > 700) break;
    await page.waitForTimeout(150);
  }
  if (await page.evaluate(() => !!document.querySelector('.splash'))) {
    console.log('FALLO: el splash seguía presente tras 10s; la captura no sería válida');
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(200);

  // Mount the exercise directly rather than driving the authoring flow:
  // this capture is about the drag interaction, and the authoring path
  // is covered by its own tests.
  const result = await page.evaluate(async (figure) => {
    const { mountOcclusionDragExercise } = await import('/src/screens/occlusion_screen.js');
    const host = document.createElement('div');
    host.id = 'drag-capture-host';
    host.style.cssText = 'padding:16px;background:#0b0b12;min-height:100vh';
    document.body.appendChild(host);
    const api = mountOcclusionDragExercise(host, {
      imageUrl: figure,
      subject: 'Señales',
      occlusions: [
        { id: 'o1', label: 'Corazón', x: 0.20, y: 0.24, w: 0.28, h: 0.36 },
        { id: 'o2', label: 'Pulmón', x: 0.55, y: 0.24, w: 0.26, h: 0.36 },
      ],
      chips: [
        { id: 'c1', text: 'Corazón' },
        { id: 'c2', text: 'Pulmón' },
        { id: 'c3', text: 'Hígado' },
      ],
    });
    window.__dragApi = api;
    return { mounted: !!api };
  }, FIGURE);

  await page.waitForTimeout(600);

  // Drag two chips onto their targets with real pointer events. touch
  // events on a mobile context: this is the path a finger takes.
  const box = async (sel) => {
    const el = await page.$(sel);
    return el ? await el.boundingBox() : null;
  };

  // Scroll the exercise into view first: page.mouse works in viewport
  // coordinates, and a figure below the fold simply cannot be reached.
  await page.evaluate(() => {
    document.querySelector('#drag-capture-host .do-stage')
      ?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);

  const stage = await box('#drag-capture-host .do-stage');
  if (!stage) {
    console.log('FALLO: no se encontró el escenario del ejercicio');
    await browser.close();
    process.exit(1);
  }

  const chips = await page.$$('#drag-capture-host .do-chip');
  // Aim at the real centre of each mask rather than a computed
  // fraction of the stage — the mask overlay is inset, and a drag that
  // lands a few pixels out is not a demonstration of anything.
  const targets = await page.evaluate(() =>
    [...document.querySelectorAll('#drag-capture-host [data-mask]')].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  console.log('mascaras:', targets.map((t) => `${t.x | 0},${t.y | 0}`).join('  '));

  // Dispatch real touch input through CDP rather than page.mouse.
  // The widget is built on Pointer Events with setPointerCapture, and
  // this context is hasTouch — so this is the path a finger actually
  // takes, and the one the widget claims to support. Synthetic mouse
  // events did not produce a placement here.
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
    });
  };

  for (let i = 0; i < Math.min(2, chips.length); i++) {
    const cb = await chips[i].boundingBox();
    if (!cb) continue;
    const sx = cb.x + cb.width / 2;
    const sy = cb.y + cb.height / 2;
    const tx = targets[i].x;
    const ty = targets[i].y;
    console.log(`  ficha ${i}: ${sx | 0},${sy | 0} -> ${tx | 0},${ty | 0}`);
    await touch('touchStart', sx, sy);
    // Intermediate moves: a single jump would not exercise the
    // pointermove path a real drag takes.
    for (let s = 1; s <= 8; s++) {
      await touch('touchMove', sx + ((tx - sx) * s) / 8, sy + ((ty - sy) * s) / 8);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', tx, ty);
    await page.waitForTimeout(250);
  }

  // What the DOM actually says — the screenshot shows placement, this
  // proves the model was updated.
  const state = await page.evaluate(() => {
    // A drop is recorded on the mask, not by re-parenting the chip into
    // it: the mask gains is-filled and the label takes the chip's text.
    // Checking for a nested chip would report zero for a drag that
    // worked perfectly.
    const masks = [...document.querySelectorAll('#drag-capture-host [data-mask]')]
      .map((m) => ({
        mask: m.getAttribute('data-mask'),
        filled: m.classList.contains('is-filled'),
        correct: m.classList.contains('is-correct'),
        label: m.querySelector('.do-mask-label')?.textContent?.trim() || '',
      }))
      .filter((m) => m.filled);
    return {
      placed: masks,
      total: document.querySelectorAll('#drag-capture-host .do-chip').length,
      unused: [...document.querySelectorAll('#drag-capture-host .do-chip')]
        .filter((c) => c.getAttribute('aria-disabled') === 'true').length,
    };
  });

  const hitNow = await page.evaluate((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    return { tag: el?.tagName, cls: (el?.className || '').toString().slice(0, 40),
             inMask: el?.closest?.('[data-mask]')?.getAttribute('data-mask') ?? null,
             splash: !!document.querySelector('.splash') };
  }, { x: targets[0].x, y: targets[0].y });
  console.log('elemento en el destino:', JSON.stringify(hitNow));

  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'drag-occlusion.png') });

  const placedCount = state.placed.length;
  console.log('montado:', result.mounted);
  console.log('fichas:', state.total, '| colocadas:', placedCount);
  for (const p of state.placed) console.log('  máscara', p.mask, '<-', p.label, p.correct ? '(correcta)' : '(incorrecta)');
  console.log('fichas sin usar:', state.unused, 'de', state.total);
  console.log(placedCount >= 2 ? 'OK: dos fichas arrastradas a su destino' : 'AVISO: menos de dos fichas colocadas');

  await browser.close();
})();
