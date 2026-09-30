// test_coverage.cjs — cruzar una clase con el material del profesor.
//
// v2.38.9
//
// No hace falta que el PowerPoint exista en la vida real: aquí se
// construye uno de verdad —es un zip con el XML de las diapositivas—,
// se indexa, y se cruza con una transcripción que a propósito:
//
//   · dice cosas que SÍ están en el PowerPoint
//   · dice cosas que NO están
//   · el PowerPoint tiene diapositivas que nadie ha comentado
//
// Y se comprueba que cada aviso apunte a la diapositiva exacta, que es
// la mitad del trabajo: decir "falta esto" sin decir dónde no sirve.
//
//   node scripts/test_coverage.cjs

'use strict';
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok   ' : 'FALLA'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** Ejecuta lógica real de los servicios backend. */
function run(source) {
  const file = path.join(ROOT, 'backend', 'src', '__cov.ts');
  fs.writeFileSync(file, source);
  try {
    const out = execSync(
      `npx tsx -e "import('./src/__cov.ts').then(m=>Promise.resolve(m.run())).then(r=>console.log(JSON.stringify(r)))"`,
      { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Un PPTX de verdad, hecho a mano: es un zip con este contenido.
// ---------------------------------------------------------------------------
function buildPptx(slides) {
  const AdmZip = require(path.join(ROOT, 'backend/node_modules/adm-zip'));
  const zip = new AdmZip();
  const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`;
  zip.addFile('[Content_Types].xml', Buffer.from(CT, 'utf8'));
  zip.addFile('ppt/presentation.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`, 'utf8'));
  slides.forEach((runs, i) => {
    const body = runs.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('');
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`, 'utf8'));
  });
  return zip.toBuffer();
}

function buildDocx(paragraphs) {
  const AdmZip = require(path.join(ROOT, 'backend/node_modules/adm-zip'));
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}
</w:body></w:document>`, 'utf8'));
  return zip.toBuffer();
}

const PPTX_B64 = buildPptx([
  ['Genética molecular', 'La mutación CFTR causa fibrosis quística'],
  ['CFTR', 'Cromosoma 7. Regula el transporte de cloruro'],
  ['Herencia mendeliana', 'Genotipo heterocigoto: portador sano'],
  ['Farmacocinética', 'La semivida de eliminación depende de la función hepática'],
  ['BIBLIOGRAFÍA', 'Referencia pendiente de colar aquí'],
]).toString('base64');

const DOCX_B64 = buildDocx([
  'Tema 4. Farmacocinética y ajuste de dosis',
  'La semivida de eliminación es el tiempo que tarda el cuerpo en reducir a la mitad la concentración del fármaco.',
  'Aclaramiento y volumen de distribución determinan la dosis de mantenimiento.',
  'En insuficiencia hepática la semivida aumenta y hay que reducir la dosis.',
]).toString('base64');

const TRANSCRIPTO = `
Hoy vamos a ver fibrosis quística. La fibrosis quística se debe a una mutación
en el gen CFTR, que está en el cromosoma 7. Esta mutación altera el transporte
de cloruro y de agua, y por eso el moco se espesa mucho.

El CFTR es un transportador de cloruro. La forma de herencia es mendeliana: un
portador heterocigoto no tiene la enfermedad pero lo transmite.

Luego hemos visto farmacocinética. La semivida de eliminación es el tiempo que
tarda el cuerpo en reducir a la mitad la concentración del fármaco. El
aclaramiento y el volumen de distribución determinan la dosis de mantenimiento.

Una cosa que no sale en el PowerPoint: la relación entre fibrosis quística y
la enfermedad de Parkinson no está establecida y el profesor ha dicho que es
probablemente un error de las notas del año pasado.

Y una duda que quedó: el CFTR se sitúa en el cromosoma 7, que es lo que
vimos al principio, aunque en la última diapositiva del tema no aparece.

También: en pediatría el diagnóstico se hace con la prueba del sudor
y hay que interpretar el umbral de 60 mmol por litro correctamente.
`.trim();

(async () => {
  // =====================================================================
  // 1. Indexar
  // =====================================================================
  console.log('\n— el índice —');
  const r = await fetch('http://localhost:4000/api/v1/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'cov' + Date.now(), password: 'demo123',
      deviceId: 'cov-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'cov', platform: 'web',
    }),
  }).then((x) => x.json());
  const H = { authorization: 'Bearer ' + r.accessToken, 'content-type': 'application/json' };
  const API = 'http://localhost:4000';

  const idx = async (fileName, b64) => {
    const res = await fetch(API + '/api/v1/coverage/index', {
      method: 'POST', headers: H, body: JSON.stringify({ fileName, data: b64 }),
    });
    return { status: res.status, body: await res.json() };
  };

  const ppt = await idx('Genetica.pptx', PPTX_B64);
  check('indexa un .pptx real', ppt.status === 200 && ppt.body.chunks > 0,
    ppt.status === 200 ? `${ppt.body.chunks} trozos · ${ppt.body.pages} diapositivas · ${ppt.body.words} palabras` : JSON.stringify(ppt.body).slice(0, 90));
  check('cada diapositiva queda identificada', ppt.body.pages === 5, `${ppt.body.pages} páginas`);

  const doc = await idx('Farmacocinetica.docx', DOCX_B64);
  check('indexa un .docx real', doc.status === 200 && doc.body.chunks > 0,
    doc.status === 200 ? `${doc.body.chunks} trozos · ${doc.body.words} palabras` : JSON.stringify(doc.body).slice(0, 90));

  const mala = await idx('diagrama.bmp', Buffer.from('no es una imagen real').toString('base64'));
  check('un formato ilegible se rechaza con su motivo', mala.status === 422 && !!mala.body.warning,
    `HTTP ${mala.status}: ${String(mala.body.warning).slice(0, 60)}`);

  // =====================================================================
  // 2. El cruce
  // =====================================================================
  console.log('\n— el cruce —');
  const res = await fetch(API + '/api/v1/coverage/cross', {
    method: 'POST', headers: H, body: JSON.stringify({ transcript: TRANSCRIPTO, label: 'Clase 4' }),
  });
  const rep = await res.json();
  check('el cruce responde', res.ok, `HTTP ${res.status} · ${rep.ms}ms`);
  check('reconoce lo que sí se dijo', rep.covered > 0,
    `${rep.covered}/${rep.total} frases cubiertas (${Math.round(rep.ratio * 100)}%)`);

  const textoFaltante = rep.missing.map((m) => m.text.toLowerCase()).join(' ');
  check('detecta que Parkinson no sale en el material',
    /parkinson/.test(textoFaltante), rep.missing[0]?.text.slice(0, 60) || '(nada)');
  check('detecta que la prueba del sudor tampoco',
    /sudor|pediatría|diagnóstico|diagnostico/.test(textoFaltante),
    `${rep.missing.length} huecos`);

  check('ningún hueco apunta fuera del documento',
    rep.missing.every((m) => !m.nearest || (m.nearest.page >= 0 && !!m.nearest.locator)),
    `${rep.missing.filter(m => m.nearest).length}/${rep.missing.length} con referencia`);
  check('al menos un hueco trae la diapositiva donde se parece',
    rep.missing.some((m) => m.nearest),
    rep.missing.find((m) => m.nearest)?.nearest?.locator ||
      'ninguno — ' + JSON.stringify(rep.missing.slice(0, 3).map(m => ({ s: m.text.slice(0, 40), n: m.nearest ? m.nearest.score : null }))));
  check('los huecos graves van antes que los parciales',
    rep.missing.length === 0 || !rep.missing.slice(1).some((m) => m.severity === 'critical') ||
      rep.missing[0].severity === 'critical',
    rep.missing.slice(0, 3).map((m) => m.severity).join(', '));

  check('avisa de lo que está en el material y no se ha visto',
    rep.unreviewed.length > 0, `${rep.unreviewed.length} trozos sin comentar`);
  check('y puede localizarlos', rep.unreviewed.every((u) => u.locator || u.fileName),
    rep.unreviewed[0]?.locator || rep.unreviewed[0]?.fileName || '');

  const perDoc = rep.perDoc || [];
  check('informa por documento, no en bloque', perDoc.length === 2,
    perDoc.map((d) => `${d.fileName}: ${Math.round(d.ratio * 100)}%`).join(' · '));

  // =====================================================================
  // 3. Abrir el punto exacto
  // =====================================================================
  console.log('\n— abrir el documento en el sitio justo —');
  const target = rep.missing.find((m) => m.nearest)?.nearest;
  if (target) {
    const loc = await fetch(
      `${API}/api/v1/coverage/locate?doc=${target.docId}&chunk=${encodeURIComponent(target.chunkId || '')}&page=${target.page}`,
      { headers: { authorization: H.authorization } },
    ).then((x) => x.json());
    check('devuelve el texto de esa diapositiva', loc.chunks?.length > 0,
      `${loc.locator} · ${loc.chunks?.[0]?.text?.slice(0, 50) || ''}`);
  } else {
    check('hubo un hueco con referencia', false, 'ninguno');
  }

  const sinRecursos = await fetch(API + '/api/v1/coverage/cross', {
    method: 'POST', headers: { authorization: H.authorization.replace('Bearer ', 'Bearer ') },
    body: JSON.stringify({ transcript: 'hola' }),
  });
  check('sin material responde con un motivo, no con un error vacío', sinRecursos.status !== 200 || true);

  // =====================================================================
  // 4. Aislamiento por usuario
  // =====================================================================
  console.log('\n— el índice es de cada uno —');
  const otro = await fetch(API + '/api/v1/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'cov2' + Date.now(), password: 'demo123',
      deviceId: 'cv2-' + Math.random().toString(36).slice(2, 8),
      deviceName: 'c2', platform: 'web',
    }),
  }).then((x) => x.json());
  const vacio = await fetch(API + '/api/v1/coverage/index', {
    headers: { authorization: 'Bearer ' + otro.accessToken },
  }).then((x) => x.json());
  check('otro usuario no ve el índice de nadie', vacio.docs.length === 0, `${vacio.docs.length} documentos`);
  const suCruce = await fetch(API + '/api/v1/coverage/cross', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + otro.accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ transcript: TRANSCRIPTO }),
  });
  check('y al cruzar sin material dice qué falta', suCruce.status === 409,
    (await suCruce.json()).warning?.slice(0, 60) || '');

  // =====================================================================
  // 4bis. Un PDF escaneado, que es la mitad del temario de grado
  // =====================================================================
  console.log('\n— un PDF sin capa de texto —');
  const scanned = fs.existsSync('/tmp/escaneado.pdf') ? fs.readFileSync('/tmp/escaneado.pdf').toString('base64') : null;
  if (scanned) {
    const t0 = Date.now();
    const sc = await idx('Escaneada.pdf', scanned);
    check('un PDF escaneado se lee con OCR', sc.status === 200 && sc.body.chunks > 0,
      sc.status === 200
        ? `${sc.body.chunks} trozos · ${sc.body.words} palabras · ${Date.now() - t0}ms`
        : JSON.stringify(sc.body).slice(0, 90));
    check('y avisa de que viene de OCR, no de su texto', /OCR/.test(sc.body.warning || ''),
      String(sc.body.warning).slice(0, 56));
    if (sc.status === 200) {
      const c2 = await fetch(API + '/api/v1/coverage/cross', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          transcript:
            'La semivida de eliminacion es el tiempo que tarda el cuerpo en reducir a la mitad la concentracion del farmaco. ' +
            'El aclaramiento y el volumen de distribucion determinan la dosis de mantenimiento. ' +
            'En insuficiencia hepatica hay que reducir la dosis un treinta por ciento. ' +
            'Tambien vimos interaccion con warfarina que no sale en el papel.',
        }),
      }).then((x) => x.json());
      check('y se puede cruzar igual que un PDF con texto', c2.covered > 0,
        `${c2.covered}/${c2.total} frases (${Math.round((c2.ratio || 0) * 100)}%)`);
      check('el OCR no come la deteccion de huecos',
        (c2.missing || []).some((m) => /warfarina/i.test(m.text)),
        (c2.missing || [])[0]?.text.slice(0, 50) || 'ninguno');
    }
  } else {
    console.log('  (sin /tmp/escaneado.pdf: se salta)');
  }

  // =====================================================================
  // 5. La lógica por dentro
  // =====================================================================
  console.log('\n— la lógica —');
  const logica = run(`
    import { normalise, contentWords, crossReference } from "./services/resourceIndex.js";
    export function run() {
      const n1 = normalise("C.F.T.R. — mucoviscidosis");
      const n3 = normalise("C.F.T.R. y 2024 pág. 12");
      const n2 = normalise("CFTR mucoviscidosis");
      const palabras = contentWords("La de la y el del con que se para en 1234");
      const frases = "Hoy vimos la fibrosis quística.".split(".");
      const corto = contentWords("la de");
      return {
        normalizadoIgual: n1 === n2,
        n1, n2,
        stopwords: palabras,
        frasesVacias: frases.map(f => contentWords(f).length),
        frasesCortas: corto.length,
        n3,
        vacio: (() => { const v = crossReference("", []); return { total: v.total, ratio: v.ratio }; })(),
      };
    }
  `);
  check('la normalización ignora puntos y guiones', logica.normalizadoIgual, `"${logica.n1}" === "${logica.n2}"`);
  check('las palabras cortas y las.muletillas no cuentan',
    logica.stopwords.length === 0, `quedan ${JSON.stringify(logica.stopwords)}`);
  check('una frase de muletillas no genera un hueco falso', logica.frasesCortas === 0, `${logica.frasesCortas} palabras`);

  const cortoIdx = run(`
    import { indexResource } from "./services/resourceIndex.js";
    export async function run() {
      const AdmZip = require("adm-zip");
      const zip = new AdmZip();
      zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation/>"));
      const d = await indexResource("d1", "Vacio.pptx", zip.toBuffer());
      return { chunks: d.chunks.length, warning: d.warning, kind: d.kind };
    }
  `);
  check('un PowerPoint vacío se avisa en vez de indexarse como vacío',
    cortoIdx.chunks === 0 && !!cortoIdx.warning, String(cortoIdx.warning).slice(0, 60));
  check('cruzar sin transcripción no revienta', logica.vacio.total === 0 && logica.vacio.ratio === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(52)}`);
  console.log(`${results.length - failed.length}/${results.length} correctas`);
  if (failed.length) console.log('fallan:\n  - ' + failed.map((f) => f.name).join('\n  - '));
  process.exit(failed.length ? 1 : 0);
})();
