// test_auto_update.cjs: valida lógica de auto-update sin red.
// Replica la función compareVersions de updater_models.dart.

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const ai = i < pa.length ? pa[i] : 0;
    const bi = i < pb.length ? pb[i] : 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

function isNewer(latest, installed) {
  if (!installed) return false;
  return compareVersions(latest, installed) > 0;
}

// Tests
let pass = 0, fail = 0;
function test(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  PASS: ${name}`);
  } else {
    fail++;
    console.log(`  FAIL: ${name} (got ${actual}, expected ${expected})`);
  }
}

console.log('=== Auto-update logic tests ===');
test('0.47.0 vs 0.46.9', isNewer('0.47.0', '0.46.9'), true);
test('0.47.2 vs 0.47.1', isNewer('0.47.2', '0.47.1'), true);
test('0.47.1 vs 0.47.1', isNewer('0.47.1', '0.47.1'), false);
test('0.47.0 vs 0.47.1', isNewer('0.47.0', '0.47.1'), false);
test('0.48.0 vs 0.47.9', isNewer('0.48.0', '0.47.9'), true);
test('v0.47.0 vs 0.46.9 (prefix)', isNewer('v0.47.0', '0.46.9'), true);
test('null installed', isNewer('0.47.0', null), false);
test('empty installed', isNewer('0.47.0', ''), false);
test('equal 1.0.0', isNewer('1.0.0', '1.0.0'), false);
test('compare 1.0.0 vs 1.0.1', compareVersions('1.0.0', '1.0.1'), -1);
test('compare 1.1.0 vs 1.0.0', compareVersions('1.1.0', '1.0.0'), 1);
test('compare 0.10.0 vs 0.9.0', compareVersions('0.10.0', '0.9.0'), 1);

console.log(`\n=== ${pass}/${pass+fail} pass ===`);
process.exit(fail > 0 ? 1 : 0);
