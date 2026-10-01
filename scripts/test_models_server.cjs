// test_models_server.cjs — los modelos 3D, de un aparato a otro.
//
// v2.38.21. Cuatro preguntas:
//
//   1. ¿Sube un .glb de verdad y vuelve un id?
//   2. ¿Lo ve OTRO dispositivo con la misma sesión? (eso es sincronizar)
//   3. ¿Lo ve un usuario DISTINTO? No. Y no debe.
//   4. ¿Se puede borrar?
//
// Y una más que no estaba en la lista y sí importa:
//
//   5. Sin token, ¿se puede pedir el archivo por la ruta antigua?
//      `/models/user/<archivo>.glb` era pública en v2.16.0.
//
//   node scripts/test_models_server.cjs
'use strict';
// v2.38.21 — esto no necesita navegador: lo que se comprueba es del
// servidor, y meter un Chromium en medio solo añade formas de fallar
// que no son las que se quieren medir.
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://localhost:4000';
const GLB = '/tmp/caja.glb';

let ok = 0, fail = 0;
const chk = (name, good, why = '') => {
  if (good) { ok++; console.log(`  ok     ${name}${why ? ' — ' + why : ''}`); }
  else { fail++; console.log(`  FALLO  ${name}${why ? ' — ' + why : ''}`); }
};

async function registrar(tag) {
  const r = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: tag + Date.now(), password: 'demo123',
      deviceId: tag + '-' + Math.random().toString(36).slice(2, 9),
      deviceName: tag, platform: 'web',
    }),
  });
  return r.json();
}

function subir(tok, glbPath) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(glbPath)], { type: 'model/gltf-binary' }),
    path.basename(glbPath));
  fd.append('credit', 'caja de prueba');
  return fetch(API + '/api/v1/models/upload', {
    method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: fd,
  });
}

