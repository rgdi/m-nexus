// validate_safe_text.cjs
// Validates that SafeText clamps text scale to max 125% (v0.49.14).

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

// Mirror of SafeText logic
function shouldUseMultiLine(text, override) {
  if (override !== undefined && override !== null) return override;
  return text.includes('\n') || text.length > 80;
}
function getMaxLines(text, override) {
  if (override !== undefined && override !== null) return override;
  return shouldUseMultiLine(text, override) ? 3 : 1;
}
function clampScale(scale, maxScale = 1.25) {
  return Math.max(0.8, Math.min(scale, maxScale));
}

section('1. Clamp: 100% queda igual');
{
  assert(clampScale(1.0) === 1.0, '100% = 100%');
}

section('2. Clamp: 125% queda igual');
{
  assert(clampScale(1.25) === 1.25, '125% = 125%');
}

section('3. Clamp: 130% baja a 125%');
{
  assert(clampScale(1.3) === 1.25, '130% clamped to 1.25');
}

section('4. Clamp: 200% baja a 125%');
{
  assert(clampScale(2.0) === 1.25, '200% clamped to 1.25');
}

section('5. Clamp: 50% sube a 80%');
{
  assert(clampScale(0.5) === 0.8, '50% clamped to 0.8 (min)');
}

section('6. Multi-line: texto corto = single line');
{
  assert(shouldUseMultiLine('Hola') === false, 'short text single');
  assert(getMaxLines('Hola') === 1, 'maxLines 1');
}

section('7. Multi-line: texto largo = multi');
{
  const longText = 'a'.repeat(100);
  assert(shouldUseMultiLine(longText) === true, 'long text multi');
  assert(getMaxLines(longText) === 3, 'maxLines 3');
}

section('8. Multi-line: texto con \\n');
{
  assert(shouldUseMultiLine('Linea 1\nLinea 2') === true, '\\n forces multi');
}

section('9. Override: maxLines explicito gana');
{
  assert(getMaxLines('corto', 5) === 5, 'maxLines=5 wins');
  assert(getMaxLines('a'.repeat(100), 1) === 1, 'maxLines=1 even for long');
}

section('10. Caso real: titulo largo en ActionCard');
{
  // 'Grabar clase con contexto automatico' = 35 chars
  const title = 'Grabar clase con contexto automatico';
  assert(getMaxLines(title) === 1, 'titulo = 1 linea');
  // Con 125% de escala, el texto en 1 linea ocupara ~45*1.25 = 56 chars de ancho
  // Si el container es menor (movil), ellipsis cortara
}

section('11. Caso real: subtitle largo en stat');
{
  const sub = 'Llevas 5 días de racha 🔥';
  // 24 chars, single line
  assert(getMaxLines(sub) === 1, 'subtitle corto single line');
}

section('12. Caso real: descripcion larga en ActionCard');
{
  const desc = 'PDFs, presentaciones, imagenes y audios en una sola galeria navegable';
  // 73 chars, > 80? no. Pero con 125% puede overflow
  assert(getMaxLines(desc) === 1, 'descripcion 73 chars = 1 linea');
  // Single line + ellipsis es OK si el container es lo bastante ancho
}

section('13. Caso real: descripcion muy larga');
{
  const desc = 'Audio + asignatura + examen. La grabacion se asocia automaticamente al subject del dia y al examen mas cercano en el calendario.';
  assert(getMaxLines(desc) === 3, 'descripcion larga = 3 lineas max');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
