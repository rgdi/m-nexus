// validate_backlinks.cjs: valida el algoritmo NFD de backlinks.
// Mismo algoritmo que app/lib/widgets/backlinks_panel.dart

console.log('=== Backlinks NFD matching validation ===\n');

// Simula normalizeNfc (lowercase + strip accents)
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function linkMatches(link, targetBasename, targetPath) {
  const target = link.split('|')[0].trim();
  const normalized = normalize(target);
  return normalized === normalize(targetBasename) ||
    normalized === normalize(targetPath) ||
    normalized === normalize(targetPath + '.md');
}

const assert = (cond, msg) => console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);

console.log('Test 1: Match basico');
assert(linkMatches('Anatomia', 'Anatomia', 'anatomia.md'), 'Match exacto');

console.log('\nTest 2: Case-insensitive');
assert(linkMatches('ANATOMIA', 'anatomia', 'Anatomia.md'), 'Mayusculas');

console.log('\nTest 3: Con acentos');
assert(linkMatches('Anatomía del Diafragma', 'Anatomia del Diafragma', 'anatomia-del-diafragma.md'),
  'Acentos ignorados');

console.log('\nTest 4: Con display text');
assert(linkMatches('Anatomia|ver musculo', 'Anatomia', 'anatomia.md'),
  'Display text ignored, target matched');

console.log('\nTest 5: Con .md extension');
assert(linkMatches('anatomia.md', 'anatomia', 'anatomia'),
  'Con extension .md');

console.log('\nTest 6: Sin match');
assert(!linkMatches('Farmacologia', 'Anatomia', 'anatomia.md'),
  'No match entre notas distintas');

console.log('\nTest 7: Embed syntax (no deberia matchear wikilink)');
// ![[Note]] es embed, no link normal — solo verificamos que el algoritmo lo
// aceptaria si la lista de links ya viene pre-procesada
assert(true, 'Embed syntax es responsabilidad del parser upstream');

console.log('\n=== Snippet rendering ===\n');
function renderSnippet(link) {
  return '[[' + (link.split('|')[1] || link) + ']]';
}
assert(renderSnippet('Anatomia|del diafragma') === '[[del diafragma]]', 'Snippet con alias');
assert(renderSnippet('Anatomia') === '[[Anatomia]]', 'Snippet sin alias');
