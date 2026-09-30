// test_account.cjs — dos dispositivos, una cuenta.
//
// v2.38.12
//
// La prueba de que esto sirve es una sola y es muy concreta:
//
//   1. El móvil crea una nota y dibuja.
//   2. El portátil entra con un código.
//   3. ¿El portátil ve la nota? ¿Y la tinta?
//   4. Si dibuja, ¿el móvil lo ve?
//   5. Y al revés: ¿se rompe algo para quien NO tiene cuenta?
//
//   node scripts/test_account.cjs

'use strict';
const path = require('node:path');
const fs = require('node:fs');
const API = 'http://localhost:4000';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const cuenta = async (nombre) => {
  const r = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: nombre + Date.now(), password: 'demo123',
      deviceId: nombre + '-' + Math.random().toString(36).slice(2, 8),
      deviceName: nombre, platform: nombre === 'movil' ? 'ios' : 'web',
    }),
  }).then((x) => x.json());
  return { authorization: 'Bearer ' + r.accessToken, 'content-type': 'application/json' };
};

(async () => {
  // =====================================================================
  console.log('\n— sin cuenta, todo igual que antes —');
  const movil = await cuenta('movil');
  const A = { authorization: movil.authorization };
  const sinCuenta = await fetch(API + '/api/v1/accounts/me', { headers: A }).then((r) => r.json());
  check('un dispositivo sin cuenta lo dice y sigue funcionando',
    sinCuenta.account === null && !!sinCuenta.subject, sinCuenta.message?.slice(0, 60));

  const carpeta = await fetch(API + '/api/v1/folders', {
    method: 'POST', headers: movil, body: JSON.stringify({ name: 'Genética' }),
  }).then((r) => r.json());
  const nota = await fetch(API + '/api/v1/notes', {
    method: 'POST', headers: movil,
    body: JSON.stringify({ title: 'Fibrosis quística', folderId: carpeta.id, body: 'Se debe a una mutación en el gen CFTR, en el cromosoma 7.' }),
  }).then((r) => r.json());
  check('y sigue guardando sus cosas con normalidad', !!nota.id, `nota ${nota.id}`);

  // =====================================================================
  console.log('\n— la cuenta y el código —');
  const creada = await fetch(API + '/api/v1/accounts', {
    method: 'POST', headers: movil, body: JSON.stringify({ label: 'M-NEXUS' }),
  }).then((r) => r.json());
  check('crear una cuenta', !!creada.id && creada.devices.length === 1, `${creada.id}`);

  const me1 = await fetch(API + '/api/v1/accounts/me', { headers: A }).then((r) => r.json());
  check('el móvil ya pertenece a la cuenta', me1.account === creada.id, me1.account);

  const sinPermiso = await fetch(API + '/api/v1/accounts/invite', {
    method: 'POST', headers: await cuenta('recien'), body: '{}',
  });
  check('un dispositivo sin cuenta no puede invitar a nadie', sinPermiso.status === 409,
    (await sinPermiso.json()).warning?.slice(0, 50) || '');

  const inv = await fetch(API + '/api/v1/accounts/invite', {
    method: 'POST', headers: movil, body: '{}',
  }).then((r) => r.json());
  check('el móvil genera un código', !!inv.code && inv.code.length === 8, `${inv.code} · ${inv.ttlMinutes} min`);
  check('el código no tiene caracteres que se confundan', !/[01OIL]/.test(inv.code), inv.code);

  const malo = await fetch(API + '/api/v1/accounts/link', {
    method: 'POST', headers: await cuenta('x'), body: JSON.stringify({ code: 'ZZZZZZZZ' }),
  });
  check('un código falso no vincula a nadie', malo.status === 400, (await malo.json()).warning);

  // =====================================================================
  console.log('\n— el portátil entra —');
  const portatil = await cuenta('portatil');
  const B = { authorization: portatil.authorization };

  // Antes de vincular, el portátil no ve la nota. obvious, pero se comprueba.
  const antes = await fetch(API + '/api/v1/accounts/me', { headers: B }).then((r) => r.json());
  check('antes de vincular, el portátil va por su cuenta', antes.account === null, 'aislado');

  const vinculado = await fetch(API + '/api/v1/accounts/link', {
    method: 'POST', headers: portatil, body: JSON.stringify({ code: inv.code }),
  }).then((r) => r.json());
  check('el portátil entra con el código', vinculado.account === creada.id, vinculado.account);
  check('la cuenta ya tiene los dos dispositivos', vinculado.devices.length === 2,
    vinculado.devices.map((d) => d.platform).join(' + '));

  const reuso = await fetch(API + '/api/v1/accounts/link', {
    method: 'POST', headers: await cuenta('y'), body: JSON.stringify({ code: inv.code }),
  });
  check('el código no se puede reutilizar', reuso.status === 400, 'caducado al usarlo');

  // =====================================================================
  console.log('\n— ¿ve el portátil lo que hizo el móvil? —');
  const notasB = await fetch(API + '/api/v1/notes', { headers: B }).then((r) => r.json());
  const lista = Array.isArray(notasB) ? notasB : notasB.notes || [];
  check('el portátil ve la nota del móvil',
    lista.some((x) => x.id === nota.id || x.title === 'Fibrosis quística'),
    `${lista.length} notas visibles`);

  // Y la tinta, que es donde se nota de verdad.
  const DOC = 'nota-cuenta';
  const trazo = (id, by, seq, x) => ({
    id, by, seq, deleted: 0, tool: 'pen', color: '#a855f7', width: 0.006, alpha: 1,
    page: 0, aspect: 0.7, bbox: { x: x - 0.05, y: 0.4, w: 0.1, h: 0.1 },
    points: [{ x, y: 0.45, p: 0.6, t: 0 }, { x: x + 0.08, y: 0.5, p: 0.4, t: 20 }],
  });

  await fetch(API + '/api/v1/ink/push', {
    method: 'POST', headers: movil,
    body: JSON.stringify({ docId: DOC, strokes: [trazo('t-movil', 'movil', 1, 0.2)], seq: 1, deviceId: 'movil' }),
  });
  const vistoPorB = await fetch(API + '/api/v1/ink/' + DOC, { headers: B }).then((r) => r.json());
  const trazosB = (vistoPorB.pages || []).flatMap((p) => p.strokes);
  check('el portátil ve el trazo que hizo el móvil', trazosB.length === 1,
    `${trazosB.length} trazo(s) · autor ${trazosB[0]?.by}`);

  // =====================================================================
  console.log('\n— y al revés —');
  await fetch(API + '/api/v1/ink/push', {
    method: 'POST', headers: portatil,
    body: JSON.stringify({ docId: DOC, strokes: [trazo('t-portatil', 'portatil', 2, 0.6)], seq: 2, deviceId: 'portatil' }),
  });
  const vistoPorA = await fetch(API + '/api/v1/ink/' + DOC, { headers: A }).then((r) => r.json());
  const trazosA = (vistoPorA.pages || []).flatMap((p) => p.strokes);
  check('el móvil ve el trazo que hizo el portátil', trazosA.length === 2,
    `${trazosA.length} trazos · ${[...new Set(trazosA.map((s) => s.by))].join(', ')}`);

  // =====================================================================
  console.log('\n— salir de la cuenta —');
  const fuera = await fetch(API + '/api/v1/accounts/unlink', { method: 'POST', headers: portatil, body: '{}' }).then((r) => r.json());
  check('el portátil puede salirse', fuera.ok === true, `${fuera.devices?.length} dispositivos`);

  const aislado = await fetch(API + '/api/v1/ink/' + DOC, { headers: B }).then((r) => r.json());
  check('y al salir deja de ver la tinta de la cuenta',
    (aislado.pages || []).flatMap((p) => p.strokes).length === 0, 'vuelve a su directorio');

  const ultimo = await fetch(API + '/api/v1/accounts/unlink', { method: 'POST', headers: movil, body: '{}' });
  check('el último dispositivo no se puede ir solo', ultimo.status === 409,
    (await ultimo.json()).warning?.slice(0, 60) || '');

  const fuera2 = await fetch(API + '/api/v1/accounts/me', { headers: A }).then((r) => r.json());
  check('y el móvil se queda con su cuenta intacta', fuera2.account === creada.id, fuera2.account);

  const tr = await fetch(API + '/api/v1/accounts/unlink', { method: 'POST', headers: await cuenta('tercero'), body: '{}' });
  check('un dispositivo sin cuenta no puede desvincularse', tr.status === 409, String(tr.status));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
