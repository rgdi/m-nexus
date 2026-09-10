// validate_chat_extract.cjs
// Validates the Q/A extraction algorithm used in chat_screen._extractFlashcard
// and _extractMultipleFlashcards (v0.49.4).

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

// Mirror of _extractFlashcard (more permissive: case insensitive, any prefix)
function extractFlashcard(text) {
  const qMatch = /(?:^|\n)\s*[*_]*\s*(?:Question|Pregunta|Q)\s*[:\-]?\s*[*_]*\s*(.+?)(?:\n|$)/i.exec(text);
  const aMatch = /(?:^|\n)\s*[*_]*\s*(?:Answer|Respuesta|A)\s*[:\-]?\s*[*_]*\s*(.+?)(?:\n\n|$)/is.exec(text);
  if (qMatch && aMatch) {
    return [qMatch[1].trim(), aMatch[1].trim()];
  }
  const sentences = text.split(/[.!?]\s+/);
  if (sentences.length >= 2) {
    return [sentences[0].trim(), sentences.slice(1, 4).join('. ').trim()];
  }
  return null;
}

// Mirror of _extractMultipleFlashcards
function extractMultiple(text) {
  const out = [];
  const pattern = /(?:^|\n)\s*[*_]*\s*(?:Question|Pregunta|Q)\s*[:\-]?\s*(.+?)\s*\n+\s*[*_]*\s*(?:Answer|Respuesta|A)\s*[:\-]?\s*(.+?)(?=\n+\s*[*_]*\s*(?:Question|Pregunta|Q)|$)/gis;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    out.push([m[1].trim(), m[2].trim()]);
  }
  if (out.length === 0) {
    const lines = text.split('\n');
    let pendingQ = null;
    for (const l of lines) {
      const t = l.trim();
      if (!t) continue;
      if (t.includes('?') && t.length < 200) {
        pendingQ = t;
      } else if (pendingQ && t.length > 10) {
        out.push([pendingQ, t]);
        pendingQ = null;
      }
    }
  }
  return out;
}

section('1. extractFlashcard: Q/A en español');
{
  const text = "Pregunta: ¿Qué es la mitocondria?\nRespuesta: La central energética de la célula.";
  const r = extractFlashcard(text);
  assert(r !== null, 'extracted');
  assert(r[0] === '¿Qué es la mitocondria?', 'front: ' + (r && r[0]));
  assert(r[1] === 'La central energética de la célula.', 'back: ' + (r && r[1]));
}

section('2. extractFlashcard: Q/A en inglés');
{
  const text = "Question: What is DNA?\nAnswer: The genetic code carrier.";
  const r = extractFlashcard(text);
  assert(r !== null, 'extracted');
  assert(r[0] === 'What is DNA?', 'front');
  assert(r[1] === 'The genetic code carrier.', 'back');
}

section('3. extractFlashcard: Q: y A: con guión');
{
  const text = "Q - What is ATP?\nA - The energy currency of the cell";
  const r = extractFlashcard(text);
  assert(r !== null, 'extracted');
  assert(r[0] === 'What is ATP?', 'front with -');
  assert(r[1] === 'The energy currency of the cell', 'back with -');
}

section('4. extractFlashcard: markdown bold');
{
  const text = "**Pregunta:** ¿Qué es el ATP?\n**Respuesta:** La moneda energética.";
  const r = extractFlashcard(text);
  assert(r !== null, 'extracted bold');
  assert(r[0] === '¿Qué es el ATP?', 'front bold');
  assert(r[1] === 'La moneda energética.', 'back bold');
}

section('5. extractFlashcard: fallback a sentences');
{
  const text = "El corazón bombea sangre. Es un músculo. Late unas 70 veces por minuto.";
  const r = extractFlashcard(text);
  assert(r !== null, 'fallback extracted');
  assert(r[0] === 'El corazón bombea sangre', 'first sentence as front');
  assert(r[1].includes('músculo'), 'rest as back');
}

section('6. extractFlashcard: no Q/A → fallback');
{
  const text = "Single sentence.";
  const r = extractFlashcard(text);
  assert(r === null, 'returns null when no Q/A and only 1 sentence');
}

section('7. extractMultiple: 3 pares Q/A en bloque');
{
  const text = `Pregunta: ¿Capital de Francia?\nRespuesta: París\n\nPregunta: ¿Capital de España?\nRespuesta: Madrid\n\nPregunta: ¿Capital de Italia?\nRespuesta: Roma`;
  const cards = extractMultiple(text);
  assert(cards.length === 3, '3 cards extracted, got ' + cards.length);
  assert(cards[0][0] === '¿Capital de Francia?', 'card 1 q');
  assert(cards[0][1] === 'París', 'card 1 a');
  assert(cards[2][1] === 'Roma', 'card 3 a');
}

section('8. extractMultiple: patrón pregunta-linea');
{
  const text = `¿Qué es el ADN?\nEs la molecula que contiene la informacion genetica\n\n¿Que es el ARN?\nEl ARN es el acido ribonucleico, transporta la informacion`;
  const cards = extractMultiple(text);
  assert(cards.length === 2, '2 cards from questions pattern, got ' + cards.length);
  assert(cards[0][0] === '¿Qué es el ADN?', 'q1');
  assert(cards[1][1].includes('ARN'), 'a2 contains ARN');
}

section('9. extractMultiple: max 10 cards');
{
  // Note: el cap de 10 lo hace chat_screen con .take(10), aqui verificamos que extractMultiple devuelve todos
  let text = '';
  for (let i = 0; i < 15; i++) {
    text += `Pregunta: P${i}?\nRespuesta: A${i}\n\n`;
  }
  const cards = extractMultiple(text);
  assert(cards.length === 15, 'extractMultiple devuelve los 15, got ' + cards.length);
}

section('10. extractFlashcard: case insensitive Q?');
{
  const text = "q: Lowercase q\nA: Lowercase a";
  const r = extractFlashcard(text);
  assert(r !== null, 'lowercase extracted');
  assert(r[0] === 'Lowercase q', 'q lowercase');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
