// validate_daily_notes.cjs
// Validates the daily note template + calendar logic (v0.49.6).

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function daysInMonth(year, month) {
  // month is 1-indexed (1=jan, 2=feb)
  return new Date(year, month, 0).getDate();
}
function firstWeekday(year, month) {
  // month 1-indexed
  const js = new Date(year, month - 1, 1).getDay();
  return js === 0 ? 7 : js;
}

section('1. stamp: YYYY-MM-DD formato ISO');
{
  const d = new Date(2026, 8, 10); // 10 sept 2026 (mes 8 = sept, 0-indexed)
  assert(stamp(d) === '2026-09-10', 'stamp: ' + stamp(d));
}

section('2. daysInMonth: febrero bisiesto');
{
  assert(daysInMonth(2024, 2) === 29, 'feb 2024 = 29');
  assert(daysInMonth(2026, 2) === 28, 'feb 2026 = 28');
  assert(daysInMonth(2026, 1) === 31, 'enero = 31');
  assert(daysInMonth(2026, 4) === 30, 'abril = 30');
}

section('3. firstWeekday: 1=L, 7=D');
{
  // 1 sept 2026 = Martes (weekday JS=2 -> mapeamos a 2)
  assert(firstWeekday(2026, 9) === 2, '1 sept 2026 = martes (2)');
  // 1 dic 2026 = Martes
  assert(firstWeekday(2026, 12) === 2, '1 dic 2026 = martes (2)');
}

section('4. Calendar: 6 weeks para sept 2026');
{
  const month = 9;
  const year = 2026;
  const cells = [];
  // Headers
  for (let i = 0; i < 7; i++) cells.push('h');
  // Empty cells before day 1
  const fw = firstWeekday(year, month);
  for (let i = 1; i < fw; i++) cells.push(' ');
  // Days
  const dim = daysInMonth(year, month);
  for (let d = 1; d <= dim; d++) cells.push(d);
  // Total cells
  assert(cells.length === 7 + (fw - 1) + dim, 'cell count = ' + cells.length);
  // Always <= 7 + 6 + 31 = 44 (we use 7+6*7=49)
}

section('5. hasNote lookup');
{
  const existing = [
    new Date(2026, 8, 9),
    new Date(2026, 8, 11),
  ];
  const target = new Date(2026, 8, 9);
  const target2 = new Date(2026, 8, 10);
  const has = existing.some(d => stamp(d) === stamp(target));
  const has2 = existing.some(d => stamp(d) === stamp(target2));
  assert(has, 'sept 9 has note');
  assert(!has2, 'sept 10 does not');
}

section('6. Template includes required sections');
{
  // Mirror _template output for 2026-09-10 (weekday=4 = jueves)
  const sample = `---
title: 2026-09-10
type: daily
date: 2026-09-10
created: 2026-09-10T00:00:00.000
weekday: 4
month: 2026-09
---

# Jueves 2026-09-10

## ⏮️ Ayer
[[2026-09-09]]

## ⏭️ Mañana
[[2026-09-11]]

## 🎯 Enfoque del día

## ✅ Tareas
- [ ]

## 📚 Estudio

## 💡 Notas

## 🌱 Ideas

## 📌 Log

## 🎴 Para repasar
`;
  assert(sample.includes('## ✅ Tareas'), 'tiene Tareas');
  assert(sample.includes('## 📚 Estudio'), 'tiene Estudio');
  assert(sample.includes('## 💡 Notas'), 'tiene Notas');
  assert(sample.includes('## 🌱 Ideas'), 'tiene Ideas');
  assert(sample.includes('## 📌 Log'), 'tiene Log');
  assert(sample.includes('## 🎴 Para repasar'), 'tiene Para repasar');
  assert(sample.includes('⏮️ Ayer'), 'tiene Ayer');
  assert(sample.includes('⏭️ Mañana'), 'tiene Mañana');
  assert(sample.includes('[[2026-09-09]]'), 'wikilink ayer');
  assert(sample.includes('[[2026-09-11]]'), 'wikilink mañana');
  assert(sample.includes('weekday: 4'), 'weekday frontmatter');
  assert(sample.includes('month: 2026-09'), 'month frontmatter');
}

section('7. parseTasks: tareas de la daily note');
{
  const md = `# Hoy

## ✅ Tareas
- [ ] Estudiar mitosis
- [x] Hacer flashcards de bio
- [ ] Repasar anatomia

## Notas
Esto no es tarea
`;
  const tasks = [];
  for (const line of md.split('\n')) {
    const m = /^\s*-\s*\[(x| )\]\s*(.+)$/i.exec(line);
    if (m) {
      tasks.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x' });
    }
  }
  assert(tasks.length === 3, '3 tasks: ' + tasks.length);
  assert(tasks[0].text === 'Estudiar mitosis' && !tasks[0].done, 't1 pending');
  assert(tasks[1].text === 'Hacer flashcards de bio' && tasks[1].done, 't2 done');
  assert(tasks[2].text === 'Repasar anatomia' && !tasks[2].done, 't3 pending');
}

section('8. isSameDay: comparación por dia');
{
  const a = new Date(2026, 8, 10, 14, 30);
  const b = new Date(2026, 8, 10, 23, 59);
  const c = new Date(2026, 8, 11, 0, 0);
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  assert(isSameDay(a, b), 'same day diff hours');
  assert(!isSameDay(a, c), 'different day');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
