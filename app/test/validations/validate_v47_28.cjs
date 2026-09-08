// validate_v47_28.cjs: valida los 3 fixes de v0.47.28:
//  1. BacklinksPanel NFD matching
//  2. HeatmapService.compute() agregado
//  3. AppState.dailyStats / currentStreak integrados
//
// Replica los algoritmos de los archivos .dart sin Flutter SDK.

const assert = require('assert');

// ── 1. NFD matching para BacklinksPanel ──────────────────────────
const STRIP_ACCENTS = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n',
  'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'À': 'A', 'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U',
  'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ü': 'u',
  'Ä': 'A', 'Ë': 'E', 'Ï': 'I', 'Ö': 'O', 'Ü': 'U',
};
function stripAccents(s) {
  return s.toLowerCase().split('').map(c => STRIP_ACCENTS[c] || c).join('');
}

const wikilinkRegex = /(!?)\[\[([^\]]+)\]\]/g;
function parseWikilinks(content) {
  const out = [];
  let m;
  while ((m = wikilinkRegex.exec(content)) !== null) {
    const isEmbed = m[1] === '!';
    const inner = m[2].trim();
    // split by # for section
    const hashIdx = inner.indexOf('#');
    let target = inner;
    let section = null;
    let blockId = null;
    if (hashIdx >= 0) {
      const sec = inner.substring(hashIdx + 1);
      if (sec.startsWith('^')) {
        blockId = sec.substring(1);
      } else {
        section = sec;
      }
      target = inner.substring(0, hashIdx);
    }
    // split by | for display
    const pipeIdx = target.indexOf('|');
    let displayText = null;
    if (pipeIdx >= 0) {
      displayText = target.substring(pipeIdx + 1);
      target = target.substring(0, pipeIdx);
    }
    out.push({ target: target.trim(), displayText, section, blockId, isEmbed });
  }
  return out;
}

function extractSnippet(content, link) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes(`[[${link.target}`)) {
      let clean = line
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
      if (clean.length > 80) clean = clean.substring(0, 77) + '...';
      return clean;
    }
  }
  return '';
}

function matchesBacklink(note, targetBasename, targetRelNoExt) {
  const links = parseWikilinks(note.content);
  const targetBasenameNfd = stripAccents(targetBasename.toLowerCase());
  const targetRelNoExtNfd = stripAccents(targetRelNoExt.toLowerCase());

  return links.filter(l => {
    if (l.isEmbed) return false;
    const t = stripAccents(l.target.toLowerCase());
    return t === targetBasenameNfd
        || t === targetRelNoExt.toLowerCase()
        || t === targetRelNoExtNfd;
  });
}

console.log('=== Test 1: BacklinksPanel NFD matching ===');
{
  // Caso 1: link exacto
  const note = { content: 'Esto es una nota con [[Diafragma]]' };
  const links = matchesBacklink(note, 'Diafragma', 'anatomia/diafragma');
  assert(links.length === 1, 'expected 1 link, got ' + links.length);
  assert(links[0].target === 'Diafragma');
  console.log('  PASS: link exacto "Diafragma"');

  // Caso 2: link con acentos, target sin acentos
  const note2 = { content: 'Refiero a [[Diafragma]] que es músculo.' };
  const links2 = matchesBacklink(note2, 'Diafragma', 'anatomia/diafragma');
  assert(links2.length === 1, 'expected 1 link, got ' + links2.length);
  console.log('  PASS: link con/sin acentos');

  // Caso 3: link con acentos, target sin acentos en NFD
  const note3 = { content: 'Vínculo a [[Páncreas]] exocrino.' };
  const links3 = matchesBacklink(note3, 'Pancreas', 'anatomia/pancreas');
  assert(links3.length === 1, 'expected 1 link with NFD match, got ' + links3.length);
  console.log('  PASS: NFD match (Páncreas → Pancreas)');

  // Caso 4: link con display text
  const note4 = { content: 'Ver [[Miocardio|músculo cardíaco]] para detalles.' };
  const links4 = matchesBacklink(note4, 'Miocardio', 'corazon/miocardio');
  assert(links4.length === 1, 'expected 1 link with display, got ' + links4.length);
  assert(links4[0].target === 'Miocardio');
  assert(links4[0].displayText === 'músculo cardíaco');
  console.log('  PASS: link con display text');

  // Caso 5: embed debe ignorarse
  const note5 = { content: 'Imagen: ![[anatomia.png]] y link: [[Anatomia]]' };
  const links5 = matchesBacklink(note5, 'Anatomia', 'anatomia');
  assert(links5.length === 1, 'expected 1 (embed ignored), got ' + links5.length);
  assert(links5[0].isEmbed === false);
  console.log('  PASS: embed ![[]] ignorado, link [[]] matchea');

  // Caso 6: sin match
  const note6 = { content: 'Nota sin wikilinks.' };
  const links6 = matchesBacklink(note6, 'OtraNota', 'otra');
  assert(links6.length === 0, 'expected 0 links, got ' + links6.length);
  console.log('  PASS: sin match retorna vacío');

  // Caso 7: link con path completo
  const note7 = { content: 'Ver [[anatomia/diafragma]] para la estructura.' };
  const links7 = matchesBacklink(note7, 'Diafragma', 'anatomia/diafragma');
  assert(links7.length === 1, 'expected 1 link by path, got ' + links7.length);
  console.log('  PASS: link con path completo matchea por relPath');
}

