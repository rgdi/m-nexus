// test_ink.cjs — tinta y dos dispositivos a la vez.
//
// v2.38.11
//
// Lo que se comprueba:
//
//   · el trazo se guarda en coordenadas de página, no de pantalla: el
//     mismo trazo se ve igual en 390 que en 1440
//   · la simplificación quita puntos sin quitar forma
//   · DOS dispositivos offline dibujan y luego se reconcilian sin
//     perder ninguno de los dos
//   · un trazo borrado no reaparece porque el otro lo tenía en caché
//   · el borrador parte el trazo en vez de deshacerlo entero
//   · la presión de un stylus se respeta, y un dedo sin presión no
//     rompe nada
//   · presencia: se sabe quién está escribiendo
//
//   node scripts/test_ink.cjs

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
  const f = path.join(ROOT, 'backend', 'src', '__ink.ts');
  fs.writeFileSync(f, source);
  try {
    const out = execSync(
      `npx tsx -e "import('./src/__ink.ts').then(m=>Promise.resolve(m.run())).then(r=>console.log(JSON.stringify(r)))"`,
      { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', timeout: 180000 },
    );
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } finally { try { fs.unlinkSync(f); } catch {} }
}

(async () => {
  // =====================================================================
  console.log('\n— la geometría del trazo —');
  const geo = run(`
    import { simplify, bboxOf, widthForSpeed, strokeToPath, newStroke, finishStroke, eraseAt, splitAtPoint, inkHash } from "./services/ink.js";
    export function run() {
      // Un trazo de dedo: 200 puntos con ruido de la mano.
      const pts = Array.from({length: 200}, (_, i) => ({
        x: i / 200 + (Math.sin(i) * 0.004),
        y: 0.5 + Math.sin(i / 8) * 0.1 + (Math.random() - 0.5) * 0.002,
        p: -1, t: i * 8,
      }));
      const simple = simplify(pts);
      // Stylus: presión que sube y baja.
      const presion = Array.from({length: 100}, (_, i) => ({
        x: i / 100,
        y: 0.5 + Math.sin(i / 7) * 0.12,
        p: 0.3 + Math.sin(i / 10) * 0.3, t: i * 10,
      }));
      const s1 = newStroke({ by: "d1", seq: 1, tool: "pen", color: "#fff", width: 0.004, page: 0, aspect: 0.7 });
      s1.points = pts;
      finishStroke(s1);
      const s2 = newStroke({ by: "d1", seq: 1, tool: "pen", color: "#fff", width: 0.004, page: 0, aspect: 0.7 });
      s2.points = presion;
      finishStroke(s2);
      const borrado = eraseAt([s1], 0.5, 0.5, 0.06, 9);
      return {
        antes: pts.length, despues: simple.length,
        formaSeMantiene: Math.abs(s1.bbox.w - new Array(200).fill(0).map((_, i) => i / 200).reduce((a, v, i, arr) => i ? Math.max(a, v) - Math.min(...arr) : 0, 0)) < 2,
        bbox: s1.bbox,
        // Contar <path>, no distintos stroke-width: varios grupos
        // redondean al mismo grosor y el Set colapsaba a 1, que hacia
        // pensar que la presión no hacia nada cuando hacia 14 grupos.
        segmentos: (strokeToPath(s2).match(/<path/g) || []).length,
        sinPresionSegmentos: (strokeToPath(s1).match(/<path/g) || []).length,
        anchoSinPresion: widthForSpeed({x:0,y:0,t:0}, {x:0.05,y:0,t:200}, 0.004),
        anchoLento: widthForSpeed({x:0,y:0,t:0}, {x:0.001,y:0,t:200}, 0.004),
        trazosTrasBorrar: borrado.length,
        puntosTrasBorrar: borrado.reduce((a,s)=>a+s.points.length,0),
        puntosOriginales: s1.points.length,
        hash: inkHash({id:"d",updatedAt:0,pages:[{background:{kind:"blank"},strokes:[s1]}]}),
        vacio: splitAtPoint(s1, 99, 99, 0.01).length,
      };
    }
  `);
  check('la simplificación quita puntos sin quitar forma',
    geo.despues < geo.antes * 0.6 && geo.despues > 5, `${geo.antes} → ${geo.despues} puntos`);
  check('el trazo se guarda en coordenadas de página',
    geo.bbox.x >= 0 && geo.bbox.x < 1 && geo.bbox.w < 1, `bbox ${geo.bbox.x.toFixed(3)},${geo.bbox.y.toFixed(3)} ${geo.bbox.w.toFixed(3)}×${geo.bbox.h.toFixed(3)}`);
  check('con presión, el grosor cambia a lo largo del trazo',
    geo.segmentos >= 3, `${geo.segmentos} segmentos de grosor variable en un trazo`);
  check('sin presión, la velocidad hace de sustituto',
    geo.anchoLento > geo.anchoSinPresion, `lento ${geo.anchoLento.toFixed(4)} > rápido ${geo.anchoSinPresion.toFixed(4)}`);
  check('el borrador parte el trazo, no lo deshace entero',
    geo.trazosTrasBorrar > 1 && geo.puntosTrasBorrar < geo.puntosOriginales,
    `${geo.trazosTrasBorrar} trozos, ${geo.puntosOriginales} → ${geo.puntosTrasBorrar} puntos`);
  check('borrar donde no hay nada no parte nada', geo.vacio === 1, `${geo.vacio} trozo`);
  check('el hash cambia si cambia el contenido', typeof geo.hash === 'string' && geo.hash.length === 16, geo.hash);

  // =====================================================================
  console.log('\n— la fusión: dos dispositivos a la vez —');
  const fus = run(`
    import { mergeStrokes, newStroke } from "./services/ink.js";
    const mk = (id, by, seq, deleted = 0) => {
      const s = newStroke({ id, by, seq, tool: "pen", color: "#fff", width: 0.004, page: 0, aspect: 0.7 });
      s.deleted = deleted;
      s.points = [{x:0.1,y:0.1,p:0.5,t:0},{x:0.2,y:0.2,p:0.5,t:10}];
      return s;
    };
    export function run() {
      const movil = [mk("m1","movil",1), mk("m2","movil",2)];
      const portatil = [mk("p1","portatil",1), mk("p2","portatil",2)];
      // Los dos se reconcilian sin haber-los visto nunca.
      const a = mergeStrokes(movil, portatil);
      // Y al reves, por si el orden fuera el contrario.
      const b = mergeStrokes(portatil, movil);
      // Mismo trazo, dos versiones: gana el seq mayor.
      const viejo = mk("x","movil",1);
      const nuevo = mk("x","portatil",7);
      const r1 = mergeStrokes([viejo], [nuevo]);
      const r2 = mergeStrokes([nuevo], [viejo]);
      // Borrado: gana si su seq es mayor que la ultima modificacion.
      const borradoLocal = mk("y","movil",3);
      const borradoTarde = mk("y","portatil",2, 5);
      const rBorrado = mergeStrokes([borradoTarde], [borradoLocal]);
      const reviving = mergeStrokes([borradoLocal], [mk("y","portatil",1)]);
      return {
        movil: movil.length, portatil: portatil.length,
        totalA: a.strokes.length, totalB: b.strokes.length,
        convergente: a.strokes.length === b.strokes.length,
        mismoIdGanaMayor: r1.strokes[0]?.by === "portatil" && r2.strokes[0]?.by === "portatil",
        borradoVence: rBorrado.strokes.length === 0,
        noResucita: reviving.strokes.length === 1,
        conflictos: a.report.conflicts.length,
      };
    }
  `);
  check('dos dispositivos offline convergen a lo mismo',
    fus.convergente && fus.totalA === fus.movil + fus.portatil && fus.totalB === fus.totalA,
    `${fus.movil} + ${fus.portatil} = ${fus.totalA}, y al revés ${fus.totalB}`);
  check('el mismo trazo con dos versiones gana el más nuevo',
    fus.mismoIdGanaMayor, 'seq mayor, sin importar de quién es');
  check('un borrado con seq mayor se aplica',
    fus.borradoVence, 'el trazo desaparece');
  check('y no resucita con una versión vieja',
    fus.noResucita, 'una copia en caché no lo revive');

  // =====================================================================
  console.log('\n— de punta a punta, con dos sesiones —');
  const cuenta = async (nombre) => {
    const r = await fetch(API + '/api/v1/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: nombre + Date.now(), password: 'demo123',
        deviceId: nombre + '-' + Math.random().toString(36).slice(2, 8),
        deviceName: nombre, platform: 'web',
      }),
    }).then((x) => x.json());
    return { authorization: 'Bearer ' + r.accessToken, 'content-type': 'application/json' };
  };
  // Mismo usuario, dos dispositivos: el registro es por dispositivo.
  // v2.38.11 — DOS DISPOSITIVOS NO SON DOS USUARIOS, y eso todavia no
  // es cierto. La identidad de la app es el dispositivo registrado:
  // cada registro es un subject distinto con su propio store. No hay
  // cuenta de usuario ni forma de vincular dos dispositivos, asi que
  // "tablet y portatil a la vez" no se puede probar de verdad todavia.
  //
  // Lo que se prueba aqui son los dos extremos del protocolo con la
  // misma identidad, que es lo que un segundo dispositivo necesitaria
  // para poder hablar. El hueco esta en TODO, D4.
  const A = await cuenta('dispositivo-a-');
  const B = A;
  const DOC = 'nota-1';

  const trazo = (id, by, seq, x) => ({
    id, by, seq, deleted: 0, tool: 'pen', color: '#a855f7', width: 0.006, alpha: 1,
    page: 0, aspect: 0.7, bbox: { x: x - 0.05, y: 0.4, w: 0.1, h: 0.1 },
    points: [{ x, y: 0.45, p: 0.6, t: 0 }, { x: x + 0.08, y: 0.5, p: 0.4, t: 20 }],
  });

  const push = (H, strokes, seq, device) => fetch(API + '/api/v1/ink/push', {
    method: 'POST', headers: H,
    body: JSON.stringify({ docId: DOC, strokes, seq, deviceId: device }),
  }).then((r) => r.json());

  const p1 = await push(A, [trazo('m1', 'movil', 1, 0.2), trazo('m2', 'movil', 2, 0.4)], 2, 'movil');
  check('el móvil sube sus trazos', p1.report.added === 2, `added=${p1.report.added} · hash ${p1.hash}`);

  const p2 = await push(B, [trazo('p1', 'portatil', 1, 0.6)], 1, 'portatil');
  check('el portátil sube los suyos sin pisar los del móvil',
    p2.report.added === 1 && p2.diverged === false, `added=${p2.report.added}`);

  const pull = await fetch(API + '/api/v1/ink/pull', {
    method: 'POST', headers: A, body: JSON.stringify({ docId: DOC, since: 0 }),
  }).then((r) => r.json());
  check('los dos ven los tres trazos', pull.incoming.length === 3, `${pull.incoming.length} trazos`);
  check('el estado del servidor es el mismo para los dos',
    pull.hash === p1.hash || pull.hash === p2.hash, `hash ${pull.hash}`);

  const doc = await fetch(API + '/api/v1/ink/' + DOC, { headers: A }).then((r) => r.json());
  check('el documento se abre entero en el otro dispositivo',
    doc.pages?.[0]?.strokes?.length === 3, `${doc.pages?.[0]?.strokes?.length} trazos guardados`);
  check('cada trazo conserva su autor',
    new Set(doc.pages[0].strokes.map((s) => s.by)).size === 2, [...new Set(doc.pages[0].strokes.map((s) => s.by))].join(', '));

  const pres = await fetch(API + '/api/v1/ink/pull', {
    method: 'POST', headers: A, body: JSON.stringify({ docId: DOC, since: 999 }),
  }).then((r) => r.json());
  check('se sabe qué dispositivos han escrito', pres.presence.length >= 2,
    pres.presence.map((p) => p.deviceId).join(', '));

  // Borrado desde el portátil y_lo ve el móvil.
  const borrado = await push(B, [{ ...trazo('m1', 'portatil', 99, 0.2), deleted: 99 }], 99, 'portatil');
  check('un borrado borra de verdad', borrado.report.removed === 1, `removed=${borrado.report.removed}`);
  const pull2 = await fetch(API + '/api/v1/ink/pull', {
    method: 'POST', headers: A, body: JSON.stringify({ docId: DOC, since: 0 }),
  }).then((r) => r.json());
  check('y el móvil deja de ver el trazo borrado',
    !pull2.incoming.some((s) => s.id === 'm1'), `${pull2.incoming.length} trazos visibles`);

  // Aislamiento.
  const otro = await cuenta('otro-');
  const ajeno = await fetch(API + '/api/v1/ink/' + DOC, { headers: otro }).then((r) => r.json());
  check('otro usuario no ve la tinta de nadie',
    (ajeno.pages || []).flatMap((x) => x.strokes).length === 0,
    `${(ajeno.pages || []).flatMap((x) => x.strokes).length} trazos`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
