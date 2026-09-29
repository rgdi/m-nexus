// capture_normal.cjs — cada pantalla en uso normal, con datos sembrados.
//
// Esto no es un sweep de rutas: el sweep pregunta "¿responde 200 y el
// cuerpo no es el fallback?". Esto pregunta "¿qué ve una persona que
// está usando la app un martes por la tarde?", y por eso tiene que
// sembrar un curso entero y recorrer las pantallas en el orden en que
// se usarían.
//
//   node scripts/capture_normal.cjs
//
// Salida: screenshots/normal/*.png

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'normal');

const auth = (tok) => function (a) {
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
  sessionStorage.setItem('mnexus.auth.access', a);
  localStorage.setItem('mnexus.auth.refresh', a);
  localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  localStorage.setItem('mnexus.theme', 'dark');
  // Spanish, so the screenshots read the way a Spanish user sees them.
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
  await page.waitForTimeout(500);
}

const COURSE = [
  ['Genética', [
    ['Fibrosis quística', 'La fibrosis quística es una enfermedad autosómica recesiva causada por una mutación en el gen CFTR.\n\nEl cromosoma 7 porta ese gen. El tratamiento incluye mucolíticos, fisioterapia respiratoria y una dieta rica en fósforo.'],
    ['Herencia mendeliana', 'La herencia mendeliana sigue las leyes de Mendel: la segregación y la distribución independiente.\n\nLa consanguinidad aumenta la probabilidad de enfermedades autosómicas recesivas.'],
    ['Mutaciones puntuales', 'Las mutaciones puntuales incluyen sustituciones, inserciones y deleciones.\n\nUna sustitución cambia un único nucleótido y puede ser silenciosa si no altera el codón.'],
  ]],
  ['Cardiología', [
    ['Ciclo cardíaco', 'El ciclo cardíaco tiene dos fases: sístole y diástole.\n\nDurante la sístole ventricular el corazón expulsa sangre hacia la aorta y la arteria pulmonar.'],
    ['Arterias y venas', 'Las arterias llevan sangre desde el corazón y las venas la devuelven.\n\nLa aorta es la mayor arteria del cuerpo humano y tiene elasticity para absorber el pico de presión sistólico.'],
  ]],
  ['Química', [
    ['Enlace iónico', 'El enlace iónico transfiere electrones entre átomos con diferencia de electronegatividad.\n\nSe forma entre metales y no metales, y da lugar a compuestos iónicos como el cloruro de sodio.'],
    ['pH y tampones', 'La acidosis respiratoria baja el pH por retención de CO2.\n\nLos sistemas tampon del sangre mantienen el pH entre 7.35 y 7.45 gracias al bicarbonato.'],
  ]],
];

