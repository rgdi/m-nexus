// validate_text_scaler.cjs
// Validates the textScaler clamp at the app root (v0.49.19).

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

// Mirror of clamp logic in main.dart builder
function effectiveScale(userScale, systemScale) {
  // mq.textScaler.scale(14) / 14 = systemScale
  return Math.max(0.85, Math.min(userScale * systemScale, 1.25));
}

section('1. Default: userScale=1.0, system=1.0 -> 1.0');
{
  assert(effectiveScale(1.0, 1.0) === 1.0, '1.0 * 1.0 = 1.0');
}

section('2. User 1.30, system 1.0 -> 1.25 (clamp)');
{
  assert(effectiveScale(1.30, 1.0) === 1.25, '1.30 clamped to 1.25');
}

section('3. User 1.0, system 1.5 (150%) -> 1.25 (clamp)');
{
  assert(effectiveScale(1.0, 1.5) === 1.25, '1.5 clamped to 1.25');
}

section('4. User 1.0, system 2.0 (200%) -> 1.25 (clamp)');
{
  assert(effectiveScale(1.0, 2.0) === 1.25, '2.0 clamped to 1.25');
}

section('5. User 1.30, system 1.3 -> 1.25 (multiplicado pero clamp)');
{
  // 1.30 * 1.3 = 1.69, clamp a 1.25
  assert(effectiveScale(1.30, 1.3) === 1.25, '1.69 clamped to 1.25');
}

section('6. User 0.85, system 1.0 -> 0.85 (min)');
{
  assert(effectiveScale(0.85, 1.0) === 0.85, '0.85 min');
}

section('7. User 0.85, system 0.85 -> 0.7225 -> clamp 0.85');
{
  // 0.85 * 0.85 = 0.7225, pero min es 0.85
  assert(effectiveScale(0.85, 0.85) === 0.85, 'product < min clamped up');
}

section('8. User 1.15 (default), system 1.25 -> 1.25 (casi al limite)');
{
  // 1.15 * 1.25 = 1.4375, clamp 1.25
  assert(effectiveScale(1.15, 1.25) === 1.25, '1.4375 clamped');
}

section('9. Caso edge: user 1.0, system 1.20 (limite Android) -> 1.20');
{
  assert(effectiveScale(1.0, 1.20) === 1.20, '1.20 dentro del limite');
}

section('10. Anti-regression: min no permite < 0.85');
{
  for (let s = 0.5; s <= 1.5; s += 0.1) {
    const e = effectiveScale(s, 1.0);
    assert(e >= 0.85, `effectiveScale(${s}, 1.0) = ${e} >= 0.85`);
  }
}

section('11. Anti-regression: max no permite > 1.25');
{
  for (let s = 0.5; s <= 2.0; s += 0.1) {
    for (let sys = 0.5; sys <= 2.0; sys += 0.1) {
      const e = effectiveScale(s, sys);
      assert(e <= 1.25, `effectiveScale(${s}, ${sys}) = ${e} <= 1.25`);
    }
  }
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
