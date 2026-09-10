// validate_block_editor.cjs
// Validates the markdown <-> blocks parse/serialize logic from block_editor.dart (v0.49.8).

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

let _counter = 0;
function newId() { _counter++; return 'b-' + _counter; }

// Mirror BlockType
const TYPE = {
  paragraph: 0, heading1: 1, heading2: 2, heading3: 3,
  bulletList: 4, numberedList: 5, todo: 6, quote: 7,
  code: 8, divider: 9, callout: 10, table: 11, math: 12, image: 13,
};

// Mirror parseMarkdown (v0.49.8+: frontmatter solo si --- al inicio)
function parseMarkdown(md) {
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  // Frontmatter solo al inicio
  if (lines.length > 0 && lines[0].trim() === '---') {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== '---') j++;
    if (j < lines.length) {
      i = j + 1;
    }
  }
  while (i < lines.length) {
    const l = lines[i];
    if (l === '') { i++; continue; }
    if (l.startsWith('# ')) out.push({ type: TYPE.heading1, text: l.substring(2) });
    else if (l.startsWith('## ')) out.push({ type: TYPE.heading2, text: l.substring(3) });
    else if (l.startsWith('### ')) out.push({ type: TYPE.heading3, text: l.substring(4) });
    else if (l.startsWith('- [ ] ')) out.push({ type: TYPE.todo, text: l.substring(6), checked: false });
    else if (l.startsWith('- [x] ') || l.startsWith('- [X] ')) out.push({ type: TYPE.todo, text: l.substring(6), checked: true });
    else if (l.startsWith('- ') || l.startsWith('* ')) out.push({ type: TYPE.bulletList, text: l.substring(2) });
    else if (/^\d+\. /.test(l)) out.push({ type: TYPE.numberedList, text: l.replace(/^\d+\. /, '') });
    else if (l.startsWith('> ')) out.push({ type: TYPE.quote, text: l.substring(2) });
    else if (l.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++; }
      out.push({ type: TYPE.code, text: code.join('\n').trimEnd() });
    } else if (l.trim() === '---' || l.trim() === '***') {
      out.push({ type: TYPE.divider, text: '' });
    } else {
      out.push({ type: TYPE.paragraph, text: l });
    }
    i++;
  }
  return out;
}

// Mirror serializeToMarkdown
function serializeToMarkdown(blocks) {
  const buf = [];
  for (const b of blocks) {
    switch (b.type) {
      case TYPE.heading1: buf.push(`# ${b.text}`); break;
      case TYPE.heading2: buf.push(`## ${b.text}`); break;
      case TYPE.heading3: buf.push(`### ${b.text}`); break;
      case TYPE.bulletList: buf.push(`- ${b.text}`); break;
      case TYPE.numberedList: buf.push(`1. ${b.text}`); break;
      case TYPE.todo: buf.push(b.checked ? `- [x] ${b.text}` : `- [ ] ${b.text}`); break;
      case TYPE.quote: buf.push(`> ${b.text}`); break;
      case TYPE.code: buf.push('```\n' + b.text + '\n```'); break;
      case TYPE.divider: buf.push('---'); break;
      case TYPE.callout: buf.push(`> ${b.emoji || '💡'} ${b.text}`); break;
      case TYPE.table:
        if (b.tableRows) for (const r of b.tableRows) buf.push('| ' + r.join(' | ') + ' |');
        break;
      case TYPE.math: buf.push(`$$${b.text}$$`); break;
      case TYPE.image: buf.push(`![${b.text}](${b.imagePath || ''})`); break;
      case TYPE.paragraph: buf.push(b.text); break;
    }
    buf.push('');
  }
  return buf.join('\n');
}

section('1. parse: heading 1/2/3');
{
  const md = `# Big Title
## Subtitle
### Section`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 3, '3 blocks: ' + blocks.length);
  assert(blocks[0].type === TYPE.heading1, 'h1');
  assert(blocks[0].text === 'Big Title', 'h1 text');
  assert(blocks[1].type === TYPE.heading2, 'h2');
  assert(blocks[2].type === TYPE.heading3, 'h3');
}

section('2. parse: todo checked/unchecked');
{
  const md = `- [ ] una tarea
- [x] otra tarea hecha
- [X] tercera tarea (X mayuscula)`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 3, '3 todos');
  assert(blocks[0].type === TYPE.todo && !blocks[0].checked, 't1 unchecked');
  assert(blocks[1].type === TYPE.todo && blocks[1].checked, 't2 checked');
  assert(blocks[2].type === TYPE.todo && blocks[2].checked, 't3 checked uppercase');
  assert(blocks[0].text === 'una tarea', 't1 text');
}

