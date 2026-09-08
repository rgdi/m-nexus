// validate_v47.cjs: valida el código v0.47 (sin Flutter SDK).
// Más inteligente: busca imports y verifica con paths reales.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const appDir = path.join(root, 'app', 'lib');

console.log('=== M-NEXUS v0.47 code validation ===\n');

// 1. Archivos requeridos
const required = [
  'main.dart',
  'state/app_state.dart',
  'screens/home/home_screen.dart',
  'screens/setup/setup_wizard.dart',
  'screens/setup/onboarding_tutorial.dart',
  'screens/flashcards/flashcard_edit.dart',
  'l10n/app_es.arb',
];

let allFound = true;
for (const f of required) {
  const full = path.join(appDir, f);
  if (fs.existsSync(full)) {
    const size = fs.statSync(full).size;
    console.log(`  OK   ${f} (${size} bytes)`);
  } else {
    console.log(`  MISSING ${f}`);
    allFound = false;
  }
}

// 2. Recolectar todos los .dart
const dartFiles = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (f.endsWith('.dart') && !f.endsWith('.g.dart')) dartFiles.push(full);
  }
}
walk(appDir);

// 3. Verificar imports relativos (excluyendo comentarios)
let brokenImports = [];
for (const f of dartFiles) {
  const content = fs.readFileSync(f, 'utf-8');
  // Quitar comentarios de linea
  const codeOnly = content.split('\n').map(l =>
    l.trim().startsWith('//') ? '' : l
  ).join('\n');
  // Quitar comentarios de bloque
  const codeNoBlocks = codeOnly.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = codeNoBlocks.split('\n');
  for (const line of lines) {
    const m = line.match(/^import\s+['"]([^'"]+)['"]/);
    if (!m) continue;
    const importPath = m[1];
    if (importPath.startsWith('package:') || importPath.startsWith('dart:')) continue;
    // Resolver path relativo
    const baseDir = path.dirname(f);
    // Normalizar ../ con path.resolve
    let resolved = path.resolve(baseDir, importPath);
    if (fs.existsSync(resolved) || fs.existsSync(resolved + '.dart')) continue;
    // Tambien probar sin el '.dart' que algunos imports tienen
    const withoutExt = importPath.replace(/\.dart$/, '');
    resolved = path.resolve(baseDir, withoutExt);
    if (fs.existsSync(resolved) || fs.existsSync(resolved + '.dart')) continue;
    brokenImports.push({ file: f.replace(appDir + '/', ''), importPath });
  }
}
console.log(`\n2. Imports rotos: ${brokenImports.length}`);
for (const b of brokenImports.slice(0, 5)) {
  console.log(`  ${b.file}: ${b.importPath}`);
}
if (brokenImports.length > 5) console.log(`  ... y ${brokenImports.length - 5} más`);

// 4. Verificar imports prohibidos
console.log('\n3. Verificando que archivos drift eliminados no se importen...');
const forbidden = [
  'package:drift',
  'package:drift_flutter',
  'package:sqlite3_flutter_libs',
  "import 'package:drift/",
];
let forbiddenFound = [];
for (const f of dartFiles) {
  const content = fs.readFileSync(f, 'utf-8');
  const codeOnly = content.split('\n').map(l =>
    l.trim().startsWith('//') ? '' : l
  ).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const fb of forbidden) {
    if (codeOnly.includes(fb)) {
      forbiddenFound.push({ file: f.replace(appDir + '/', ''), what: fb });
    }
  }
}
console.log(`  Imports prohibidos: ${forbiddenFound.length}`);

// 5. ARB sanity
console.log('\n4. Validando ARB...');
const esArb = JSON.parse(fs.readFileSync(path.join(appDir, 'l10n/app_es.arb'), 'utf-8'));
const arbKeys = Object.keys(esArb).filter(k => !k.startsWith('@'));
console.log(`  app_es.arb: ${arbKeys.length} keys`);

// 6. Argentinismos (palabras enteras, no substrings)
console.log('\n5. Buscando argentinismos...');
const argentinism = [
  'boludo', 'pibe', 'mina', 'guita', 'quilombo', 'copado', 'chamuyo', 'piola',
  're piola', 'de pelos', 'al toque', 'ni ahí', 'ni a palos'
];
let argFound = [];
for (const k of arbKeys) {
  const v = esArb[k];
  if (typeof v !== 'string') continue;
  const lowerV = v.toLowerCase();
  for (const w of argentinism) {
    if (lowerV.includes(' ' + w + ' ') || lowerV.startsWith(w + ' ') || lowerV.endsWith(' ' + w) || lowerV === w) {
      argFound.push({ key: k, value: v, word: w });
    }
  }
}
console.log(`  Argentinismos encontrados: ${argFound.length}`);

// 7. FSRS auto-eval
console.log('\n6. FSRS auto-evalúa dificultad...');
const fsrsEngine = fs.readFileSync(path.join(appDir, 'services/fsrs_engine.dart'), 'utf-8');
const hasAutoDifficulty = fsrsEngine.includes('_initialDifficulty') && fsrsEngine.includes('_initialStability');
console.log(`  ${hasAutoDifficulty ? 'SÍ' : 'NO'}`);

// 8. Dashboard con datos reales (no 0s hardcoded)
console.log('\n7. Home con datos reales (no 0s hardcoded)...');
const homeScreen = fs.readFileSync(path.join(appDir, 'screens/home/home_screen.dart'), 'utf-8');
const hasRealData = homeScreen.includes('AppState') || homeScreen.includes('listAll') || homeScreen.includes('getDue');
console.log(`  ${hasRealData ? 'SÍ' : 'NO'}`);

// 9. Setup wizard con creación de vault
console.log('\n8. Setup wizard con creación de vault...');
const wizard = fs.readFileSync(path.join(appDir, 'screens/setup/setup_wizard.dart'), 'utf-8');
const hasCreateVault = wizard.includes('create(recursive: true)') || wizard.includes('vaultDir.create');
console.log(`  ${hasCreateVault ? 'SÍ' : 'NO'}`);

// Resumen
console.log('\n=== Resumen ===');
const allOk = allFound && brokenImports.length === 0 && forbiddenFound.length === 0 && argFound.length === 0 && hasAutoDifficulty && hasRealData && hasCreateVault;
console.log(allOk ? '✅ ALL VALIDATIONS PASS' : '❌ SOME VALIDATIONS FAILED');
process.exit(allOk ? 0 : 1);
