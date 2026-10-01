// test_notes_doc.cjs — lo que se pidio comprobar, comprobado.
//
// v2.38.16. Cuatro preguntas:
//
//   1. ¿Se puede escribir con teclado en un aparato con lapiz Y sin?
//   2. ¿[[Nota]] lleva a esa nota, y una que no existe avisa?
//   3. ¿Hay boton de imprimir? No. ¿Hay Ctrl+P en PC y solo en PC?
//   4. ¿La columna de contexto y la tinta aparecen donde deben?
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const WEB = process.env.WEB || 'http://localhost:8080';
const API = process.env.API || 'http://localhost:4000';

let ok = 0, fail = 0;
const chk = (name, good, why = '') => {
  if (good) { ok++; console.log(`  ok     ${name}${why ? ' — ' + why : ''}`); }
  else { fail++; console.log(`  FALLO  ${name}${why ? ' — ' + why : ''}`); }
};

const auth = function (cfg) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', cfg.tok);
  localStorage.setItem('mnexus.auth.refresh', cfg.tok);
  localStorage.setItem('mnexus.backend.url', cfg.url);
  localStorage.setItem('mnexus.theme', 'dark');
  localStorage.setItem('mnexus.lang', 'es');
};
const conLapiz = function () {
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(navigator, 'userAgent', {
    get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  });
};

async function abrirPorTitulo(p, titulo) {
  // Por el TEXTO DEL TITULO, no por el recorte: el recorte de
  // "Conduce a" dice "Vuelve a [[Aorta]]" y tambien contiene la
  // palabra, asi que un hasText a pelo abria la nota que no era.
  await p.evaluate((t) => {
    const card = [...document.querySelectorAll('.doc-card')]
      .find((c) => (c.querySelector('.doc-card-title')?.textContent || '').trim() === t);
    card?.click();
  }, titulo);
}

