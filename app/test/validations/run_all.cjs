// run_all.cjs: ejecuta TODAS las validaciones de los algoritmos app-side
// en Node.js (mismo algoritmo que el código Dart, sin Flutter SDK).
//
// Uso: node test/validations/run_all.cjs
// Exit code: 0 si todos pasan, 1 si alguno falla.

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Encuentra el root del repo (donde está backend/node_modules con `yaml`)
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '..', '..', '..');
}
const repoRoot = findRepoRoot();
const nodeModulesPath = path.join(repoRoot, 'backend', 'node_modules');

const validations = [
  'validate_fsrs.cjs',
  'validate_cloze_search.cjs',
  'validate_list_recent.cjs',
  'validate_clients.cjs',
  'validate_backlinks.cjs',
  'validate_transcribe.cjs',
  'validate_release.cjs',
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
    // NODE_PATH para que encuentre el paquete 'yaml' en backend/node_modules
    const result = spawnSync('node', [filepath], {
      encoding: 'utf-8',
      env: { ...process.env, NODE_PATH: nodeModulesPath },
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      allPassed = false;
    }
  } catch (e) {
    console.error('FAIL:', file, '\n', e.message);
    allPassed = false;
  }
  console.log();
}

console.log('='.repeat(60));
console.log(allPassed ? 'ALL VALIDATIONS PASSED' : 'SOME VALIDATIONS FAILED');
console.log('='.repeat(60));
process.exit(allPassed ? 0 : 1);
