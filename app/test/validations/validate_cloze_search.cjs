// validate_cloze_search.cjs: valida la logica del cloze + search en Node.js.
// Mismo algoritmo que app/lib/services/cloze_service.dart y wikilink_parser.dart.

console.log('=== Cloze validation (mismo algoritmo que app) ===\n');

const CLOZE_REGEX = /\{\{c(\d+)::([^}:]+)(?:::([^}]*))?\}\}/g;

function parseCloze(content) {
  const clozes = [];
  let match;
  CLOZE_REGEX.lastIndex = 0;
  while ((match = CLOZE_REGEX.exec(content)) !== null) {
    clozes.push({
      number: parseInt(match[1]),
      hidden: match[2].trim(),
      hint: match[3]?.trim() || null,
      start: match.index,
      fullLength: match[0].length,
      raw: match[0],
    });
  }
  return clozes;
}

function countUnique(content) {
  const clozes = parseCloze(content);
  return new Set(clozes.map(c => c.number)).size;
}

function generateCards(content) {
  const clozes = parseCloze(content);
  if (clozes.length === 0) return [];
  const byNumber = {};
  for (const c of clozes) {
    if (!byNumber[c.number]) byNumber[c.number] = [];
    byNumber[c.number].push(c);
  }
  const cards = [];
  for (const [number, group] of Object.entries(byNumber)) {
    let textWithAnswer = content;
    for (const c of clozes) {
      const replacement = c.hint ? `**${c.hidden}** [${c.hint}]` : `**${c.hidden}**`;
      textWithAnswer = textWithAnswer.replace(c.raw, replacement);
    }
    let textWithCloze = content;
    for (const c of clozes) {
      if (parseInt(number) === c.number) {
        const clozeText = c.hint ? `[...] (${c.hint})` : '[...]';
        textWithCloze = textWithCloze.replace(c.raw, clozeText);
      } else {
        textWithCloze = textWithCloze.replace(c.raw, c.hidden);
      }
    }
    cards.push({
      number: parseInt(number),
      textWithAnswer,
      textWithCloze,
      hint: group[0].hint,
    });
  }
  return cards.sort((a, b) => a.number - b.number);
}

// Tests
console.log('Test 1: parseCloze basico');
const text1 = 'El {{c1::diafragma}} es un musculo. La {{c2::mitocondria}} es la central energetica.';
const clozes1 = parseCloze(text1);
console.log('  Encontrados:', clozes1.length);
clozes1.forEach(c => console.log('  c' + c.number + ': "' + c.hidden + '"'));

console.log('\nTest 2: Con hints');
const text2 = 'La {{c1::mitocondria::organelo}} es la {{c1::central energetica::funcion}}.';
const clozes2 = parseCloze(text2);
console.log('  Cloze 1:', clozes2[0].hidden, '/ hint:', clozes2[0].hint);
console.log('  Mismo clozoe aparece 2 veces:', clozes2.length === 2);

console.log('\nTest 3: countUnique vs parseCloze');
const text3 = 'Card 1 {{c1::a}} y {{c1::b}}. Card 2 {{c2::c}}.';
console.log('  Total occurrences:', parseCloze(text3).length);
console.log('  Unique cards:', countUnique(text3));

console.log('\nTest 4: generateCards');
const text4 = 'El {{c1::corazon}} bombea {{c2::sangre}} y {{c1::oxigeno::gas}}.';
const cards4 = generateCards(text4);
console.log('  Cards generadas:', cards4.length);
cards4.forEach(c => console.log('  c' + c.number + ' front: "' + c.textWithAnswer + '"'));

console.log('\nTest 5: validate (sintaxis invalida)');
function validate(content) {
  const errors = [];
  const allClozeStarts = /\{\{c(\d*)::/g;
  let m;
  while ((m = allClozeStarts.exec(content)) !== null) {
    const closeIdx = content.indexOf('}}', m.index);
    if (closeIdx === -1) errors.push({ position: m.index, message: "no cerrado" });
  }
  return errors;
}
const bad = 'Texto con {{c1::sin cerrar...';
console.log('  Errores:', validate(bad).length, '(esperado 1)');

console.log('\n=== Wikilink validation ===\n');

const WIKILINK_REGEX = /(!?)\[\[([^\]]+)\]\]/g;

function parseWikilinks(content) {
  const links = [];
  let m;
  WIKILINK_REGEX.lastIndex = 0;
  while ((m = WIKILINK_REGEX.exec(content)) !== null) {
    const isEmbed = m[1] === '!';
    const inner = m[2].trim();
    let target, displayText;
    const parts = inner.split('|');
    target = parts[0].trim();
    displayText = parts.length > 1 ? parts[1].trim() : null;
    links.push({ target, displayText, isEmbed });
  }
  return links;
}

console.log('Test 6: parseWikilinks');
const w1 = 'Ver [[Anatomia del diafragma]] y [[Farmacologia|las drogas]]. Tambien ![[Imagen.png]].';
const links1 = parseWikilinks(w1);
console.log('  Links:', links1.length);
links1.forEach(l => console.log('  -', l.target, '(display:', l.displayText, ', embed:', l.isEmbed, ')'));

console.log('\n=== Asserciones ===');
const assert = (cond, msg) => console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
assert(clozes1.length === 2, 'Cloze count basico');
assert(clozes2[0].hint === 'organelo', 'Hint extraido');
assert(clozes2.length === 2, 'Mismo cloze multi-ocurrencia');
assert(countUnique(text3) === 2, 'countUnique correcto');
assert(cards4.length === 2, 'generateCards crea 1 por cloze number');
assert(validate(bad).length === 1, 'Validate detecta sintaxis invalida');
assert(links1.length === 3, 'Wikilinks count');
assert(links1[0].target === 'Anatomia del diafragma', 'Target basico');
assert(links1[1].displayText === 'las drogas', 'Display text');
assert(links1[2].isEmbed === true, 'Embed syntax');