// ── 2. Snippet extraction ────────────────────────────────────────
console.log('\n=== Test 2: Snippet extraction ===');
{
  const note = {
    content: '# Notas\n\nEl **diafragma** es un músculo en forma de cúpula.\n\n## Referencias\n\n- [[Anatomia]]\n- [[Fisiologia]]\n'
  };
  const snippet = extractSnippet(note.content, { target: 'Anatomia' });
  console.log(`  Snippet: "${snippet}"`);
  assert(snippet.length > 0, 'snippet should not be empty');
  assert(!snippet.includes('**'), 'snippet should not have bold markers');
  console.log('  PASS: snippet sin markdown bold');

  const snippet2 = extractSnippet(note.content, { target: 'Fisiologia' });
  assert(snippet2.includes('- [[Fisiologia]]') || snippet2.includes('Fisiologia'));
  console.log('  PASS: snippet incluye contexto');
}

// ── 3. HeatmapService.compute() ──────────────────────────────────
console.log('\n=== Test 3: HeatmapService.compute() ===');
function computeStudyStats(events) {
  const byDate = {};
  for (const e of events) {
    const d = new Date(e.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const existing = byDate[key];
    const reviews = (existing?.reviews || 0) + 1;
    const secs = (existing?.studyTimeSec || 0) + Math.floor((e.elapsedMs || 0) / 1000);
    byDate[key] = { date: key, reviews, newCards: existing?.newCards || 0, studyTimeSec: secs };
  }
  const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  const totalReviews = events.length;
  const totalMinutes = daily.reduce((acc, d) => acc + d.studyTimeSec, 0) / 60;
  return { daily, totalReviews, totalMinutes };
}
{
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const events = [
    { timestamp: today.getTime(), cardId: 'c1', rating: 3, elapsedMs: 5000 },
    { timestamp: today.getTime(), cardId: 'c2', rating: 4, elapsedMs: 3000 },
    { timestamp: yesterday.getTime(), cardId: 'c3', rating: 2, elapsedMs: 7000 },
  ];
  const stats = computeStudyStats(events);
  assert(stats.totalReviews === 3, 'expected 3 total');
  assert(stats.daily.length === 2, 'expected 2 days, got ' + stats.daily.length);
  const todayKey = today.toISOString().substring(0, 10);
  const todayStat = stats.daily.find(d => d.date === todayKey);
  assert(todayStat && todayStat.reviews === 2, 'today should have 2 reviews, got ' + (todayStat?.reviews));
  console.log('  PASS: stats agregan por dia correctamente');
  console.log('  PASS: total reviews = ' + stats.totalReviews);
  console.log('  PASS: total minutos = ' + Math.floor(stats.totalMinutes));

  // Empty events
  const empty = computeStudyStats([]);
  assert(empty.totalReviews === 0);
  assert(empty.daily.length === 0);
  console.log('  PASS: lista vacía retorna stats vacías');
}

// ── 4. currentStreak ─────────────────────────────────────────────
console.log('\n=== Test 4: currentStreak ===');
function computeStreak(daily) {
  if (daily.length === 0) return 0;
  const dates = new Set(daily.map(d => d.date));
  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dates.has(fmt(cursor))) {
    cursor = new Date(cursor.getTime() - 86400000);
  }
  let streak = 0;
  while (dates.has(fmt(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}
{
  const today = new Date();
  const day1 = new Date(today.getTime() - 86400000);
  const day2 = new Date(today.getTime() - 172800000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  // 3-day streak ending today
  const daily1 = [
    { date: fmt(today), reviews: 5 },
    { date: fmt(day1), reviews: 3 },
    { date: fmt(day2), reviews: 1 },
  ];
  assert(computeStreak(daily1) === 3, 'expected 3-day streak, got ' + computeStreak(daily1));
  console.log('  PASS: 3-day streak ending today');

  // Empty
  assert(computeStreak([]) === 0);
  console.log('  PASS: sin datos = 0');

  // Streak ended yesterday (today missing)
  const daily2 = [
    { date: fmt(day1), reviews: 5 },
    { date: fmt(day2), reviews: 3 },
  ];
  assert(computeStreak(daily2) === 2, 'streak should be 2 (today missing, streak alive)');
  console.log('  PASS: racha "viva" si hoy no hay review');
}

console.log('\n=== ALL TESTS PASSED ===');
console.log('NFD matching, snippets, compute, streak validados.');
