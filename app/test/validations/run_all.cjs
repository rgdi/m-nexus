// run_all.cjs: ejecuta TODAS las validaciones de los algoritmos app-side
// en Node.js (mismo algoritmo que el código Dart, sin Flutter SDK).
//
// Uso: node test/validations/run_all.cjs
// Exit code: 0 si todos pasan, 1 si alguno falla.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const validations = [
  'validate_fsrs.cjs',
  'validate_cloze_search.cjs',
  'validate_list_recent.cjs',
  'validate_clients.cjs',
  'validate_backlinks.cjs',
  'validate_transcribe.cjs',
];

console.log('='.repeat(60));
console.log('M-NEXUS APP-SIDE ALGORITHM VALIDATIONS (Node.js)');
console.log('='.repeat(60));
console.log('Validations:', validations.length);
console.log();

let allPassed = true;
for (const file of validations) {
  const filepath = path.join(__dirname, file);
  if (!fs.existsSync(filepath)) {
    console.log('SKIP:', file, '(no existe)');
    continue;
  }
  console.log('--- Running', file, '---');
  try {
    const out = execSync(`node ${filepath}`, { encoding: 'utf-8' });
    process.stdout.write(out);
  } catch (e) {
    console.error('FAIL:', file, '\n', e.stdout || e.message);
    allPassed = false;
  }
  console.log();
}

console.log('='.repeat(60));
console.log(allPassed ? 'ALL VALIDATIONS PASSED' : 'SOME VALIDATIONS FAILED');
console.log('='.repeat(60));
process.exit(allPassed ? 0 : 1);
