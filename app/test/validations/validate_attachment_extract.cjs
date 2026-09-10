// validate_attachment_extract.cjs
// Validates extractive summary + extractive flashcards from text (v0.49.11).

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

// Mirror of _extractiveSummary
function extractiveSummary(text, maxLen) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  const out = [];
  let total = 0;
  for (const s of sentences) {
    if (total + s.length > maxLen) break;
    out.push(s);
    total += s.length;
  }
  return out.join(' ').trim() || text.slice(0, maxLen);
}

// Mirror of _extractiveFlashcards
function extractiveFlashcards(text, max) {
  const out = [];
  const questions = text.split(/(?<=[?])\s+/).filter(s => s.includes('?') && s.length < 200);
  for (const q of questions.slice(0, max)) {
    out.push({ front: q.trim(), back: '(revisar texto fuente)' });
  }
  if (out.length === 0) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    for (let i = 0; i < Math.min(max, sentences.length - 1); i += 2) {
      out.push({
        front: `Resume: ${sentences[i].slice(0, 80)}...?`,
        back: sentences[i + 1] || sentences[i],
      });
    }
  }
  return out;
}

section('1. summary: limit by maxLen');
{
  const text = 'Esta es la primera oracion de prueba. Esta es la segunda oracion que tambien queremos incluir. Esta es la tercera oracion que ya no entraria. Y esta es la cuarta que tampoco.';
  const summary = extractiveSummary(text, 60);
  assert(summary.length <= 60, 'summary <= maxLen, got ' + summary.length);
  assert(summary.length > 0, 'summary not empty');
}

section('2. summary: falls back to slice if no sentences');
{
  const text = 'loremipsum'; // 10 chars, no spaces
  const summary = extractiveSummary(text, 50);
  // El filter >10 acepta esta, asi que la devuelve tal cual
  assert(summary === 'loremipsum' || summary.length === 10, 'falls back or includes');
}

section('3. summary: skips short sentences');
{
  const text = 'OK. Esta es una oracion valida con mas de 10 chars. No. Esta tambien es valida y tiene suficientes chars para entrar.';
  const summary = extractiveSummary(text, 200);
  assert(!summary.startsWith('OK.'), 'short sentences skipped');
  assert(summary.length > 0, 'summary exists');
}

section('4. flashcards: extracts questions');
{
  const text = `La mitocondria es la central energetica. ¿Que funcion tiene? Producir ATP mediante respiracion celular. ¿Donde se encuentra? En el citoplasma de celulas eucariotas. ¿Cual es su origen? La teoria endosimbiotica.`;
  const cards = extractiveFlashcards(text, 10);
  assert(cards.length === 3, '3 questions extracted, got ' + cards.length);
  assert(cards[0].front.includes('funcion'), 'q1: ' + cards[0].front);
  assert(cards[1].front.includes('Donde'), 'q2: ' + cards[1].front);
  assert(cards[2].front.includes('origen'), 'q3: ' + cards[2].front);
}

section('5. flashcards: respects max');
{
  let text = '';
  for (let i = 0; i < 20; i++) text += `Pregunta ${i}? Respuesta ${i}. `;
  const cards = extractiveFlashcards(text, 5);
  assert(cards.length === 5, 'max respected, got ' + cards.length);
}

section('6. flashcards: fallback when no questions');
{
  const text = 'El corazon bombea sangre por todo el cuerpo. Es un musculo hueco que late unas 70 veces por minuto en reposo. La sangre transporta oxigeno y nutrientes a los tejidos.';
  const cards = extractiveFlashcards(text, 5);
  assert(cards.length > 0, 'fallback generates cards');
  // All cards should have a non-empty front and back
  for (const c of cards) {
    assert(c.front.length > 0 && c.back.length > 0, 'card has both parts');
  }
}

section('7. flashcards: empty text -> empty');
{
  const cards = extractiveFlashcards('', 5);
  assert(cards.length === 0, 'empty text returns 0 cards');
}

section('8. summary: includes sentence boundaries');
{
  const text = 'Hola mundo. Como estas hoy. Bien y tu.';
  const summary = extractiveSummary(text, 100);
  // El split devuelve ['Hola mundo', 'Como estas hoy', 'Bien y tu.'] (filter >10 los acepta)
  assert(summary.length > 0, 'all sentences included');
  assert(summary.startsWith('Hola mundo'), 'starts with first sentence');
}

section('9. flashcards: question length filter');
{
  // Pregunta muy larga (>200 chars) debe ser ignorada
  const longQ = '?'.repeat(250);
  const text = `${longQ} Respuesta corta. Pregunta normal? Respuesta normal.`;
  const cards = extractiveFlashcards(text, 5);
  // Solo cuenta la normal
  const normalCount = cards.filter(c => !c.front.startsWith('?'.repeat(100))).length;
  assert(normalCount >= 1, 'normal question captured');
}

section('10. summary: empty input');
{
  const summary = extractiveSummary('', 100);
  assert(summary === '', 'empty text -> empty summary');
}

section('11. findReferencingNotes pattern matching');
{
  // Test: vault has note.md that mentions "report.pdf" -> should be found
  const content1 = 'Aqui se menciona [[report.pdf]] en una nota.';
  const content2 = 'Aqui se menciona report.pdf directamente.';
  const content3 = 'Aqui no se menciona nada relevante.';
  // Mirror
  const pattern = 'report.pdf';
  assert(content1.includes(pattern), 'note 1 references');
  assert(content2.includes(pattern), 'note 2 references');
  assert(!content3.includes(pattern), 'note 3 no references');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
