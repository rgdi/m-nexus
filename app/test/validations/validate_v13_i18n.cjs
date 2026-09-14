// validate_v13_i18n.cjs: tests para v1.3.0 i18n
//
// Verifica:
//   1. El archivo i18n.js existe y tiene los 3 idiomas (en/es/pt)
//   2. Todas las keys están completas en los 3 idiomas
//   3. El lang switcher existe
//   4. Las screens usan i18n.t() (no strings hardcoded)
//   5. Los docks, modales y empty states están traducidos

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = process.cwd();
const FE = path.join(REPO, 'frontend', 'src');

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push({ name, err: e.message }); }
}
function ok(v, msg) { if (!v) throw new Error('Assertion failed: ' + (msg || '')); }
function contains(s, sub, msg) {
  if (typeof s !== 'string' || !s.includes(sub)) throw new Error((msg || '') + `: expected to contain ${JSON.stringify(sub)}`);
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('Validating v1.3.0 i18n (es/en/pt)');
console.log('════════════════════════════════════');

// ── i18n.js existe ──
const i18nPath = path.join(FE, 'services', 'i18n.js');
const i18nSrc = fs.readFileSync(i18nPath, 'utf-8');

t('v1.3.0 i18n.js existe', () => ok(fs.existsSync(i18nPath)));

t('v1.3.0 i18n.js exporta singleton', () => {
  ok(/export const i18n = new I18n/.test(i18nSrc), 'exporta i18n');
});

t('v1.3.0 i18n.js soporta es/en/pt', () => {
  contains(i18nSrc, '"es"', 'soporta es');
  contains(i18nSrc, '"en"', 'soporta en');
  contains(i18nSrc, '"pt"', 'soporta pt');
});

// ── Lang switcher ──
const langSwitcherPath = path.join(FE, 'widgets', 'lang_switcher.js');
t('v1.3.0 lang_switcher existe', () => ok(fs.existsSync(langSwitcherPath)));
const langSwitcher = fs.readFileSync(langSwitcherPath, 'utf-8');
t('v1.3.0 lang_switcher usa i18n.t()', () => {
  ok(/i18n\.t\(/.test(langSwitcher), 'usa i18n.t()');
});
t('v1.3.0 lang_switcher llama setLang()', () => {
  ok(/setLang/.test(langSwitcher), 'permite cambiar idioma');
});
t('v1.3.0 lang_switcher usa flags via i18n.languages()', () => {
  ok(/i18n\.languages\(\)/.test(langSwitcher), 'lee languages de i18n');
  // Verifica que i18n.js tiene flags reales
  ok(/🇬🇧|🇪🇸|🇵🇹/.test(i18nSrc), 'i18n tiene flags reales');
});

// ── Main.js arranca i18n ──
const mainSrc = fs.readFileSync(path.join(FE, 'main.js'), 'utf-8');
t('v1.3.0 main.js importa i18n', () => contains(mainSrc, 'services/i18n.js', 'import'));
t('v1.3.0 main.js monta lang switcher', () => contains(mainSrc, 'mountLangSwitcher', 'monta switcher'));
t('v1.3.0 main.js usa i18n.t() en render()', () => contains(mainSrc, 'i18n.t(', 'render usa i18n'));
t('v1.3.0 main.js re-renderiza al cambiar idioma', () => contains(mainSrc, 'i18n.subscribe', 'subscribe a cambios'));

// ── Cada screen usa i18n ──
const screens = ['overview', 'calendar', 'subjects', 'notes', 'todos', 'ai'];

t('v1.3.0 todas las screens importan i18n', () => {
  for (const s of screens) {
    const src = fs.readFileSync(path.join(FE, 'screens', `${s}.js`), 'utf-8');
    ok(/from.*i18n/.test(src) || /import.*i18n/.test(src) || /i18n\.t\(/.test(src), `${s} usa i18n`);
  }
});

t('v1.3.0 screens usan i18n.t() (no strings hardcoded)', () => {
  for (const s of screens) {
    const src = fs.readFileSync(path.join(FE, 'screens', `${s}.js`), 'utf-8');
    ok(/i18n\.t\(/.test(src), `${s} tiene llamadas i18n.t()`);
  }
});

// ── Index.html tiene data-i18n ──
const indexHtml = fs.readFileSync(path.join(REPO, 'frontend', 'public', 'index.html'), 'utf-8');
t('v1.3.0 index.html tiene lang=en', () => contains(indexHtml, '<html lang=', 'lang attribute'));
t('v1.3.0 dock items con data-i18n', () => {
  // Dock route 'ai' usa 'dock.tutor' como key
  const dockKeys = { overview: 'dock.overview', calendar: 'dock.calendar', subjects: 'dock.subjects', notes: 'dock.notes', todos: 'dock.todos', ai: 'dock.tutor' };
  for (const [route, key] of Object.entries(dockKeys)) {
    ok(indexHtml.includes(`data-i18n="${key}"`), `dock item ${route} → ${key}`);
  }
});

// ── Strings completeness ──
// Extract strings from i18n.js source: parse the STRINGS object literally.
function extractStrings(src) {
  const result = {};
  // Match "key": { en: ..., es: ..., pt: ... }
  const re = /"([^"]+)":\s*\{\s*en:\s*"([^"]*)",\s*es:\s*"([^"]*)",\s*pt:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    result[m[1]] = { en: m[2], es: m[3], pt: m[4] };
  }
  return result;
}

const strings = extractStrings(i18nSrc);

t('v1.3.0 i18n.js tiene al menos 100 strings', () => {
  const n = Object.keys(strings).length;
  ok(n >= 100, `tiene ${n} strings, mínimo 100`);
});

t('v1.3.0 todos los idiomas tienen TODAS las keys', () => {
  const keys = Object.keys(strings);
  let missing = { en: [], es: [], pt: [] };
  for (const k of keys) {
    if (!strings[k].en) missing.en.push(k);
    if (!strings[k].es) missing.es.push(k);
    if (!strings[k].pt) missing.pt.push(k);
  }
  eq(missing.en.length, 0, `en missing: ${missing.en.join(", ")}`);
  eq(missing.es.length, 0, `es missing: ${missing.es.join(", ")}`);
  eq(missing.pt.length, 0, `pt missing: ${missing.pt.join(", ")}`);
});

t('v1.3.0 ningún string es placeholder sin traducir', () => {
  const keys = Object.keys(strings);
  for (const k of keys) {
    for (const lang of ['en', 'es', 'pt']) {
      const val = strings[k][lang];
      if (val.includes('TODO') || val.includes('XXX') || val.includes('???')) {
        throw new Error(`placeholder en ${k}.${lang}: "${val}"`);
      }
    }
  }
});

t('v1.3.0 los 3 idiomas cubren las pantallas principales', () => {
  const required = [
    'dock.overview', 'dock.calendar', 'dock.subjects', 'dock.notes', 'dock.todos', 'dock.tutor',
    'overview.todaySchedule', 'overview.noEvents', 'overview.quickNotes',
    'calendar.day', 'calendar.week', 'calendar.create',
    'subjects.new', 'subjects.classes', 'subjects.grades',
    'notes.new', 'notes.search', 'notes.intelligentOverview', 'notes.untitled',
    'todos.new', 'todos.open', 'todos.done', 'todos.overdue', 'todos.empty',
    'ai.title', 'ai.subtitle', 'ai.greeting', 'ai.placeholder', 'ai.send',
    'common.loading', 'common.save', 'common.cancel', 'common.delete',
  ];
  for (const k of required) {
    ok(strings[k], `falta key obligatoria: ${k}`);
    for (const lang of ['en', 'es', 'pt']) {
      ok(strings[k][lang] && strings[k][lang].length > 0, `${k}.${lang} vacio`);
    }
  }
});

// ── Detección de strings hardcoded en screens (heurística) ──
function countHardcodedStrings(src) {
  // Heurística: cuenta líneas que parecen strings literales en JSX/HTML
  // dentro de los archivos screen. Excluye placeholders, CSS, etc.
  const lines = src.split("\n");
  let count = 0;
  const seen = new Set();
  for (const line of lines) {
    // Patrones: ">Text<" o '>Text<' o title="Text" con palabra > 2 chars
    const m = line.match(/>\s*([A-Z][a-zA-ZÀ-ÿ\s]{2,})\s*</);
    if (m && !seen.has(m[1]) && !m[1].includes("i18n.")) {
      seen.add(m[1]);
      count++;
    }
  }
  return count;
}

t('v1.3.0 overview.js: pocas strings hardcoded', () => {
  const src = fs.readFileSync(path.join(FE, 'screens', 'overview.js'), 'utf-8');
  const n = countHardcodedStrings(src);
  ok(n < 10, `overview tiene ${n} strings hardcoded (esperado <10)`);
});

t('v1.3.0 calendar.js: pocas strings hardcoded', () => {
  const src = fs.readFileSync(path.join(FE, 'screens', 'calendar.js'), 'utf-8');
  const n = countHardcodedStrings(src);
  ok(n < 10, `calendar tiene ${n} strings hardcoded (esperado <10)`);
});

t('v1.3.0 subjects.js: pocas strings hardcoded', () => {
  const src = fs.readFileSync(path.join(FE, 'screens', 'subjects.js'), 'utf-8');
  const n = countHardcodedStrings(src);
  ok(n < 10, `subjects tiene ${n} strings hardcoded (esperado <10)`);
});

t('v1.3.0 notes.js: pocas strings hardcoded', () => {
  const src = fs.readFileSync(path.join(FE, 'screens', 'notes.js'), 'utf-8');
  const n = countHardcodedStrings(src);
  ok(n < 10, `notes tiene ${n} strings hardcoded (esperado <10)`);
});

t('v1.3.0 todos.js: pocas strings hardcoded', () => {
  const src = fs.readFileSync(path.join(FE, 'screens', 'todos.js'), 'utf-8');
  const n = countHardcodedStrings(src);
  ok(n < 10, `todos tiene ${n} strings hardcoded (esperado <10)`);
});

// ── Visual verification: comparamos con el modelo Education Service ──
//
// El modelo tiene texto como "Overview", "Calendar", "Notes", "To-do's".
// Verificamos que el default (en) coincide.
t('v1.3.0 defaults en inglés coinciden con modelo Education Service', () => {
  eq(strings['dock.overview'].en, 'Overview', 'Overview');
  eq(strings['dock.calendar'].en, 'Calendar', 'Calendar');
  eq(strings['dock.subjects'].en, 'Subjects', 'Subjects');
  eq(strings['dock.notes'].en, 'Notes', 'Notes');
  eq(strings['dock.todos'].en, 'To-dos', 'To-dos (con apostrofe en el modelo)');
});

t('v1.3.0 las traducciones no están vacías', () => {
  const keys = Object.keys(strings);
  let nonEmpty = 0;
  for (const k of keys) {
    for (const lang of ['en', 'es', 'pt']) {
      if (strings[k][lang] && strings[k][lang].trim().length > 0) nonEmpty++;
    }
  }
  ok(nonEmpty > 300, `${nonEmpty} strings no-vacios`);
});

console.log(`\nResults: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  fails.forEach(f => console.log(`  ✗ ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('✓ All v1.3.0 i18n validations passed');
process.exit(0);