(async () => {
  if (!fs.existsSync(GLB)) {
    // El mismo .glb minimo que genera test_model_glb.cjs.
    const { execSync } = require('node:child_process');
    console.error(`Falta ${GLB}; generandolo`);
    execSync(`node -e "require('fs').writeFileSync('${GLB}', Buffer.from(''))"`);
  }
  if (!fs.existsSync(GLB)) {
    console.error(`Falta ${GLB}. Generalo con: python3 scripts/gen_glb.py`);
    process.exit(1);
  }
  const ana = await registrar('ma');
  const bea = await registrar('mb');
  chk('dos personas distintas registradas', !!ana.accessToken && !!bea.accessToken);

  /* ── 1. subir ─────────────────────────────────────────────────── */
  console.log('\n1. Subir un modelo');
  const r1 = await subir(ana.accessToken, GLB);
  const m = await r1.json().catch(() => ({}));
  chk('el modelo sube', r1.status === 201, `HTTP ${r1.status} ${JSON.stringify(m).slice(0, 70)}`);
  chk('devuelve un id con el que volver a pedirlo', /^mdl-/.test(m.id || ''), m.id);
  chk('y el tamaño real del archivo', m.bytes === fs.statSync(GLB).size, `${m.bytes} bytes`);

  /* ── 2. lo ve otro dispositivo ────────────────────────────────── */
  console.log('\n2. Lo ve otro dispositivo');
  // Un "segundo dispositivo" es otra petición con la MISMA sesión: es
  // exactamente lo que hace el otro móvil con la misma cuenta.
  const rOtro = await fetch(API + '/api/v1/models/' + m.id, {
    headers: { authorization: 'Bearer ' + ana.accessToken },
  });
  const buf = rOtro.ok ? Buffer.from(await rOtro.arrayBuffer()) : Buffer.alloc(0);
  const desdeOtro = {
    ok: buf.slice(0, 4).toString('ascii') === 'glTF',
    bytes: buf.length,
    cache: rOtro.headers.get('cache-control'),
  };
  chk('el mismo usuario lo pide y lo recibe',
    desdeOtro.ok && desdeOtro.bytes > 0,
    `${desdeOtro.bytes} bytes, cabecera "${desdeOtro.cache}"`);
  chk('y es un GLB de verdad, no cualquier cosa', desdeOtro.ok);

  /* ── 3. y otro usuario, no ────────────────────────────────────── */
  console.log('\n3. Y un usuario distinto, no');
  const rAjeno = await fetch(API + '/api/v1/models/' + m.id, {
    headers: { authorization: 'Bearer ' + bea.accessToken },
  });
  const deOtro = { status: rAjeno.status, body: (await rAjeno.text()).slice(0, 80) };
  chk('otro usuario NO puede bajarlo', deOtro.status === 404, `HTTP ${deOtro.status}`);

  const listaAjena = await fetch(API + '/api/v1/models', {
    headers: { authorization: 'Bearer ' + bea.accessToken },
  }).then((r) => r.json());
  chk('ni lo ve en su lista',
    !(listaAjena.models || []).some((x) => x.id === m.id),
    `ve ${(listaAjena.models || []).length} modelo(s), ninguno suyo`);

  const borraAjeno = await fetch(API + '/api/v1/models/' + m.id, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + bea.accessToken },
  });
  chk('ni puede borrarlo', borraAjeno.status === 404, `HTTP ${borraAjeno.status}`);

  /* ── 4. sin nada de esto ──────────────────────────────────────── */
  console.log('\n4. Sin sesión no hay nada');
  const sinToken = await fetch(API + '/api/v1/models').then((r) => r.status);
  chk('listar sin token', sinToken === 401, `HTTP ${sinToken}`);
  const descargaSin = await fetch(API + '/api/v1/models/' + m.id).then((r) => r.status);
  chk('descargar sin token', descargaSin === 401, `HTTP ${descargaSin}`);

  // La ruta antigua, la que en v2.16.0 era pública.
  const antigua = await fetch('http://localhost:4000/models/user/' + (m.name || 'x.glb'))
    .then((r) => r.status).catch(() => 0);
  chk('y la ruta pública antigua ya no sirve el archivo', antigua !== 200, `HTTP ${antigua}`);

  /* ── 5. el suyo sí, y se puede borrar ─────────────────────────── */
  console.log('\n5. El suyo sí, y se puede borrar');
  const lista = await fetch(API + '/api/v1/models', {
    headers: { authorization: 'Bearer ' + ana.accessToken },
  }).then((r) => r.json());
  chk('lo ve en su lista', (lista.models || []).some((x) => x.id === m.id),
    `${(lista.models || []).length} modelo(s)`);
  chk('y sabe cuánto ocupa', lista.used > 0, `${lista.used} de ${lista.max} bytes`);

  const baja = await fetch(API + '/api/v1/models/' + m.id, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + ana.accessToken },
  });
  chk('puede borrarlo', baja.status === 200, `HTTP ${baja.status}`);
  const despues = await fetch(API + '/api/v1/models/' + m.id, {
    headers: { authorization: 'Bearer ' + ana.accessToken },
  }).then((r) => r.status);
  chk('y ya no está', despues === 404, `HTTP ${despues}`);

  /* ── 6. lo que no es un GLB ───────────────────────────────────── */
  console.log('\n6. Lo que no es un modelo');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('esto no es un glb de verdad')], { type: 'model/gltf-binary' }),
    'falso.glb');
  const falso = await fetch(API + '/api/v1/models/upload', {
    method: 'POST', headers: { authorization: 'Bearer ' + ana.accessToken }, body: fd,
  });
  chk('un archivo con extension .glb pero sin cabecera glTF se rechaza',
    falso.status === 400, `HTTP ${falso.status}`);

  console.log(`\n${'='.repeat(46)}\n${ok}/${ok + fail} correctas\n`);
  process.exit(fail ? 1 : 0);
})();
