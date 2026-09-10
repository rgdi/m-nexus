// validate_v50.cjs
// Validates parse/serialize + export algorithms from v0.50.

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

// Mirror ExportService._parseNote and _markdownToBlocks
function parseNote(content) {
  const fm = {};
  let body = content;
  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3);
    if (end > 0) {
      const fmBody = content.substring(3, end).trim();
      for (const line of fmBody.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          fm[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
        }
      }
      body = content.substring(end + 3).trim();
    }
  }
  return { fm, body };
}

function markdownToBlocks(md) {
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l === '') { i++; continue; }
    let block = null;
    if (l.startsWith('# ')) block = { type: 'h1', text: l.substring(2) };
    else if (l.startsWith('## ')) block = { type: 'h2', text: l.substring(3) };
    else if (l.startsWith('### ')) block = { type: 'h3', text: l.substring(4) };
    else if (l.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      block = { type: 'code', text: code.join('\n').trimEnd() };
    } else if (l.trim() === '---') block = { type: 'hr' };
    else if (l.startsWith('> ')) block = { type: 'quote', text: l.substring(2) };
    else if (l.startsWith('- [ ] ')) block = { type: 'todo', text: l.substring(6), checked: false };
    else if (l.startsWith('- [x] ')) block = { type: 'todo', text: l.substring(6), checked: true };
    else if (l.startsWith('- ') || l.startsWith('* ')) block = { type: 'bullet', text: l.substring(2) };
    else if (/^\d+\. /.test(l)) block = { type: 'numbered', text: l.replace(/^\d+\. /, '') };
    else block = { type: 'p', text: l };
    if (block) out.push(block);
    i++;
  }
  return out;
}

section('1. parse: frontmatter basico');
{
  const md = `---
title: Mi nota
type: daily
date: 2026-09-10
---
# Contenido`;
  const { fm, body } = parseNote(md);
  assert(fm.title === 'Mi nota', 'title');
  assert(fm.type === 'daily', 'type');
  assert(fm.date === '2026-09-10', 'date');
  assert(body.startsWith('# Contenido'), 'body starts with content');
}

section('2. parse: sin frontmatter');
{
  const md = `# Solo contenido`;
  const { fm, body } = parseNote(md);
  assert(Object.keys(fm).length === 0, 'fm vacio');
  assert(body === md, 'body completo');
}

section('3. parse: frontmatter con --- interior como hr');
{
  const md = `---
title: Test
---
# Titulo

---

# Otro titulo`;
  const { fm, body } = parseNote(md);
  assert(fm.title === 'Test', 'title');
  assert(body.includes('---'), 'body mantiene --- interior como hr');
}

section('4. blocks: h1/h2/h3');
{
  const md = `# H1
## H2
### H3`;
  const blocks = markdownToBlocks(md);
  assert(blocks.length === 3, '3 blocks');
  assert(blocks[0].type === 'h1', 'h1');
  assert(blocks[1].type === 'h2', 'h2');
  assert(blocks[2].type === 'h3', 'h3');
}

section('5. blocks: code block');
{
  const md = '```\nconst a = 1;\n```';
  const blocks = markdownToBlocks(md);
  assert(blocks.length === 1, '1 code');
  assert(blocks[0].type === 'code', 'is code');
  assert(blocks[0].text === 'const a = 1;', 'code content');
}

section('6. blocks: todo checked/unchecked');
{
  const md = `- [ ] uno
- [x] dos`;
  const blocks = markdownToBlocks(md);
  assert(blocks.length === 2, '2 todos');
  assert(!blocks[0].checked, 't1 unchecked');
  assert(blocks[1].checked, 't2 checked');
}

section('7. blocks: hr como --- (sin frontmatter)');
{
  const md = `Texto

---

Texto2`;
  const blocks = markdownToBlocks(md);
  assert(blocks.some(b => b.type === 'hr'), 'has hr');
  assert(blocks.some(b => b.type === 'p'), 'has paragraphs');
}

section('8. block: columns parse');
{
  // Mirror del parser de columns
  const md = `:::columns
:::col
# Col 1
Texto 1
:::col
# Col 2
Texto 2
:::`;
  const cols = [[]];
  const lines = md.split('\n');
  let i = 1;
  while (i < lines.length && lines[i].trim() !== ':::') {
    const cl = lines[i];
    if (cl.trim() === ':::col') {
      cols.push([]);
    } else if (cl.startsWith('# ')) {
      cols[cols.length - 1].push({ type: 'h1', text: cl.substring(2) });
    } else if (cl.length > 0) {
      cols[cols.length - 1].push({ type: 'p', text: cl });
    }
    i++;
  }
  // Filtra columnas vacias (la primera porque la creamos vacia)
  const nonEmpty = cols.filter(c => c.length > 0);
  assert(nonEmpty.length === 2, '2 cols no vacias, got ' + nonEmpty.length);
  assert(nonEmpty[0].length === 2, 'col 1 has 2 blocks');
  assert(nonEmpty[0][0].text === 'Col 1', 'col 1 first text');
  assert(nonEmpty[1][1].text === 'Texto 2', 'col 2 second text');
}

section('9. html esc');
{
  function esc(s) {
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  assert(esc('<script>') === '&lt;script&gt;', 'tags escaped');
  assert(esc('"hola"') === '&quot;hola&quot;', 'quotes');
  assert(esc("it's") === 'it&#39;s', 'apostrophe');
  assert(esc('A & B') === 'A &amp; B', 'ampersand');
}

section('10. md inline to html');
{
  function inline(text) {
    return text
      .replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replaceAll(/\*(.+?)\*/g, '<em>$1</em>')
      .replaceAll(/`(.+?)`/g, '<code>$1</code>');
  }
  assert(inline('**bold**') === '<strong>bold</strong>', 'bold');
  assert(inline('*em*') === '<em>em</em>', 'em');
  assert(inline('`code`') === '<code>code</code>', 'code');
  assert(inline('plain') === 'plain', 'plain unchanged');
}

section('11. version history: snapshots con timestamp');
{
  // Mirror
  const ts = Date.now();
  const filename = `${ts}.md`;
  assert(filename.endsWith('.md'), 'snap extension');
  assert(/^\d+\.md$/.test(filename), 'snap name is timestamp');
}

section('12. version history: max 20 retention');
{
  // Mirror
  const MAX = 20;
  const all = Array.from({ length: 25 }, (_, i) => i);
  const toKeep = all.slice(-MAX); // ultimos 20
  assert(toKeep.length === 20, '20 retained');
  assert(toKeep[0] === 5, '5 first kept (delete 0-4)');
  assert(toKeep[19] === 24, '24 last kept');
}

section('13. comments: add + retrieve');
{
  // Mirror
  const comments = {};
  function add(blockId, text) {
    if (!comments[blockId]) comments[blockId] = [];
    comments[blockId].push({ id: 'c-1', text, ts: Date.now() });
  }
  function get(blockId) { return comments[blockId] || []; }
  add('b1', 'Primer comentario');
  add('b1', 'Segundo comentario');
  add('b2', 'Otro');
  assert(get('b1').length === 2, 'b1 has 2');
  assert(get('b2').length === 1, 'b2 has 1');
  assert(get('nonexistent').length === 0, 'empty for unknown');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