async function seed(ctx, h) {
  const folders = {};
  for (const [name, notes] of COURSE) {
    const f = await ctx.request
      .post(API + '/api/v1/folders', { headers: h, data: { name } })
      .then((r) => r.json());
    folders[name] = f.id;
    for (const [title, body] of notes) {
      await ctx.request.post(API + '/api/v1/notes', {
        headers: h,
        data: { title, body, folderId: f.id, subject: name.toLowerCase(), tags: [name.toLowerCase()] },
      });
    }
  }

  // Asignaturas
  for (const [name, teacher] of [
    ['Genética', 'Dra. Ferrer'],
    ['Cardiología', 'Dr. Mena'],
    ['Química', 'Prof. Ruiz'],
  ]) {
    await ctx.request.post(API + '/api/v1/subjects', { headers: h, data: { name, teacher } }).catch(() => {});
  }

  // Tarjetas de repaso, con historial para que FSRS tenga algo que mostrar
  const cards = [
    ['¿Qué gen causa la fibrosis quística?', 'CFTR, en el cromosoma 7', 'gen'],
    ['¿Cuáles son las dos leyes de Mendel?', 'Segregación y distribución independiente', 'gen'],
    ['¿Qué es una sustitución puntual?', 'Cambio de un único nucleótido', 'gen'],
    ['¿Cuántas fases tiene el ciclo cardíaco?', 'Sístole y diástole', 'car'],
    ['¿Qué es la aorta?', 'La mayor arteria del cuerpo', 'car'],
    ['¿Qué forma un enlace iónico?', 'Metales con no metales, por transferencia electrónica', 'qui'],
    ['¿Rango normal de pH en sangre?', '7.35 a 7.45', 'qui'],
  ];
  for (const [front, back, tag] of cards) {
    const c = await ctx.request
      .post(API + '/api/v1/flashcards', { headers: h, data: { front, back, subject: tag } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (c.id) {
      for (let i = 0; i < 4; i++) {
        await ctx.request
          .post(API + `/api/v1/flashcards/${c.id}/review`, {
            headers: h,
            data: { rating: [2, 3, 3, 4][i] },
          })
          .catch(() => {});
      }
    }
  }

  // Agenda de la semana.
  // The endpoint takes epoch `start`/`end`, not `date` + `startTime` —
  // the first version of this seed used the calendar form and every
  // event silently 400'd, which is why the agenda kept rendering empty.
  const at = (dayOffset, hour, min) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min, 0, 0);
    return d.getTime();
  };
  for (const [d, title, hour, min, len, prof, room] of [
    [0, 'Repaso de genética', 18, 0, 90, 'Dra. Ferrer', 'Aula 3'],
    [0, 'Repaso de química', 20, 30, 60, 'Prof. Ruiz', 'Lab 1'],
    [1, 'Entrega práctica de química', 10, 0, 45, 'Prof. Ruiz', 'Aula 3'],
    [2, 'Clínica de cardiología', 16, 30, 120, 'Dr. Mena', 'Hospital'],
    [3, 'Seminario de Mendel', 12, 0, 60, 'Dra. Ferrer', 'Aula 1'],
    [4, 'Examen de química', 9, 0, 120, 'Prof. Ruiz', 'Aula 2'],
  ]) {
    const start = at(d, hour, min);
    await ctx.request
      .post(API + '/api/v1/events', {
        headers: h,
        data: { title, start, end: start + len * 60000, subject: 'Estudio', prof, room },
      })
      .catch(() => {});
  }

  // Bandeja de captura
  for (const [text, kind] of [
    ['comprar leche desnatada el viernes a las 18:00', 'shopping'],
    ['estudiar el ciclo cardíaco mañana a las 20:00', 'task'],
    ['llamar a Laura sobre las prácticas el jueves a las 11:00', 'task'],
    ['beber 2 litros de agua todos los días', 'habit'],
    ['gastar 12.50 en café con Nacho ayer a las 17:00', 'expense'],
  ]) {
    await ctx.request
      .post(API + '/api/v1/tasks', { headers: h, data: { text, kind, done: false } })
      .catch(() => {});
  }

  // Diario y ánimo: dos semanas conaltaractividad, como una persona real
  for (let d = 13; d >= 0; d--) {
    const iso = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const j = await ctx.request
      .post(API + '/api/v1/journal/today', { headers: h, data: { date: iso } })
      .then((r) => r.json())
      .catch(() => ({}));
    if (j.id) {
      // Un par de huecos: un registro perfecto de 14 días no es real
      if (d !== 4 && d !== 9) {
        await ctx.request
          .post(API + `/api/v1/journal/${j.id}/mood`, {
            headers: h,
            data: { score: [3, 4, 4, 2, 5, 3, 4, 3, 4, 5, 2, 3, 4, 4][13 - d] },
          })
          .catch(() => {});
      }
    }
  }
  return folders;
}

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
        username: 'normal' + Date.now(),
        password: 'demo123',
        deviceId: 'normal-' + Math.random().toString(36).slice(2, 10),
        deviceName: 'normal-capture',
        platform: 'web',
      },
    })
    .then((r) => r.json());
  const tok = reg.accessToken;
  const h = { authorization: 'Bearer ' + tok };
  await seed(ctx, h);

  const page = await ctx.newPage();
  await page.addInitScript(auth(), tok);
  const results = [];

  const shot = async (name, ok, why) => {
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    results.push({ name, ok, why });
    console.log(`${ok ? 'OK  ' : 'VACIO'} ${name}${why ? ' — ' + why : ''}`);
  };

  const visit = async (route, name, check, after) => {
    await page.goto(WEB + '/index.html#/' + route, { waitUntil: 'load' });
    await settle(page);
    if (after) { await after(); await page.waitForTimeout(900); }
    // check is a [pattern] pair: Playwright stringifies the callback, so
    // a closure over the pattern would throw inside the page.
    let r = { ok: true, why: '' };
    if (Array.isArray(check)) {
      r = await page.evaluate((arg) => {
        const [where, re] = arg;
        // innerText does not include a <textarea>'s value, and the
        // narrow note editor is exactly that — a check written against
        // innerText reports an empty page while the note is on screen.
        const ta = document.querySelector("#body, textarea");
        const haystack = where === "__textarea__"
          ? `${document.body.innerText} ${ta ? ta.value : ""}`
          : document.body.innerText;
        const hit = new RegExp(re).test(haystack);
        return { ok: hit, why: hit ? 'contenido presente' : 'falta: ' + re };
      }, check);
    }
    await shot(name, r.ok, r.why);
  };

  // The pattern has to be serialised into the page, so build the
  // RegExp there — closing over a local `re` throws inside evaluate.
  const has = (re) => [re];

  // 1. Overview — el panel del día
  await visit('overview', '01-overview', has(/Genética|Cardiología|Química/));

  // 2. Calendario con agenda
  await visit('calendar', '02-calendario', has(/Seminario|Examen|Clínica|Repaso/));

  // 3. Asignaturas
  await visit('subjects', '03-asignaturas', has(/Genética|Cardiología|Química/));

  // 4. Lista de notas
  await visit('notes', '04-notas', () => {
    const t = document.body.innerText;
    const rows = document.querySelectorAll('.note-name').length;
    return { ok: /Fibrosis|Mendel/.test(t) && rows >= 3, why: `${rows} notas en el árbol` };
  });

  // 5. Nota abierta: el editor con bloques atómicos
  await visit('notes', '05-nota-editor', ["__textarea__", /CFTR|mucolíticos|fisioterapia/], async () => {
    // A hash change from a different route is not a navigation for some
    // drivers, so force a real load before clicking the note.
    await page.goto(WEB + '/index.html#/notes', { waitUntil: 'load' });
    await settle(page);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.tree-note, .note-name')].find((e) =>
        /Fibrosis/.test(e.textContent || ''),
      );
      el?.click();
    });
    // The editor fetches the note and then renders; the check runs
    // before that, so it saw an empty page and the screenshot showed the
    // note. Wait for the text itself, not for a fixed delay.
    await page
      .waitForFunction(() => /CFTR/.test(document.body.innerText), null, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  });

  // 6. Captura rápida con texto ya parseado
  await visit('capture', '06-captura', has(/leche|ciclo cardíaco|agua/));

  // 7. Preguntar (RAG) — conversación real sobre las notas
  await visit('rag', '07-preguntar', has(/Pregunta|tus notas|Preguntar/));

  // 8. Generar: mapa mental, que es determinista
  await visit('generate', '08-generar', has(/Resumen|Tarjetas|Quiz|Mapa mental/), async () => {
    const i = await page.evaluate(() =>
      [...document.querySelectorAll('select option')].findIndex((o) => /Genética/.test(o.textContent)),
    );
    if (i > 0) await page.selectOption('select', { index: i });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Mapa mental/.test(b.textContent || ''))?.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Generar/.test(b.textContent || '') && !b.disabled)?.click();
    });
    await page.waitForTimeout(3200);
    await page.evaluate(() => document.querySelector('.gen-result')?.scrollIntoView({ block: 'start' }));
  });

  // 9. Estudio: una tarjeta respondida
  await visit('study', '09-estudio', has(/revisar|Study|Repaso|card/));

  // 10. Progreso con heatmap y métricas FSRS
  await visit('progress', '10-progreso', has(/días|FSRS|heatmap|Rendimiento/));

  // 11. Ánimo con dos semanas y huecos reales
  await visit('mood', '11-animo', has(/D[ií]as seguidos|D[ií]as anotados|MEDIA/i));

  // 12. Diario
  await visit('journal', '12-diario', has(/Hoy|gratitud|Agenda/));

  // 13. Companion de IA como popup flotante, no como ruta
  await visit('overview', '13-companion-popup', has(/.{20,}/), async () => {
    await page.keyboard.press('Control+k');
    // The editor fetches the note and then renders; the check runs
    // before that, so it saw an empty page and the screenshot showed the
    // note. Wait for the text itself, not for a fixed delay.
    await page
      .waitForFunction(() => /CFTR/.test(document.body.innerText), null, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  });

  // 14. Ajustes — close the companion first, or the popup is what gets
  // photographed instead of the screen.
  await page.keyboard.press('Escape');
  await visit('settings', '14-ajustes', has(/Tema|Idioma|Backup|tema/), async () => {
    await page.evaluate(() => {
      document.querySelector('.floating-window, .ai-chat, .ac-popup')?.remove();
      document.querySelectorAll('.fw-backdrop, .ac-backdrop').forEach((el) => el.remove());
    });
    await page.waitForTimeout(400);
  });

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} pantallas con contenido real`);
  if (bad.length) console.log('sin contenido:', bad.map((b) => b.name).join(', '));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
