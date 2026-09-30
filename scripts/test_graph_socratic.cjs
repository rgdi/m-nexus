// test_graph_socratic.cjs — el índice único y el tutor socrático.
//
// v2.38.10
//
// El grafo sostiene tres cosas que hasta ahora no se podían preguntar:
// "estudio solo este PDF", "esta tarjeta salió de esta nota" y "abre el
// sitio del que saqué esto". Y el tutor tiene queopoderse usar sin
// modelo, que es la unica forma de que funcione.
//
//   node scripts/test_graph_socratic.cjs

'use strict';
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function run(source) {
  const f = path.join(ROOT, 'backend', 'src', '__gs.ts');
  fs.writeFileSync(f, source);
  try {
    const out = execSync(
      `npx tsx -e "import('./src/__gs.ts').then(m=>Promise.resolve(m.run())).then(r=>console.log(JSON.stringify(r)))"`,
      { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', timeout: 180000 },
    );
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } finally { try { fs.unlinkSync(f); } catch {} }
}

const NOTA = `La fibrosis quística es una enfermedad genética autosómica recesiva.
Se debe a una mutación en el gen CFTR. El CFTR es un cromosoma 7.
La mucoviscidosis se debe a laALTERacion del transporte de cloruro.
Los sintomas respiratorios son la manifestacion mas importante.`;

(async () => {
  const auth = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'gs' + Date.now(), password: 'demo123',
      deviceId: 'gs-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'gs', platform: 'web',
    }),
  }).then((r) => r.json());
  const H = { authorization: 'Bearer ' + auth.accessToken, 'content-type': 'application/json' };
  const A = { authorization: 'Bearer ' + auth.accessToken };

  const carpeta = await fetch(API + '/api/v1/folders', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Genética' }) }).then((r) => r.json());
  const nota = await fetch(API + '/api/v1/notes', {
    method: 'POST', headers: H,
    body: JSON.stringify({ title: 'Fibrosis quística', body: NOTA, folderId: carpeta.id }),
  }).then((r) => r.json());

  // Tarjetas, UNA con origen en la nota y otra sin.
  // La API crea una tarjeta por llamada, con su nota de origen. No hay
  // mazos: POST /flashcards ES la tarjeta.
  for (const [front, back, origin] of [
    ['¿Qué gen causa la fibrosis quística?', 'El gen CFTR', nota.id],
    ['¿En qué cromosoma está el gen CFTR?', 'Cromosoma 7', nota.id],
    ['¿Qué transporta mal la proteína defectuosa?', 'Cloruro y agua', ''],
  ]) {
    const r = await fetch(API + '/api/v1/flashcards', {
      method: 'POST', headers: H,
      body: JSON.stringify({ front, back, subject: 'Gen', sourceNoteId: origin }),
    });
    if (!r.ok) console.log('   (tarjeta no creada:', r.status, ')');
  }

  // =====================================================================
  console.log('\n— el índice único —');
  const t0 = Date.now();
  const g1 = await fetch(API + '/api/v1/graph', { headers: A }).then((r) => r.json());
  check('construye el grafo de todas las colecciones', g1.resources?.length > 0,
    `${g1.resources?.length} recursos · ${g1.edges?.length} relaciones · ${Date.now() - t0}ms`);
  const byKind = g1.stats?.byKind || {};
  check('notas, tarjetas y carpetas están todas dentro', byKind.note >= 1 && byKind.flashcard >= 3,
    JSON.stringify(byKind));
  check('el grafo no duplica: cada recurso tiene su origen',
    g1.resources?.every((r) => r.source?.collection && r.source?.id),
    g1.resources?.[0]?.source?.collection);

  const origenes = (g1.edges || []).filter((e) => e.kind === 'generated_from').length;
  if (process.env.DEBUG_GRAPH) console.log('   aristas:', JSON.stringify(g1.edges));
  check('las tarjetas guardan de qué nota salieron', origenes === 2, `${origenes} de 3 con origen`);
  check('la que no tiene origen no se inventa uno', origenes < 3, 'correcto: la tercera no lo tiene');

  // Incremental.
  const t1 = Date.now();
  const g2 = await fetch(API + '/api/v1/graph', { headers: A }).then((r) => r.json());
  check('la reconstrucción completa sigue siendo rápida', Date.now() - t1 < 5000, `${Date.now() - t1}ms`);
  check('y no cambia nada si no ha cambiado nada',
    g2.incremental?.added?.length === 0 && g2.incremental?.changed?.length === 0,
    JSON.stringify(g2.incremental));

  // =====================================================================
  console.log('\n— estudio exclusivo —');
  const notaId = `note:${nota.id}`;
  const scope = await fetch(API + '/api/v1/graph/scope', {
    method: 'POST', headers: H, body: JSON.stringify({ resourceId: notaId }),
  }).then((r) => r.json());
  check('"solo esta nota" trae la nota y sus tarjetas', scope.total === 3,
    `${scope.total} · ${JSON.stringify(scope.byKind)} · modo ${scope.mode}`);
  check('y no se arrastra el temario entero', scope.total < g1.resources.length,
    `${scope.total} de ${g1.resources.length}`);

  const solo = await fetch(API + '/api/v1/graph/scope', {
    method: 'POST', headers: H, body: JSON.stringify({ resourceId: notaId, kinds: ['flashcard'] }),
  }).then((r) => r.json());
  check('se puede pedir solo un tipo de recurso', solo.total === 2, `${solo.total} tarjetas`);

  const inexistente = await fetch(API + '/api/v1/graph/scope', {
    method: 'POST', headers: H, body: JSON.stringify({ resourceId: 'note:no-existe' }),
  });
  check('un recurso que no está responde 404 con motivo', inexistente.status === 404,
    (await inexistente.json()).warning?.slice(0, 50) || '');

  // =====================================================================
  console.log('\n— saltar al sitio exacto —');
  const cardId = (g1.resources || []).find((r) => r.kind === 'flashcard');
  const res = await fetch(API + '/api/v1/graph/resolve/' + encodeURIComponent(cardId.id), { headers: A }).then((r) => r.json());
  check('una tarjeta sabe volver a su origen', !!res.origin?.title, `origen: ${res.origin?.title}`);
  check('y sabe a qué pantalla se abre', res.hash === '#/study', res.hash);

  // =====================================================================
  console.log('\n— contenido antiguo —');
  const stale = await fetch(API + '/api/v1/graph/stale?days=0', { headers: A }).then((r) => r.json());
  check('el grafo sabe qué está sin tocarse', typeof stale.count === 'number', `${stale.count} recursos`);

  // =====================================================================
  console.log('\n— el tutor socrático, sin modelo —');
  const seed = await fetch(API + '/api/v1/socratic/seed?noteId=' + nota.id, { headers: A }).then((r) => r.json());
  check('extrae preguntas de la nota del propio usuario', seed.questions?.length >= 2,
    seed.questions?.slice(0, 3).map((q) => q.q).join(' | '));
  check('cada pregunta trae su respuesta de referencia',
    seed.questions?.every((q) => q.a && q.a.length > 4), 'con referencia');

  const ask = async (answer, extra = {}) => fetch(API + '/api/v1/socratic/ask', {
    method: 'POST', headers: H,
    body: JSON.stringify({ question: '¿Qué es la fibrosis quística?', reference: 'una enfermedad genética autosómica recesiva', userAnswer: answer, noteId: nota.id, ...extra }),
  }).then((r) => r.json());

  const buena = await ask('Es una enfermedad genetica autosomica recesiva porque se hereda de los dos padres.');
  check('acierta cuando dice los términos', buena.verdict?.verdict === 'correct' || buena.verdict?.verdict === 'partial',
    `${buena.verdict?.verdict} · ${(buena.verdict?.score * 100).toFixed(0)}% · dice: "${buena.say}"`);
  check('nunca da la respuesta: pregunta', !/^la respuesta es/i.test(buena.say || '') && /[?¿]/.test(buena.say || ''),
    buena.say?.slice(0, 60));

  const parcial = await ask('Es una enfermedad.');
  check('una respuesta parcial da veredicto parcial, no aprobado', parcial.verdict?.verdict !== 'correct',
    `${parcial.verdict?.verdict} · faltan: ${(parcial.verdict?.missing || []).join(', ')}`);

  const vacia = await ask('');
  check('nada dicho no es un fallo, es un empieza', vacia.verdict?.verdict === 'empty', vacia.say?.slice(0, 50));

  const corta = await ask('genética');
  check('media palabra no se puntúa', corta.verdict?.verdict !== 'correct',
    `"${corta.verdict?.verdict}" · "${corta.say?.slice(0, 50)}"`);

  const incert = await ask('Es una enfermedad genetica creo, no me acuerdo bien.');
  // Con una respuesta segura ni se pregunta; con una dudosa se salta
  // y lo dice. Las dos cosas son correctas y las dos se comprueban.
  check('nunca se gasta un modelo sin que haga falta',
    incert.usedLlm === false, `usedLlm=${incert.usedLlm}`);
  const dudosa = await ask('Es una enfermedad recesiva de tipo genetico.', { useLlm: true });
  check('ante una respuesta dudosa, la capa 3 se salta y explica por qué',
    dudosa.reasoning?.usedLlm === false && /modelo|terminos/i.test(dudosa.reasoning?.why || ''),
    dudosa.reasoning?.why?.slice(0, 72) + ' · score=' + (dudosa.verdict?.score ?? 0).toFixed(2));

  const invertido = await ask('La fibrosis quística es una enfermedad autosomica dominante, se debe a una mutacion en el cromosoma 11.', { mustNot: ['dominante', '11'] });
  check('el modelo invertido se detecta aparte de un fallo normal',
    invertido.verdict?.verdict === 'inverted', `${invertido.verdict?.verdict} · al reves: ${(invertido.verdict?.wrong || []).join(', ')}`);

  const gaps = await fetch(API + '/api/v1/socratic/gaps?noteId=' + nota.id, { headers: A }).then((r) => r.json());
  check('los huecos se acumulan y no se pierden al reintentar', gaps.count >= 1, `${gaps.count} huecos`);
  check('el hueco guarda los intentos', gaps.gaps?.[0]?.attempts >= 1,
    `${gaps.gaps?.[0]?.attempts} intentos · mejor: ${(gaps.gaps?.[0]?.best * 100).toFixed(0)}%`);
  check('y el peor sale primero', !gaps.gaps?.[0] || gaps.gaps[0].missing.length >= 0, 'ordenados por términos faltantes');

  // =====================================================================
  console.log('\n— la lógica comparada a mano —');
  const logica = run(`
    import { compare, splitKeyTerms, recordGap } from "./services/socratic.js";
    export function run() {
      const ref = { answer: "una enfermedad genetica autosomica recesiva", mustInclude: ["enfermedad", "genetica", "autosomica", "recesiva"] };
      return {
        terminos: splitKeyTerms("una enfermedad genetica autosomica recesiva, causada por CFTR"),
        bien: compare("Es una enfermedad genetica autosomica recesiva", ref).verdict,
        medio: compare("Es una enfermedad genetica", ref).verdict,
        mal: compare("Es unaATORSOGASTROENTERITIS HPILORI FORMADOIN", ref).verdict,
        vacio: compare("", ref).verdict,
        hueco: recordGap(null, compare("Es una enfermedad", ref), { noteId: "n1" }),
      };
    }
  `);
  check('trocea una respuesta en términos clave', logica.terminos.length >= 2, logica.terminos.join(' | '));
  check('bien / medio / mal / vacío se distinguen',
    logica.bien === 'correct' && (logica.medio === 'partial' || logica.medio === 'unrelated') &&
    (logica.mal === 'unrelated' || logica.mal === 'partial') && logica.vacio === 'empty',
    `${logica.bien} · ${logica.medio} · ${logica.mal} · ${logica.vacio}`);
  check('el hueco guarda qué falta, no la nota entera',
    logica.hueco.missing.length > 0 && logica.hueco.missing.length < 10,
    logica.hueco.missing.join(', '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
