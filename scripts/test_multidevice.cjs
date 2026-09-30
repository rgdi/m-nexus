// test_multidevice.cjs — login convencional y por qué no hay dos verdades.
//
// v2.38.13
//
// Lo que se comprueba, que es lo que el usuario pidió:
//
//   · registro con correo y contraseña, y vuelta a entrar con ellos
//   · una contraseña mal no entra, y el mensaje no dice cuál de las dos
//     cosas falla
//   · el móvil y el portátil, con la misma cuenta, ven lo mismo
//   · cuando uno escribe, el otro se entera SIN recargar: el canal
//     en tiempo real le avisa
//   · un cliente desconectado recupera lo que se perdió al volver
//   · dos cuentas distintas NO se ven entre sí
//
//   node scripts/test_multidevice.cjs

'use strict';
const path = require('node:path');
const API = 'http://localhost:4000';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const cuenta = async (n) => {
  const r = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: n + Date.now(), password: 'demo123',
      deviceId: n + '-' + Math.random().toString(36).slice(2, 7),
      deviceName: n, platform: 'web',
    }),
  }).then((x) => x.json());
  return { authorization: 'Bearer ' + r.accessToken, 'content-type': 'application/json' };
};

const post = (url, H, body) =>
  fetch(API + url, { method: 'POST', headers: H, body: JSON.stringify(body) });

(async () => {
  // =====================================================================
  console.log('\n— login convencional —');
  const movil = await cuenta('movil');
  const email = `ana.${Date.now()}@ejemplo.com`;
  const pass = 'contrasena-larga-1';

  const alta = await post('/api/v1/accounts/register', movil, { email, password: pass }).then((r) => r.json());
  check('alta con correo y contraseña', !!alta.account, `${alta.account}`);

  const repetida = await post('/api/v1/accounts/register', await cuenta('otro'), { email, password: pass });
  check('ese correo no se puede volver a dar de alta', repetida.status === 409,
    (await repetida.json()).warning?.slice(0, 50) || '');

  const mala = await post('/api/v1/accounts/login', await cuenta('x'), { email, password: 'otra-cosa' });
  const cuerpoMala = await mala.json().catch(() => ({}));
  const sinCorreo = await post('/api/v1/accounts/login', await cuenta('y'), {
    email: `nadie.${Date.now()}@ejemplo.com`, password: pass,
  });
  check('contraseña mala y correo inexistente dan el mismo mensaje',
    mala.status === 401 && sinCorreo.status === 401 &&
    cuerpoMala.warning === (await sinCorreo.json()).warning,
    cuerpoMala.warning);

  // =====================================================================
  console.log('\n— el portátil entra con correo y contraseña —');
  const portatil = await cuenta('portatil');
  const entrada = await post('/api/v1/accounts/login', portatil, { email, password: pass }).then((r) => r.json());
  check('login correcto', entrada.account === alta.account, entrada.account);
  check('la cuenta ya tiene los dos dispositivos', entrada.devices.length === 2,
    entrada.devices.length + ' dispositivos');

  const carpeta = await post('/api/v1/folders', movil, { name: 'Genética' }).then((r) => r.json());
  const nota = await post('/api/v1/notes', movil, {
    title: 'Fibrosis quística', folderId: carpeta.id,
    body: 'Mutación en el gen CFTR, en el cromosoma 7.',
  }).then((r) => r.json());

  const B = { authorization: portatil.authorization };
  const notasB = await fetch(API + '/api/v1/notes', { headers: B }).then((r) => r.json());
  const lista = Array.isArray(notasB) ? notasB : notasB.notes || [];
  check('el portátil ve lo que escribió el móvil', lista.some((x) => x.id === nota.id),
    `${lista.length} notas`);

  // =====================================================================
  console.log('\n— la revisión: cómo se sabe que algo cambió —');
  const revA0 = await fetch(API + '/api/v1/accounts/revision', {
    headers: { authorization: movil.authorization },
  }).then((r) => r.json());

  await post('/api/v1/tasks', movil, { text: 'revisar el gen CFTR', kind: 'task', done: false });

  const revA1 = await fetch(API + '/api/v1/accounts/revision', {
    headers: { authorization: movil.authorization },
  }).then((r) => r.json());
  const revB1 = await fetch(API + '/api/v1/accounts/revision', { headers: B }).then((r) => r.json());

  check('escribir sube la revisión', revA1.revision > revA0.revision,
    `${revA0.revision} → ${revA1.revision}`);
  check('los dos dispositivos ven la MISMA revisión',
    revA1.revision === revB1.revision, `móvil ${revA1.revision} · portátil ${revB1.revision}`);

  // =====================================================================
  console.log('\n— el canal en tiempo real —');
  const cambios = [];
  const ctrl = new AbortController();
  const stream = await fetch(API + '/api/v1/stream', { headers: B, signal: ctrl.signal });
  check('el canal se abre', stream.ok && stream.headers.get('content-type')?.includes('event-stream'),
    stream.headers.get('content-type'));

  const leer = (async () => {
    const reader = stream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (cambios.length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (const bloque of buf.split('\n\n')) {
        const m = bloque.match(/event: (\w+)\ndata: (.+)/);
        if (m) cambios.push({ evento: m[1], datos: JSON.parse(m[2]) });
      }
      buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
    }
  })();

  await new Promise((r) => setTimeout(r, 400));
  check('saluda al conectar y dice en qué revisión está',
    cambios[0]?.evento === 'hello' && cambios[0]?.datos.revision === revA1.revision,
    `hello en revisión ${cambios[0]?.datos?.revision}`);

  // El móvil escribe. El portátil, sin tocar nada, tiene que enterarse.
  await post('/api/v1/notes', movil, { title: 'Herencia mendeliana', body: 'Homocigosis recesiva.' });
  await leer;
  const cambio = cambios.find((c) => c.evento === 'change');
  check('el otro dispositivo se entera sin recargar', !!cambio,
    cambio ? `revisión ${cambio.datos.revision} · colección ${cambio.datos.collection}` : 'no llegó nada');
  check('y sabe que tiene algo que recargar',
    cambio && cambio.datos.revision > revA1.revision, `la revisión cambió a ${cambio?.datos?.revision}`);
  ctrl.abort();

  // =====================================================================
  console.log('\n— lo que pasa mientras estás desconectado —');
  const perdido = await fetch(API + '/api/v1/stream?since=' + revA1.revision, { headers: B });
  const texto = await perdido.text();
  check('al volver, el servidor te pasa lo que te has perdido',
    texto.includes('event: change') && texto.includes('note'), 'contenido perdido, no todo');
  perdido.body?.cancel?.();

  // =====================================================================
  console.log('\n— dos cuentas no se ven —');
  const otro = await cuenta('ajeno');
  const otroRegistro = await post('/api/v1/accounts/register', otro, {
    email: `otro.${Date.now()}@ejemplo.com`, password: 'otra-clave-1',
  }).then((r) => r.json());
  const notasAjenas = await fetch(API + '/api/v1/notes', { headers: otro }).then((r) => r.json());
  const ajenaLista = Array.isArray(notasAjenas) ? notasAjenas : notasAjenas.notes || [];
  check('otra cuenta no ve las notas de esta',
    !ajenaLista.some((x) => x.id === nota.id) && ajenaLista.length === 0,
    `${ajenaLista.length} notas`);
  check('y su revisión va por su lado',
    (await fetch(API + '/api/v1/accounts/revision', { headers: otro }).then((r) => r.json())).account === otroRegistro.account,
    'cuenta propia');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
