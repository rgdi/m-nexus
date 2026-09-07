// validate_fsrs.cjs: replica el algoritmo FSRS del app + backend en Node.js
// y valida la logica de los 4 buttons del review UI.

const fsrs = require('/workspace/m-nexus/backend/node_modules/ts-fsrs');

console.log('=== FSRS validation (mismo algoritmo que app y backend) ===\n');

// Test 1: Card nueva, primer review
console.log('Test 1: Card nueva, primer review con Good');
let card = {
  due: new Date(),
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  reps: 0,
  lapses: 0,
  state: 0, // new
  last_review: undefined,
};
const f = new fsrs.FSRS();
const now1 = new Date();
const result1 = f.repeat(card, now1);
const goodCard1 = result1['3'].card; // Good rating = key '3'
console.log('  Estado nuevo:', stateName(goodCard1.state));
console.log('  Stability:', goodCard1.stability.toFixed(2));
console.log('  Difficulty:', goodCard1.difficulty.toFixed(2));
console.log('  Reps:', goodCard1.reps);
console.log('  Scheduled days:', goodCard1.scheduled_days);
console.log('  Next due:', goodCard1.due.toISOString().slice(0, 10));

// Test 2: Misma card, segundo review con Good
console.log('\nTest 2: Misma card, segundo review con Good (3 dias despues)');
const now2 = new Date(Date.now() + 3 * 86400000);
const result2 = f.repeat(goodCard1, now2);
const goodCard2 = result2['3'].card;
console.log('  Stability:', goodCard2.stability.toFixed(2));
console.log('  Reps:', goodCard2.reps);
console.log('  Scheduled days:', goodCard2.scheduled_days);

// Test 3: Again en la card 2
console.log('\nTest 3: Card 2, review con Again (lapse)');
const now3 = new Date(Date.now() + 7 * 86400000);
const result3 = f.repeat(goodCard2, now3);
const againCard3 = result3['1'].card; // Again = key '1'
console.log('  Estado nuevo:', stateName(againCard3.state));
console.log('  Lapses:', againCard3.lapses);
console.log('  Stability:', againCard3.stability.toFixed(2));
console.log('  Scheduled days:', againCard3.scheduled_days);

function stateName(s) {
  return ['new', 'learning', 'review', 'relearning'][s];
}

// Test 4: 4 buttons devuelven 4 predicciones distintas
console.log('\nTest 4: Las 4 predicciones son distintas');
const result4 = f.repeat(goodCard2, now3);
// ts-fsrs 5.x: keys son '1' (Again), '2' (Hard), '3' (Good), '4' (Easy)
const predictions = [
  { rating: 'Again', key: '1' },
  { rating: 'Hard',  key: '2' },
  { rating: 'Good',  key: '3' },
  { rating: 'Easy',  key: '4' },
].map(({ rating, key }) => {
  const p = result4[key];
  return { rating, scheduledDays: p.card.scheduled_days, stability: p.card.stability.toFixed(2) };
});
predictions.forEach(p => {
  console.log('  ' + p.rating + ': ' + p.scheduledDays + ' dias, S=' + p.stability);
});

// Asserciones
console.log('\n=== Asserciones ===');
const assert = (cond, msg) => console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
assert(goodCard1.scheduled_days === 0 && goodCard1.state === 1, 'Primer Good: new -> learning (interval 0)');
assert(goodCard2.scheduled_days > goodCard1.scheduled_days, 'Segundo Good tiene interval mayor');
assert(againCard3.lapses === 1, 'Again incrementa lapses');
assert(againCard3.state === 1 || againCard3.state === 3, 'Again cambia a learning o relearning');
assert(predictions[0].scheduledDays < predictions[1].scheduledDays, 'Again < Hard');
assert(predictions[1].scheduledDays < predictions[2].scheduledDays, 'Hard < Good');
assert(predictions[2].scheduledDays < predictions[3].scheduledDays, 'Good < Easy');
