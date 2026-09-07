// validate_release_logic.cjs: valida la logica de deteccion de version del release.yml
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const yaml = require('yaml');

// Acepta ser ejecutado desde CUALQUIER cwd (busca el root del repo)
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  // fallback
  return path.resolve(__dirname, '..', '..', '..');
}

const root = findRepoRoot();
function rp(p) { return path.join(root, p); }

console.log('=== Release workflow validation ===\n');

const workflow = yaml.parse(fs.readFileSync(rp('.github/workflows/release.yml'), 'utf-8'));
console.log('1. Workflow parsed OK');
console.log('   Jobs:', Object.keys(workflow.jobs).join(', '));
console.log('   Trigger:', Object.keys(workflow.on).join(', '));

const pubspec = fs.readFileSync(rp('app/pubspec.yaml'), 'utf-8');
const versionMatch = pubspec.match(/^version:\s*(\S+)/m);
if (!versionMatch) { console.log('2. FAIL: no se pudo parsear pubspec version'); process.exit(1); }
const version = versionMatch[1].split('+')[0];
console.log(`2. Version actual: ${version}`);

let tags = [];
try {
  const out = execSync('git tag --list "v*"', { encoding: 'utf-8', cwd: root });
  tags = out.trim().split('\n').filter(Boolean).sort();
} catch (e) { console.log('   (no git tags)'); }
console.log(`3. Tags existentes: ${tags.length}`);
if (tags.length > 0) console.log(`   Ultimo: ${tags[tags.length - 1]}`);

const expectedTag = `v${version}`;
const latestTag = tags.length > 0 ? tags[tags.length - 1] : '';
const shouldRelease = latestTag !== expectedTag;
console.log(`4. should_release = ${shouldRelease} (esperado: ${expectedTag}, ultimo: ${latestTag})`);

const pkg = JSON.parse(fs.readFileSync(rp('backend/package.json'), 'utf-8'));
console.log(`5. Backend version: ${pkg.version} ${pkg.version === version ? 'OK' : 'MISMATCH!'}`);

const ksExists = fs.existsSync(rp('app/android/keystores/mnexus-release.keystore'));
const kpExists = fs.existsSync(rp('app/android/key.properties'));
console.log(`6. Keystore: ${ksExists ? 'OK' : 'FALTA'} | key.properties: ${kpExists ? 'OK' : 'FALTA'}`);

const gradleProps = fs.readFileSync(rp('app/android/gradle.properties'), 'utf-8');
const daemonOff = gradleProps.includes('org.gradle.daemon=false');
console.log(`7. gradle daemon=false: ${daemonOff ? 'OK' : 'FALTA'}`);

console.log('\n=== Asserciones ===');
const assert = (cond, msg) => console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
assert(workflow.jobs['detect-version'], 'Job detect-version existe');
assert(workflow.jobs['build-apk'], 'Job build-apk existe');
assert(workflow.jobs['create-release'], 'Job create-release existe');
assert(workflow.on.push, 'Trigger on push existe');
assert(workflow.permissions.contents === 'write', 'Permiso contents: write');
assert(version.length > 0, 'Version parseada');
assert(pkg.version === version, 'Backend == Frontend version');
assert(ksExists, 'Keystore existe');
assert(daemonOff, 'gradle daemon=false');

if (latestTag === expectedTag) {
  console.log(`\nNOTA: la version ${expectedTag} YA esta publicada como tag.`);
  console.log('Para forzar un nuevo release, edita pubspec.yaml (sube el numero)');
  console.log('o usa workflow_dispatch con force=true.');
} else {
  console.log(`\nLa proxima vez que se pushee a main, el CI publicara: ${expectedTag}`);
}
