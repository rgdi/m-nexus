// capture_all.cjs — capturas de TODA la aplicación.
//
// v2.38.23. Una foto por pantalla, por tema y por tamaño, con datos
// de verdad.
//
//   node scripts/capture_all.cjs [filtro-de-ruta]
//
// Salida: screenshots/todas/<tema>-<dispositivo>-<ruta>.png
//
// Por qué una por tema y no solo claro: el modo oscuro es un bloque
// distinto del CSS, y lo que se ve en uno no dice nada del otro. Ya
// pasó con el desplegable de notificaciones, que es claro en los dos.
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.WEB || 'http://localhost:8080';
const API = process.env.API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'todas');
const CHROME = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';
const FILTRO = process.argv[2] || '';

// Rutas que se pueden capturar sin montage: las que son herramientas
// de una vez (login, simulador) se dejan fuera porque no son "la app"
// en uso, y una captura de ellas no dice nada del diseño.
const RUTAS = [
  'overview', 'notes', 'study', 'progress', 'calendar', 'subjects',
  'capture', 'rag', 'generate', 'probe', 'mood', 'occlusion',
  'journal', 'pdf', 'kg', 'todos', 'cluster', 'ai', 'diagnostic',
  'settings', 'v232',
];

const DISPOSITIVOS = [
  { k: 'movil', w: 390, h: 844, dsf: 3, touch: true },
  { k: 'tablet', w: 820, h: 1180, dsf: 2, touch: true },
  { k: 'pc', w: 1440, h: 900, dsf: 2, touch: false },
];

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch({
    executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await br.newContext();
  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: {
      username: 'tod' + Date.now(), password: 'demo123',
      deviceId: 'tod-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'todas', platform: 'web',
    },
  }).then((r) => r.json());
  const tok = reg.accessToken;
  const h = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

  /* ── Datos ────────────────────────────────────────────────────────
   * Una pantalla vacía no enseña el diseño: enseña un hueco. Se
   *_siembran_ las tres notas, un mazo, unas tareas y una semana de
   * repaso, que es lo que ve alguien que lleva una semana usando la
   * aplicación. */
  const carpeta = await ctx.request.post(API + '/api/v1/folders', {
    headers: h, data: { name: 'Cardiología' },
  }).then((r) => r.json());
  const carpeta2 = await ctx.request.post(API + '/api/v1/folders', {
    headers: h, data: { name: 'Anatomía' },
  }).then((r) => r.json());

  const NOTAS = [
    ['Sistema de conducción cardíaca',
     'El impulso eléctrico nace en el ==nodo sinoauricular== y baja por el ==haz de His== hacia el ápex.\n\n!!Las aurículas van antes que los ventrículos!!, y por eso la contracción auricular completa el llenado.\n\nVer también: [[Ciclo cardíaco]] y [[Presión arterial]].\n\n#cardio #anatomía',
     carpeta.id],
    ['Ciclo cardíaco',
     'La sístole ventricular expulsa sangre hacia la aorta y la arteria pulmonar.\n\nLa aorta tiene elasticidad para absorber el pico de presión sistólico.\n\nVuelve a [[Sistema de conducción cardíaca]].',
     carpeta.id],
    ['Presión arterial',
     'La presión arterial es el producto del gasto cardíaco por la resistencia vascular.\n\n#cardio',
     carpeta.id],
    ['Cráneo: bones of the skull',
     'Frontal, parietal, temporal, occipital, esfenoides y etmoides.\n\nLa sutura sagital separa los dos parietales.\n\n#anatomía',
     carpeta2.id],
    ['Paracetamol',
     'Dosis adultos: 500 mg cada 6 horas. Máximo 4 g al día.\n\nNo combinar con ibuprofeno de forma sistemática.',
     null],
  ];
  const notasCreadas = [];
  for (const [title, body, folderId] of NOTAS) {
    const n = await ctx.request.post(API + '/api/v1/notes', {
      headers: h, data: { title, body, folderId, tags: [] },
    }).then((r) => r.json());
    notasCreadas.push(n);
  }

  const notaPrincipal = notasCreadas[0]?.id;
  for (let i = 0; i < 14; i++) {
    await ctx.request.post(API + '/api/v1/flashcards', {
      headers: h, data: {
        noteId: notaPrincipal,
        front: `¿Cuál es la pregunta ${i + 1} del sistema de conducción?`,
        back: 'Una respuesta de longitud parecida para que se vea el texto real en la tarjeta.',
      },
    }).catch(() => {});
  }
  // Repasar unas cuantas, para que el FSRS tenga intervalos de verdad.
  const deck = await ctx.request.get(API + '/api/v1/flashcards/filter?noteId=' + notaPrincipal, { headers: h })
    .then((r) => r.json()).catch(() => []);
  for (const c of (Array.isArray(deck) ? deck : []).slice(0, 9)) {
    await ctx.request.post(API + `/api/v1/flashcards/${c.id}/review`, {
      headers: h, data: { rating: [2, 3, 3, 4, 3, 2, 4, 3, 3][Math.floor(Math.random() * 9)] },
    }).catch(() => {});
  }
  for (const t of ['Repasar el ciclo cardíaco', 'Comprar Anatomy Atlas', 'Llamar al laboratorio']) {
    await ctx.request.post(API + '/api/v1/tasks', { headers: h, data: { title: t, done: false } }).catch(() => {});
  }
  for (const s of ['cardio', 'anatomía', 'farmacología', 'histología']) {
    await ctx.request.post(API + '/api/v1/subjects', { headers: h, data: { name: s } }).catch(() => {});
  }
  for (let d = 0; d < 21; d++) {
    await ctx.request.post(API + '/api/v1/events', {
      headers: h,
      data: {
        title: 'Repaso ' + d, date: new Date(Date.now() + d * 86400000).toISOString().slice(0, 10),
        start: '09:00', end: '10:00', subject: 'cardio',
      },
    }).catch(() => {});
  }

  /* ── Capturas ─────────────────────────────────────────────────── */
  const rutas = FILTRO ? RUTAS.filter((r) => r.includes(FILTRO)) : RUTAS;
  const hechas = [];
  const problemas = [];

  for (const tema of ['light', 'dark']) {
    for (const d of DISPOSITIVOS) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: d.w, height: d.h });
      if (d.touch) {
        await ctx.addInitScript(() => {
          Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        });
      }
      if (d.k === 'tablet') {
        // Un iPad se identifica por user-agent de Mac con puntos
        // tactiles, no por el ancho: un portatil a 820 px no es un
        // iPad y el diseño NO es el mismo.
        await ctx.addInitScript((ua) => {
          Object.defineProperty(navigator, 'userAgent', { get: () => ua });
        }, IPAD_UA);
      }
      await p.addInitScript((cfg) => {
        localStorage.setItem('mnexus.setup.completed', '1');
        localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
        sessionStorage.setItem('mnexus.auth.access', cfg.tok);
        localStorage.setItem('mnexus.auth.refresh', cfg.tok);
        localStorage.setItem('mnexus.backend.url', cfg.api);
        localStorage.setItem('mnexus.theme', cfg.tema);
        localStorage.setItem('mnexus.lang', 'es');
        document.documentElement.setAttribute('data-theme', cfg.tema);
      }, { tok, api: API, tema });

      for (const r of rutas) {
        const errores = [];
        p.removeAllListeners('pageerror');
        p.on('pageerror', (e) => errores.push(String(e).split('\n')[0]));
        try {
          await p.goto(`${WEB}/index.html#/${r}`, { waitUntil: 'load', timeout: 20000 });
        } catch (e) {
          problemas.push(`${tema}/${d.k}/${r}: no cargó — ${String(e).split('\n')[0]}`);
          continue;
        }
        await p.waitForTimeout(1800);

        // En notas, abrir una de verdad: la lista en sí ya se capturó.
        if (r === 'notes') {
          await p.evaluate(() => {
            [...document.querySelectorAll('.doc-card, .note-name, [data-note-id]')]
              .find((e) => /conducción/i.test(e.textContent || ''))?.click();
          });
          await p.waitForTimeout(1400);
        }

        // La campana se abre sola y tapa media pantalla. Se cierra
        // antes de la foto, que es lo que ve la gente.
        await p.evaluate(() => {
          document.querySelectorAll('[data-dropdown],.notif-dropdown')
            .forEach((n) => { n.setAttribute('hidden', ''); n.style.setProperty('display', 'none', 'important'); });
        });
        await p.waitForTimeout(120);

        const archivo = path.join(OUT, `${tema}-${d.k}-${r}.png`);
        await p.screenshot({ path: archivo });
        // ¿Ha salido en blanco? Una captura vacía es peor que ninguna:
        // parece que la pantalla existe.
        const vacia = await p.evaluate(() => {
          const t = (document.body.innerText || '').trim();
          return t.length < 12;
        });
        if (vacia) problemas.push(`${tema}/${d.k}/${r}: la pantalla salió vacía`);
        if (errores.length) problemas.push(`${tema}/${d.k}/${r}: ${errores[0]}`);
        hechas.push(archivo);
      }
      await p.close();
    }
  }

  await br.close();
  console.log(`${hechas.length} capturas en screenshots/todas/`);
  if (problemas.length) {
    console.log(`\n${problemas.length} cosas que mirar:`);
    for (const x of problemas.slice(0, 24)) console.log('  - ' + x);
  } else {
    console.log('\nNinguna pantalla vacía y ningún error de consola.');
  }
})();
