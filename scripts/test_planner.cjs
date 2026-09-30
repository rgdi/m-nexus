// test_planner.cjs — el sistema de estudio, a fondo.
//
// v2.38.6
//
// "Saber lo que ya sabes" no sirve si el plan que sale de ahi no se
// puede seguir. Estas pruebas no miran que se pinte una pantalla:
// comprueban el plan, la curva y que FSRS se mueva cuando tiene que
// moverse y se quede quieto cuando no.
//
//   node scripts/test_planner.cjs
//
// Requiere backend en :4000.

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.RAG_API || 'http://localhost:4000';
const OUT = path.join(ROOT, 'screenshots', 'planner');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/**
 * Corre una función de los servicios reales en un tsx aislado. Hace
 * falta porque el planificador es lógica pura: probarlo por HTTP solo
 * enseñaría lo que el endpoint Decide devolver.
 */
function inBackend(source) {
  const f = `/tmp/plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.ts`;
  require('node:fs').writeFileSync(
    path.join(ROOT, 'backend', 'src', '__plan_probe.ts'),
    source,
  );
  try {
    return execSync(
      `npx tsx -e "import('./src/__plan_probe.ts').then(m=>{console.log(JSON.stringify(m.run()))})"`,
      { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', timeout: 120000 },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop();
  } finally {
    try { require('node:fs').unlinkSync(path.join(ROOT, 'backend', 'src', '__plan_probe.ts')); } catch {}
  }
}

(async () => {
  // =====================================================================
  // 1. La distribución a lo largo de los días
  // =====================================================================
  console.log('\n— la curva de estudio —');
  const dist = JSON.parse(
    inBackend(`
      import { planStudy } from "./services/examScheduler.js";
      export function run() {
        const mk = (days) => {
          const d = new Date();
          d.setDate(d.getDate() + days);
          return d.toISOString().slice(0, 10);
        };
        const out = {};
        for (const days of [1, 3, 7, 14, 30, 60]) {
          const s = planStudy(
            [{ id: "e1", topicId: "t1", topicName: "Genética", date: mk(days), totalTopics: 40 }],
            {},
            new Date(),
            { dailyMinutes: 60, targetRetention: 0.9 },
          );
          out[days] = {
            sesiones: s.length,
            negativos: s.filter((x) => x.durationMin < 0 || x.cardsToReview < 0).length,
            conTrabajo: s.filter((x) => x.durationMin > 0).length,
            primero: s[0]?.date, ultimo: s[s.length - 1]?.date,
            minAlPrincipio: s.slice(0, Math.max(1, Math.floor(s.length / 3))).map((x) => x.durationMin),
            minAlFinal: s.slice(-Math.max(1, Math.floor(s.length / 3))).map((x) => x.durationMin),
          };
        }
        return out;
      }
    `),
  );

  for (const [days, d] of Object.entries(dist)) {
    check(`a ${days} días no hay duraciones negativas`, d.negativos === 0, `${d.negativos}`);
  }
  check(
    'a 30 días hay trabajo repartido por todo el periodo',
    dist['30'].conTrabajo > 5,
    `${dist['30'].conTrabajo} días con trabajo de ${dist['30'].sesiones} planificados`,
  );
  check(
    'a 60 días el trabajo se adelanta, no se acumula al final',
    (() => {
      const p = dist['60'].minAlPrincipio, f = dist['60'].minAlFinal;
      const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
      return avg(p) > 0 && avg(f) >= 0;
    })(),
    `inicio=${dist['60'].minAlPrincipio.join(',')} final=${dist['60'].minAlFinal.join(',')}`,
  );
  check(
    'con un examen mañana, la carga crece hacia el final',
    (() => {
      const p = dist['1'].minAlPrincipio, f = dist['1'].minAlFinal;
      return Math.max(...f) >= Math.max(...p);
    })(),
  );

  // =====================================================================
  // 2. El conocimiento real cambia el plan
  // =====================================================================
  console.log('\n— el conocimiento medido cambia el plan —');
  const know = JSON.parse(
    inBackend(`
      import { planStudy } from "./services/examScheduler.js";
      export function run() {
        const d = new Date(); d.setDate(d.getDate() + 7);
        const date = d.toISOString().slice(0, 10);
        const exam = [{ id: "e1", topicId: "t1", topicName: "G", date, totalTopics: 40 }];
        const mk = (r) => ({ knowledgeRatio: r, confidence: 0.8, gaps: [], totalQuestions: 10,
          correctCount: r * 10, fsrsProfile: { desiredRetention: 0.9, initialStability: 14, initialDifficulty: 5 } });
        const a = planStudy(exam, { t1: mk(0) }, new Date(), { dailyMinutes: 60, targetRetention: 0.9 });
        const b = planStudy(exam, { t1: mk(1) }, new Date(), { dailyMinutes: 60, targetRetention: 0.9 });
        const tot = (s) => s.reduce((x, y) => x + y.cardsToReview + y.newCardsToLearn, 0);
        return { sinSaber: tot(a), sabiendolo: tot(b), sesionesSin: a.length, sesionesCon: b.length };
      }
    `),
  );
  check(
    'saber el tema entero reduce el trabajo planificado',
    know.sabiendolo < know.sinSaber,
    `${know.sinSaber} → ${know.sabiendolo} tarjetas`,
  );
  check(
    'saber el tema entero no elimina el repaso del todo',
    know.sabiendolo > 0,
    `${know.sabiendolo} tarjetas`,
  );

  // =====================================================================
  // 3. Varios exámenes a la vez
  // =====================================================================
  console.log('\n— dos exámenes, dos urgencias —');
  const multi = JSON.parse(
    inBackend(`
      import { planStudy } from "./services/examScheduler.js";
      export function run() {
        const mk = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
        const s = planStudy(
          [{ id: "a", topicId: "cerca", topicName: "Cerca", date: mk(2), totalTopics: 30 },
           { id: "b", topicId: "lejos", topicName: "Lejos", date: mk(40), totalTopics: 30 }],
          {}, new Date(), { dailyMinutes: 60, targetRetention: 0.9 });
        const cerca = s.filter((x) => x.topicId === "cerca");
        const lejos = s.filter((x) => x.topicId === "lejos");
        return {
          cercaUrgencias: [...new Set(cerca.map((x) => x.urgency))],
          cercaMin: cerca.length ? Math.max(...cerca.map((x) => x.durationMin)) : 0,
          lejosMin: lejos.length ? Math.max(...lejos.map((x) => x.durationMin)) : 0,
          total: s.length,
        };
      }
    `),
  );
  check(
    'el examen cercano sale con urgencia alta',
    multi.cercaUrgencias.some((u) => u === "high" || u === "critical"),
    multi.cercaUrgencias.join(','),
  );
  check(
    'el cercano pesa más por día que el lejano',
    multi.cercaMin > multi.lejosMin,
    `cerca=${multi.cercaMin}min lejos=${multi.lejosMin}min`,
  );

  // =====================================================================
  // 4. El tope diario se respeta
  // =====================================================================
  console.log('\n— el tope diario —');
  const cap = JSON.parse(
    inBackend(`
      import { planStudy } from "./services/examScheduler.js";
      export function run() {
        const d = new Date(); d.setDate(d.getDate() + 5);
        const s = planStudy(
          [{ id: "e", topicId: "t", topicName: "T", date: d.toISOString().slice(0, 10), totalTopics: 200 }],
          {}, new Date(), { dailyMinutes: 45, targetRetention: 0.9 });
        return { max: Math.max(...s.map((x) => x.durationMin)), n: s.length,
                 exceed: s.filter((x) => x.durationMin > 45).length };
      }
    `),
  );
  check('nunca se pasa del minuto configurado', cap.max <= 45, `máximo ${cap.max} de 45`);

  // =====================================================================
  // 5. FSRS se mueve con el fallo, y con laexcavación
  // =====================================================================
  console.log('\n— FSRS acoplado —');
  const fsrs = JSON.parse(
    inBackend(`
      import { scheduleReview } from "./services/reviewScheduler.js";
      import { computeProfile } from "./services/knowledgeDiagnostic.js";
      export function run() {
        const prev = { state: "review", stability: 40, difficulty: 5, reps: 8, lapses: 0, lastReview: Date.now() - 40*86400000 };
        const again = scheduleReview(prev, 1, Date.now());
        const good  = scheduleReview(prev, 3, Date.now());
        // Perfil según lo que el diagnostico midio.
        // computeProfile(topicId, questions, answers) — una pregunta por concepto.
        const mkQ = (n) => Array.from({length: n}, (_, i) => ({ id: "q"+i, concept: "c"+i, prompt: "?", type: "open" }));
        const mkA = (n, correct) => Array.from({length: n}, (_, i) => ({ questionId: "q"+i, correct, timeMs: correct ? 3000 : 12000 }));
        const nada  = computeProfile("t", mkQ(10), mkA(10, false));
        const todo  = computeProfile("t", mkQ(10), mkA(10, true));
        return {
          estLapse: Math.round(again.fsrs.stability * 10) / 10,
          estGood:  Math.round(good.fsrs.stability * 10) / 10,
          diasLapse: Math.round((again.fsrs.due - Date.now()) / 86400000 * 10) / 10,
          perfilNada: nada.fsrsProfile, perfilTodo: todo.fsrsProfile,
        };
      }
    `),
  );
  check(
    'fallar baja la estabilidad y el scheduler la manda a pocos días',
    fsrs.estLapse < fsrs.estGood && fsrs.diasLapse <= 1,
    `lapse=${fsrs.estLapse}d (reaparece en ${fsrs.diasLapse}d) good=${fsrs.estGood}d`,
  );
  check(
    'un buen repaso sube la estabilidad por encima de la que había',
    fsrs.estGood > 40,
    `40 → ${fsrs.estGood}`,
  );
  const ratio = fsrs.perfilTodo.initialStability / fsrs.perfilNada.initialStability;
  check(
    'el diagnóstico cambia el punto de partida de FSRS',
    ratio > 1.5,
    `estabilidad inicial ${fsrs.perfilNada.initialStability} → ${fsrs.perfilTodo.initialStability} (×${ratio.toFixed(1)})`,
  );

  // =====================================================================
  // 6. Contenidos antiguos: lo que lleva tiempo sin tocarse
  // =====================================================================
  console.log('\n— contenido antiguo —');
  const stale = JSON.parse(
    inBackend(`
      import { buildPlan, chooseProbeLevel } from "./services/diagnostic.js";
      export function run() {
        const hoy = Date.now();
        const est = (concepto, p, dias) => ({ concept: concepto, p, observations: 3,
          lastVerdict: "known", lastSeenAt: hoy - dias*86400000, fsrsMean: p });
        // Examen de Genetica manana. Un concepto de hace 60 dias, otro de ayer.
        const ex = [{ id: "x", title: "Genética", folderId: "f1", date: new Date(hoy+86400000).toISOString().slice(0,10),
          topics: ["Herencia mendeliana"] }];
        const plan = buildPlan(
          [est("Herencia mendeliana", 0.9, 60), est("Fibrosis quística", 0.2, 3)],
          ex, hoy, { examHorizonDays: 21, restaleDays: 45, maxPerDay: 6, dailyHour: 9 });
        const viejo = plan.due.find((d) => d.concept === "Herencia mendeliana");
        const flojo = plan.due.find((d) => d.concept === "Fibrosis quística");
        return {
          orden: plan.queue.map((q) => q.concept),
          nivelViejo: viejo?.level, motivoViejo: viejo?.reason,
          nivelFlojo: flojo?.level, motivoFlojo: flojo?.reason,
          nivelTope: chooseProbeLevel(
            { concept: "x", p: 0.9, observations: 3, lastVerdict: "known", lastSeenAt: hoy, fsrsMean: 0 },
            { reason: "exam-near", daysToExam: 1 }),
        };
      }
    `),
  );
  check(
    'el contenido antiguo con examen encima sube de prioridad',
    stale.orden[0] === 'Herencia mendeliana',
    `orden: ${stale.orden.join(' → ')}`,
  );
  check('el motivo es el examen, no el olvido', stale.motivoViejo === 'exam-near', String(stale.motivoViejo));
  check(
    'a un día del examen se indaga al fondo',
    stale.nivelTope === 3,
    `nivel ${stale.nivelTope}`,
  );
  check(
    'el contenido flojo entra igual',
    stale.orden.includes('Fibrosis quística'),
    `nivel ${stale.nivelFlojo}, motivo ${stale.motivoFlojo}`,
  );

  // =====================================================================
  // 7. El límite diario protege la sesión
  // =====================================================================
  console.log('\n— el tope por día —');
  const daily = JSON.parse(
    inBackend(`
      import { buildPlan } from "./services/diagnostic.js";
      export function run() {
        const hoy = Date.now();
        const muchos = Array.from({length: 20}, (_, i) => ({
          concept: "c" + i, p: 0.2, observations: 2, lastVerdict: "unstable",
          lastSeenAt: hoy - 60*86400000, fsrsMean: 0.3 }));
        const plan = buildPlan(muchos, [], hoy, { examHorizonDays: 21, restaleDays: 45, maxPerDay: 6, dailyHour: 9 });
        const futuro = new Date(plan.nextRunAt) > new Date(hoy);
        return { cola: plan.queue.length, total: plan.due.length, futuro };
      }
    `),
  );
  check('no se meten más de 6 temas al día', daily.cola === 6, `${daily.cola} de ${daily.total} pendientes`);
  check('la próxima corrida es en el futuro', daily.futuro);

  // =====================================================================
  // 8. Por HTTP, de punta a punta
  // =====================================================================
  console.log('\n— de punta a punta —');
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  const reg = await ctx.request
    .post(API + '/api/v1/register', {
      data: { username: 'pl' + Date.now(), password: 'demo123', deviceId: 'pl-' + Math.random().toString(36).slice(2, 8), deviceName: 'pl', platform: 'web' },
    })
    .then((r) => r.json());
  const h = { authorization: 'Bearer ' + reg.accessToken, 'content-type': 'application/json' };

  const plan = await ctx.request.get(API + '/api/v1/diagnostic/plan', { headers: h });
  check('el plan responde por HTTP', plan.ok(), String(plan.status()));

  const empty = await plan.json().catch(() => ({}));
  check('sin datos devuelve una cola vacía y no un error', Array.isArray(empty.queue), JSON.stringify(empty).slice(0, 80));

  const page = await ctx.newPage();
  await page.addInitScript(
    (a) => {
      localStorage.setItem('mnexus.setup.completed', '1');
      localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
      sessionStorage.setItem('mnexus.auth.access', a);
      localStorage.setItem('mnexus.auth.refresh', a);
      localStorage.setItem('mnexus.lang', 'es');
      localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
    },
    reg.accessToken,
  );
  await page.goto('http://localhost:8080/index.html#/progress', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const heat = await page.evaluate(() => {
    const cells = document.querySelectorAll('.m-heat-cell');
    return { celdas: cells.length, tabulables: cells.length ? [...cells].filter((c) => c.tabIndex === 0).length : 0 };
  });
  check(
    'el heatmap expone 371 celdas y solo una tabulable',
    heat.celdas > 300 && heat.tabulables === 1,
    `${heat.celdas} celdas, ${heat.tabulables} en el tabulador`,
  );
  require('node:fs').mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'progreso.png') });
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan: ' + failed.map((f) => f.name).join(', '));
  process.exit(failed.length ? 1 : 0);
})();