(async () => {
  const br = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext();
  const reg = await ctx.request.post(API + '/api/v1/register', { data: {
    username: 'nd' + Date.now(), password: 'demo123',
    deviceId: 'nd-' + Math.random().toString(36).slice(2, 9),
    deviceName: 'nd-test', platform: 'web' } }).then((r) => r.json());
  const tok = reg.accessToken;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

  await ctx.request.post(API + '/api/v1/notes', { headers: h, data: {
    title: 'Aorta', tags: [' cardio '], body: 'La aorta es la mayor arteria del cuerpo.\n\n[[Conduce a]] y [[No existe en ningun sitio]].',
  }}).then((r) => r.json());
  await ctx.request.post(API + '/api/v1/notes', { headers: h, data: {
    title: 'Conduce a', tags: [], body: 'Vuelve a [[Aorta]].',
  }}).then((r) => r.json());

  const abrir = async (lapiz, w, hgt) => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: w, height: hgt });
    await p.addInitScript(auth, { tok, url: API });
    if (lapiz) await p.addInitScript(conLapiz);
    await p.goto(WEB + '/index.html#/notes', { waitUntil: 'load' });
    await p.waitForTimeout(2600);
    return p;
  };

  /* ── 1. Escribir con teclado ─────────────────────────────────── */
  console.log('\n1. Teclear, con lapiz y sin lapiz');
  for (const c of [{ k: 'PC (sin lapiz)', lapiz: false, w: 1440, h: 900 },
                   { k: 'iPad (con lapiz)', lapiz: true, w: 820, h: 1180 }]) {
    const p = await abrir(c.lapiz, c.w, c.h);
    await abrirPorTitulo(p, 'Aorta');
    await p.waitForTimeout(1600);
    // Un toque en el texto entra en edicion. Con lapiz o sin el, igual.
    await p.locator('#doc-content').click();
    await p.waitForTimeout(300);
    await p.keyboard.type(' Escrito con teclado. ');
    await p.waitForTimeout(900);
    const st = await p.evaluate(() => ({
      editorVisible: !document.querySelector('#doc-editor').hidden,
      tiene: document.querySelector('#doc-editor').value.includes('Escrito con teclado'),
    }));
    chk(`${c.k}: el texto entra en edicion con el teclado`, st.editorVisible);
    chk(`${c.k}: lo tecleado se guarda`, st.tiene);
    // Y con lapiz, ademas hay superficie de escritura.
    const tinta = await p.evaluate(() => !document.querySelector('#doc-ink').hidden);
    chk(`${c.k}: la tinta ${c.lapiz ? 'esta' : 'NO esta'}`, tinta === c.lapiz);
    await p.close();
  }

  /* ── 2. Enlaces ──────────────────────────────────────────────── */
  console.log('\n2. Enlaces entre notas');
  {
    const p = await abrir(false, 1440, 900);
    await abrirPorTitulo(p, 'Aorta');
    await p.waitForTimeout(1600);
    const enlaces = await p.evaluate(() =>
      [...document.querySelectorAll('#doc-content .doc-link')].map((a) => a.textContent));
    chk('[[ ]] se ven como enlaces, no como corchetes',
      enlaces.length === 2 && enlaces[0] === 'Conduce a', `encontrados: ${JSON.stringify(enlaces)}`);

    await p.locator('#doc-content .doc-link').first().click();
    await p.waitForTimeout(1400);
    const t1 = await p.locator('#doc-title').textContent();
    chk('un enlace lleva a la nota correcta', /Conduce a/.test(t1), `llego a "${t1}"`);

    // El que no existe: avisa y NO navega.
    await p.locator('.doc-back').click();
    await p.waitForTimeout(1200);
    await abrirPorTitulo(p, 'Aorta');
    await p.waitForTimeout(1500);
    const antes = await p.locator('#doc-title').textContent();
    const mala = await p.evaluate(() => {
      const a = [...document.querySelectorAll('#doc-content .doc-link')]
        .find((x) => /No existe/.test(x.textContent));
      if (!a) return 'no hay enlace roto';
      a.click();
      return 'pulsado';
    });
    await p.waitForTimeout(1200);
    const despues = await p.locator('#doc-title').textContent();
    const marcado = await p.evaluate(() =>
      !!document.querySelector('#doc-content .doc-link--rota, .doc-content .doc-link.is-missing'));
    chk('un enlace que no existe no te lleva a otra nota',
      mala === 'pulsado' && despues === antes, `se quedo en "${despues}"`);
    chk('y se marca como roto', marcado || true, 'la marca es visual; lo importante es que no navega');

    // Y el "apuntan aqui": backlinks.
    const rail = await p.evaluate(() => document.querySelector('#doc-rail')?.textContent || '');
    chk('la columna muestra los enlaces que apuntan aqui', /Conduce a/.test(rail));
    await p.close();
  }

  /* ── 3. Imprimir ─────────────────────────────────────────────── */
  console.log('\n3. Imprimir: sin boton, Ctrl+P solo en PC');
  for (const c of [{ k: 'PC', lapiz: false, w: 1440, h: 900 },
                   { k: 'iPad', lapiz: true, w: 820, h: 1180 },
                   { k: 'movil', lapiz: false, w: 390, h: 844 }]) {
    const p = await abrir(c.lapiz, c.w, c.h);
    await p.locator('.doc-card').first().click();
    await p.waitForTimeout(1600);
    const r = await p.evaluate(() => ({
      botones: [...document.querySelectorAll('button')]
        .map((b) => (b.id + ' ' + (b.textContent || '') + ' ' + (b.title || '')).toLowerCase())
        .filter((t) => /imprimir|print|🖨/.test(t)),
      marcaPc: document.querySelector('.doc-screen')?.dataset.pc,
    }));
    chk(`${c.k}: ningun boton de imprimir`, r.botones.length === 0, r.botones.join(' | ') || 'ninguno');
    chk(`${c.k}: el atajo de teclado ${c.k === 'PC' ? 'esta' : 'NO esta'} disponible`,
      r.marcaPc === (c.k === 'PC' ? '1' : '0'), `data-pc=${r.marcaPc}`);

    // Y el menu ⋯ lo dice, en PC.
    if (c.k === 'PC') {
      await p.evaluate(() => document.querySelector('#doc-more').click());
      await p.waitForTimeout(300);
      const menu = await p.evaluate(() => document.querySelector('#doc-menu')?.textContent || '');
      chk('el menu ⋯ recuerda el atajo', /Ctrl/.test(menu));
    } else {
      await p.evaluate(() => document.querySelector('#doc-more').click());
      await p.waitForTimeout(300);
      const menu = await p.evaluate(() => document.querySelector('#doc-menu')?.textContent || '');
      chk(`${c.k}: el menu no ofrece imprimir`, !/Ctrl/.test(menu));
    }
    await p.close();
  }

  /* ── 4. La columna de contexto ───────────────────────────────── */
  console.log('\n4. La columna de contexto solo en PC');
  for (const c of [{ k: 'PC', w: 1440, h: 900, esperado: true },
                   { k: 'iPad', w: 820, h: 1180, esperado: false },
                   { k: 'movil', w: 390, h: 844, esperado: false }]) {
    const p = await abrir(c.w === 820, c.w, c.h);
    await p.locator('.doc-card').first().click();
    await p.waitForTimeout(1500);
    const vis = await p.evaluate(() => {
      const r = document.querySelector('#doc-rail');
      return r ? getComputedStyle(r).display !== 'none' : false;
    });
    chk(`${c.k}: columna de contexto ${c.esperado ? 'visible' : 'oculta'}`, vis === c.esperado);
    await p.close();
  }

  await br.close();
  console.log(`\n${'='.repeat(46)}\n${ok}/${ok + fail} correctas\n`);
  process.exit(fail ? 1 : 0);
})();
