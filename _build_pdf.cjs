// _build_pdf.cjs: genera el informe PDF
const { execSync } = require('child_process');
const fs = require('fs');

process.chdir('/workspace/m-nexus');
function getCmd(cmd) {
  try { return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return ''; }
}

const gitLog = getCmd('git log --oneline -30');
const pubspecVersion = getCmd('grep "^version:" app/pubspec.yaml | head -1').trim();
const pkgVersion = getCmd('grep "version" backend/package.json | head -1').trim();
const fileCount = getCmd('find app/lib -name "*.dart" | wc -l').trim();
const backendFiles = getCmd('find backend/src -name "*.ts" | wc -l').trim();
const backendTests = getCmd('find backend/tests -name "*.ts" | wc -l').trim();

let backendTestResult = 'N/A';
try {
  const r = execSync('cd backend && timeout 90 npx vitest run --exclude "**/integration.test.ts" --reporter=basic 2>&1 | tail -10', { encoding: 'utf-8' });
  backendTestResult = r.split('\n').filter(l => l.includes('Tests') || l.includes('Test Files')).join('\n');
} catch (e) {
  backendTestResult = e.stdout ? e.stdout.split('\n').filter(l => l.includes('Tests') || l.includes('Test Files')).join('\n') : 'Error';
}

let backendTypecheck = 'OK - 0 errores';
try {
  execSync('cd backend && npx tsc --noEmit', { encoding: 'utf-8', stdio: 'pipe' });
} catch (e) {
  backendTypecheck = 'ERRORES';
}

console.log(JSON.stringify({
  gitLog: gitLog.split('\n').slice(0, 30),
  pubspecVersion,
  pkgVersion,
  fileCount,
  backendFiles,
  backendTests,
  backendTestResult,
  backendTypecheck,
}, null, 2));
