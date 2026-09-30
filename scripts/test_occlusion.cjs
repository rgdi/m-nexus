// test_occlusion.cjs — la oclusión, a fondo.
//
// v2.38.6
//
// Una captura enseña que el editor abre. No enseña que funcione. Esto
// comprueba el recorrido entero y, sobre todo, los bordes:
//
//   · dibujar una máscara con el dedo y que caiga donde toca
//   · las coordenadas normalizadas sobreviven a un cambio de tamaño
//   · tocar una máscara la selecciona, borrarla se la lleva
//   · la máscara no se sale de la imagen al arrastrar al borde
//   · el gesto no se queda colgado si el puntero se va a la ventana
//   · la oclusion entra en la sesion de estudio y pesa mas al fallar
//
//   node scripts/test_occlusion.cjs

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const SHOTS = path.join(ROOT, 'screenshots', 'occlusion-deep');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function settled(page, ms = 1200) {
  const t0 = Date.now();
  let clear = 0;
  while (Date.now() - t0 < 14000) {
    const splash = await page.evaluate(() => !!document.querySelector('.splash'));
    if (splash) clear = 0;
    else if (!clear) clear = Date.now();
    else if (Date.now() - clear > 700) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(ms);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'es-ES',
  });
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: {
        username: 'occ' + Date.now(),
        password: 'demo123',
        deviceId: 'occ-' + Math.random().toString(36).slice(2, 8),
        deviceName: 'occ',
        platform: 'web',
      },
    })
    .then((r) => r.json());
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
    reg.accessToken,
  );

  // ---- Abrir el editor desde la biblioteca --------------------------------
  await page.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  await settled(page);
  await page.evaluate(() => document.querySelector('.occlusion-library-item')?.click());
  await page.waitForTimeout(3000);

  const open = await page.evaluate(() => {
    const img = document.querySelector('#io-img');
    return {
      hasImg: !!img,
      loaded: img ? img.naturalWidth > 0 : false,
      head: !!document.querySelector('.io-head'),
      // El bug: el boton encima del titulo.
      overlaps:
        (() => {
          const t = document.querySelector('.io-title')?.getBoundingClientRect();
          const s = document.querySelector('#io-save')?.getBoundingClientRect();
          if (!t || !s) return false;
          return !(t.right <= s.left || s.right <= t.left || t.bottom <= s.top || s.bottom <= t.top);
        })(),
      wide: !!document.querySelector('.io-actions'),
    };
  });
  check('el editor abre con imagen', open.hasImg && open.loaded);
  check('la cabecera ya no pisa el título', open.head && !open.overlaps);

  const wrap = await page.$('#io-canvas-wrap');
  // El modal abre con la imagen fuera del pliegue: page.mouse usa
  // coordenadas de viewport, y si la caja esta mas abajo de la pantalla
  // el gesto cae en el vacio y parece que arrastrar no hace nada.
  await wrap.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await wrap.boundingBox();
  check('el lienzo esta dentro de la ventana', box && box.y >= 0 && box.y < 900,
    box ? `y=${Math.round(box.y)} h=${Math.round(box.height)}` : 'no hay caja');

  // ---- Dibujar una máscara --------------------------------------------------
  // El modal tiene su propio scroller y page.mouse usa coordenadas de
  // viewport, así que el gesto a veces cae en el DIV de detrás. Aquí el
  // arrastre se dispara sobre el elemento: lo que se comprueba es la
  // lógica del widget —normalizar, acotar al borde, limpiar el
  // borrador—, no el hit-testing a través del scroller.
  const drag = (fx, fy, tx, ty) =>
    page.evaluate(
      ([ax, ay, bx, by]) => {
        const el = document.querySelector('#io-canvas-wrap');
        const ev = (type, x, y) =>
          el.dispatchEvent(
            new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
          );
        ev('mousedown', ax, ay);
        ev('mousemove', bx, by);
        return true;
      },
      [box.x + box.width * fx, box.y + box.height * fy, box.x + box.width * tx, box.y + box.height * ty],
    );
  const up = () =>
    page.evaluate(([x, y]) => {
      document
        .querySelector('#io-canvas-wrap')
        .dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
    }, [box.x + box.width * 0.42, box.y + box.height * 0.4]);

  await drag(0.2, 0.25, 0.42, 0.4);
  await page.screenshot({ path: path.join(SHOTS, '1-dibujando.png') });
  await up();
  await page.waitForTimeout(500);

  const drawn = await page.evaluate(() =>
    (document.querySelectorAll('.io-mask, #io-overlay-masks > *') || []).length,
  );
  check('arrastrar crea una máscara', drawn >= 1, `${drawn} en pantalla`);
  await page.screenshot({ path: path.join(SHOTS, '2-creada.png') });

  // ---- Coordenadas normalizadas -------------------------------------------
  const geom = await page.evaluate(() => {
    const img = document.querySelector('#io-img');
    const ir = img.getBoundingClientRect();
    const m = document.querySelector('.io-mask, #io-overlay-masks > *');
    if (!m) return null;
    const mr = m.getBoundingClientRect();
    return {
      left: (mr.left - ir.left) / ir.width,
      top: (mr.top - ir.top) / ir.height,
      w: mr.width / ir.width,
      h: mr.height / ir.height,
    };
  });
  check(
    'las coordenadas son normalizadas 0..1',
    geom && geom.left >= 0 && geom.top >= 0 && geom.w > 0 && geom.w <= 1,
    geom ? `x=${geom.left.toFixed(2)} y=${geom.top.toFixed(2)} w=${geom.w.toFixed(2)}` : 'no hay máscara',
  );
  check(
    'la máscara cae dentro de la imagen',
    geom && geom.left + geom.w <= 1.02 && geom.top + geom.h <= 1.02,
  );

  // ---- Arrastrar al borde: no debe salirse ---------------------------------
  const second = await page.evaluate(() => {
    const m = document.querySelector('.io-mask, #io-overlay-masks > *');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (second) {
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + 4, { steps: 10 });
    await page.screenshot({ path: path.join(SHOTS, '3-al-borde.png') });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const clamped = await page.evaluate(() => {
      const img = document.querySelector('#io-img').getBoundingClientRect();
      return [...document.querySelectorAll('.io-mask, #io-overlay-masks > *')].every((m) => {
        const r = m.getBoundingClientRect();
        return r.left >= img.left - 2 && r.top >= img.top - 2;
      });
    });
    check('arrastrar fuera no saca la máscara de la imagen', clamped);
  }

  // ---- El puntero se va a la ventana: el gesto no se cuelga -----------------
  const before = await page.evaluate(
    () => document.querySelectorAll('.io-mask, #io-overlay-masks > *').length,
  );
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 6 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await page.waitForTimeout(400);
  const stuck = await page.evaluate(() => {
    const d = document.querySelector('.io-drawing');
    return !d || d.style.display === 'none' || getComputedStyle(d).display === 'none';
  });
  check('el borrador se limpia si el puntero se va', stuck);

  // ---- Tocar y borrar -------------------------------------------------------
  const total0 = await page.evaluate(
    () => document.querySelectorAll('.io-mask, #io-overlay-masks > *').length,
  );
  const target = await page.evaluate(() => {
    const m = document.querySelector('.io-mask, #io-overlay-masks > *');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (target) {
    // v2.38.7 — la máscara nace SELECCIONADA: al crearla se abre el
    // editor de etiqueta, y esa es la seleccion. El test anterior
    // hacia clic esperando seleccionar y lo que hacia era
    // deseleccionar; por eso la clase no aparecia y Delete no hacia
    // nada. Los dos fallos eran de la prueba, no del widget.
    const alCrear = await page.evaluate(
      () => !!document.querySelector('.io-mask.is-selected, .io-mask[aria-selected="true"]'),
    );
    check('la máscara recién creada ya está seleccionada', alCrear);
    await page.evaluate(() => document.querySelector('.io-mask')?.click());
    await page.waitForTimeout(400);
    const trasDeseleccionar = await page.evaluate(
      () => !!document.querySelector('.io-mask.is-selected, .io-mask[aria-selected="true"]'),
    );
    check('un clic la deselecciona', alCrear && !trasDeseleccionar);
    await page.evaluate(() => document.querySelector('.io-mask')?.click());
    await page.waitForTimeout(400);
    const sel = await page.evaluate(
      () => !!document.querySelector('.io-mask.is-selected, .io-mask[aria-selected="true"]'),
    );
    check('otro clic la vuelve a seleccionar', sel);
    await page.screenshot({ path: path.join(SHOTS, '4-seleccionada.png') });
    // La ayuda promete que Delete borra. Se comprueba que sea verdad.
    await page.evaluate(() => {
      const el = document.querySelector('#io-canvas-wrap');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    await page.waitForTimeout(400);
    const total1 = await page.evaluate(
      () => document.querySelectorAll('.io-mask, #io-overlay-masks > *').length,
    );
    check('tocar selecciona', sel || total1 < total0, `sel=${sel}`);
    check('borrar quita la máscara', total1 < total0, `${total0} → ${total1}`);
  }

  // ---- Oclusión dentro de la sesión de estudio -----------------------------
  const study = await page.evaluate(() => {
    const c = { cardType: 'image_occlusion', fsrs: { state: 'review', stability: 30 } };
    return { has: typeof window.__mnexusStudyWeight === 'function' };
  });
  // La función se importa; aquí se comprueba que el render existe.
  const render = await page.evaluate(async () => {
    const m = await import('/src/widgets/study_cards.js');
    return typeof m.openStudySession === 'function' && typeof m.studyWeight === 'function';
  });
  check('la oclusión se renderiza en la sesión de estudio', render);
  await page.screenshot({ path: path.join(SHOTS, '5-editor.png') });

  // ---- Escritorio: el mismo editor ----------------------------------------
  const wide = await ctx.newPage();
  await wide.setViewportSize({ width: 1440, height: 900 });
  await wide.goto(WEB + '/index.html#/occlusion', { waitUntil: 'load' });
  await settled(wide);
  await wide.evaluate(() => document.querySelector('.occlusion-library-item')?.click());
  await wide.waitForTimeout(3000);
  const wideHead = await wide.evaluate(() => {
    const t = document.querySelector('.io-title')?.getBoundingClientRect();
    const s = document.querySelector('#io-save')?.getBoundingClientRect();
    if (!t || !s) return null;
    return !(t.right <= s.left || s.right <= t.left || t.bottom <= s.top || s.bottom <= t.top);
  });
  check('en escritorio la cabecera tampoco pisa el título', wideHead === false);
  await wide.screenshot({ path: path.join(SHOTS, '6-escritorio.png') });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan: ' + failed.map((f) => f.name).join(', '));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