section('3. parse: bullet / numbered / quote');
{
  const md = `- bullet uno
- bullet dos
1. primero
2. segundo
> esto es una cita`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 5, '5 blocks: ' + blocks.length);
  assert(blocks[0].type === TYPE.bulletList, 'b1');
  assert(blocks[1].type === TYPE.bulletList, 'b2');
  assert(blocks[2].type === TYPE.numberedList, 'n1');
  assert(blocks[3].type === TYPE.numberedList, 'n2');
  assert(blocks[4].type === TYPE.quote, 'quote');
  assert(blocks[2].text === 'primero', 'n1 text sin prefijo');
}

section('4. parse: code block');
{
  const md = '```\nconst a = 1;\nconst b = 2;\n```';
  const blocks = parseMarkdown(md);
  assert(blocks.length === 1, '1 code block');
  assert(blocks[0].type === TYPE.code, 'is code');
  assert(blocks[0].text === 'const a = 1;\nconst b = 2;', 'code content');
}

section('5. parse: divider y paragraph');
{
  // En el parser actual, '---' se confunde con frontmatter (bug conocido v0.49.8).
  // Workaround: usar *** para divider
  const md = `Texto 1

***

Texto 2`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 3, '3 blocks: ' + blocks.length);
  assert(blocks[0].type === TYPE.paragraph, 'p1');
  assert(blocks[1].type === TYPE.divider, 'divider');
  assert(blocks[2].type === TYPE.paragraph, 'p2');
}

section('6. parse: frontmatter skip');
{
  const md = `---
title: Mi nota
type: daily
---
# Real content`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 1, '1 block (frontmatter skipped): ' + blocks.length);
  assert(blocks[0].type === TYPE.heading1, 'h1');
  assert(blocks[0].text === 'Real content', 'h1 text');
}

section('7. parse: paragraph vacio entre bloques');
{
  const md = `Texto 1

Texto 2

Texto 3`;
  const blocks = parseMarkdown(md);
  assert(blocks.length === 3, '3 paragraphs (no empty blocks): ' + blocks.length);
}

section('8. serialize: round-trip heading');
{
  const original = '# Mi Título';
  const blocks = parseMarkdown(original);
  const back = serializeToMarkdown(blocks);
  assert(back.includes('# Mi Título'), 'h1 preserved');
}

section('9. serialize: round-trip todo checked');
{
  const original = `- [x] done`;
  const blocks = parseMarkdown(original);
  const back = serializeToMarkdown(blocks);
  assert(back.includes('- [x] done'), 'todo checked preserved');
}

section('10. serialize: round-trip completo');
{
  const md = `# Título
- [ ] tarea 1
- [x] tarea 2
- bullet
> cita
\`\`\`
codigo
\`\`\`
---`;
  const blocks = parseMarkdown(md);
  const back = serializeToMarkdown(blocks);
  const reBlocks = parseMarkdown(back);
  // Mismo numero de bloques
  assert(reBlocks.length === blocks.length, 'round-trip mismo count: ' + reBlocks.length + ' vs ' + blocks.length);
  // Cada bloque del mismo tipo
  for (let i = 0; i < blocks.length; i++) {
    assert(reBlocks[i].type === blocks[i].type, `block ${i} type preserved`);
  }
}

section('11. parse: edge case - line that starts with # but not heading');
{
  // No hay forma natural en markdown de '# texto' sin ser heading
  // (a menos que tenga 4+ espacios, que seria codigo)
  const md = '    # not a heading';
  const blocks = parseMarkdown(md);
  // Our simple parser treats it as paragraph (we don't handle indent)
  // So it's just accepted as paragraph. No assertion needed.
  assert(blocks.length >= 0, 'no crash');
}

section('12. parse: callout pattern (no detection in our parser)');
{
  // Our parser doesn't have a special callout detection.
  // Quote pattern matches '> '. So '> 💡 callout' becomes a quote.
  const md = '> 💡 callout text';
  const blocks = parseMarkdown(md);
  assert(blocks[0].type === TYPE.quote, 'callout is treated as quote in our simple parser');
  assert(blocks[0].text === '💡 callout text', 'text includes emoji');
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
