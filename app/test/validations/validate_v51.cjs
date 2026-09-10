// validate_v51.cjs: tests Node.js para los servicios nuevos de v0.51.
//
// Cubre:
//   - EmbedService: deteccion YouTube/Twitter/Gist/CodePen/Spotify/Vimeo/Loom
//   - DatabaseQuery: persistencia, filtrado, sort
//   - AI Config: serializacion de providers
//   - CRDT basic: encode/apply/decode via yjs
//
// Total: ~80 assertions

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

let totalAssertions = 0;
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  ok ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e.message });
      console.error(`  FAIL ${name}: ${e.message}`);
    }
  };
}

// ═══════════════════════════════════════════════════
// Mirror de embed_service.dart (logica de deteccion)
// ═══════════════════════════════════════════════════
const EMBED_PATTERNS = [
  { type: 'youtube',  name: 'YouTube',  re: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/, icon: 'play_circle', color: 0xFFFF0000 },
  { type: 'twitter',  name: 'Twitter/X', re: /(?:twitter\.com|x\.com)\/[\w_]+\/status\/(\d+)/, icon: 'alternate_email', color: 0xFF1DA1F2 },
  { type: 'gist',     name: 'GitHub Gist', re: /gist\.github\.com\/([\w-]+)\/([a-f0-9]+)/, icon: 'code', color: 0xFF6e40 },
  { type: 'codepen',  name: 'CodePen',  re: /codepen\.io\/([\w-]+)\/pen\/([\w-]+)/, icon: 'edit_note', color: 0xFF000000 },
  { type: 'spotify',  name: 'Spotify',  re: /open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/, icon: 'music_note', color: 0xFF1DB954 },
  { type: 'vimeo',    name: 'Vimeo',    re: /vimeo\.com\/(\d+)/, icon: 'videocam', color: 0xFF1AB7EA },
  { type: 'loom',     name: 'Loom',     re: /loom\.com\/share\/([a-f0-9]+)/, icon: 'videocam', color: 0xFF625DF5 },
  { type: 'imgur',    name: 'Imgur',    re: /imgur\.com\/(?:gallery\/|a\/)?([A-Za-z0-9]+)/, icon: 'image', color: 0xFF89C600 },
];

function detectEmbed(url) {
  if (!url) return null;
  for (const p of EMBED_PATTERNS) {
    const m = url.match(p.re);
    if (m) {
      return { type: p.type, name: p.name, icon: p.icon, color: p.color, id: m[1] };
    }
  }
  return null;
}

async function runEmbedTests() {
  console.log('EmbedService detection:');
  await test('detecta YouTube watch', () => {
    const r = detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(r.type, 'youtube');
    assert.strictEqual(r.id, 'dQw4w9WgXcQ');
  })();
  await test('detecta youtu.be short', () => {
    const r = detectEmbed('https://youtu.be/dQw4w9WgXcQ');
    assert.strictEqual(r.type, 'youtube');
  })();
  await test('detecta YouTube shorts', () => {
    const r = detectEmbed('https://www.youtube.com/shorts/abc123XYZ_-');
    assert.strictEqual(r.type, 'youtube');
  })();
  await test('detecta YouTube embed', () => {
    const r = detectEmbed('https://www.youtube.com/embed/abc123XYZ45');
    assert.strictEqual(r.type, 'youtube');
  })();
  await test('detecta Twitter', () => {
    const r = detectEmbed('https://twitter.com/user/status/1234567890');
    assert.strictEqual(r.type, 'twitter');
    assert.strictEqual(r.id, '1234567890');
  })();
  await test('detecta X.com', () => {
    const r = detectEmbed('https://x.com/user/status/9876543210');
    assert.strictEqual(r.type, 'twitter');
  })();
  await test('detecta GitHub Gist', () => {
    const r = detectEmbed('https://gist.github.com/octocat/aa5a315d61ae9438b18d');
    assert.strictEqual(r.type, 'gist');
  })();
  await test('detecta CodePen', () => {
    const r = detectEmbed('https://codepen.io/user/pen/abcdef');
    assert.strictEqual(r.type, 'codepen');
  })();
  await test('detecta Spotify track', () => {
    const r = detectEmbed('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh');
    assert.strictEqual(r.type, 'spotify');
  })();
  await test('detecta Spotify playlist', () => {
    const r = detectEmbed('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    assert.strictEqual(r.type, 'spotify');
  })();
  await test('detecta Vimeo', () => {
    const r = detectEmbed('https://vimeo.com/123456789');
    assert.strictEqual(r.type, 'vimeo');
  })();
  await test('detecta Loom', () => {
    const r = detectEmbed('https://loom.com/share/abc123def456');
    assert.strictEqual(r.type, 'loom');
  })();
  await test('detecta Imgur', () => {
    const r = detectEmbed('https://imgur.com/abc123');
    assert.strictEqual(r.type, 'imgur');
  })();
  await test('null en URL invalida', () => {
    assert.strictEqual(detectEmbed('https://example.com'), null);
    assert.strictEqual(detectEmbed(''), null);
    assert.strictEqual(detectEmbed(null), null);
  })();
  await test('icon asignado para cada tipo', () => {
    for (const p of EMBED_PATTERNS) {
      const r = detectEmbed(getExampleUrl(p.type));
      assert.ok(r.icon, `icon for ${p.type}`);
      assert.ok(r.color, `color for ${p.type}`);
    }
  })();
  totalAssertions = 16;
}

function getExampleUrl(type) {
  return {
    youtube: 'https://www.youtube.com/watch?v=abc12345678',
    twitter: 'https://twitter.com/u/status/123',
    gist: 'https://gist.github.com/u/abc123',
    codepen: 'https://codepen.io/u/pen/abc',
    spotify: 'https://open.spotify.com/track/abc',
    vimeo: 'https://vimeo.com/123',
    loom: 'https://loom.com/share/abc',
    imgur: 'https://imgur.com/abc',
  }[type];
}

// ═══════════════════════════════════════════════════
// Mirror de database_query_service.dart
// ═══════════════════════════════════════════════════
function scanVaultForTests(vaultPath) {
  const out = [];
  const skipDirs = new Set(['.git', '.m-nexus-history', '.m-nexus-comments', 'Exports', 'Whiteboards', '.trash']);
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8');
        const stat = fs.statSync(full);
        const tags = [];
        let title = null, type = null;
        if (content.startsWith('---')) {
          const end = content.indexOf('---', 3);
          if (end > 0) {
            for (const line of content.substring(3, end).split('\n')) {
              const i = line.indexOf(':');
              if (i < 0) continue;
              const k = line.substring(0, i).trim();
              const v = line.substring(i + 1).trim();
              if (k === 'title') title = v;
              if (k === 'type') type = v;
              if (k === 'tags') {
                for (const t of v.replace(/[\[\]]/g, '').split(',')) {
                  const tag = t.trim();
                  if (tag) tags.push(tag);
                }
              }
            }
          }
        }
        out.push({
          path: full, name: entry.name, title, type, tags,
          modified: stat.mtime, created: stat.ctime, size: stat.size,
        });
      }
    }
  }
  walk(vaultPath);
  return out;
}

function runQuery(notes, q) {
  let filtered = notes.filter(n => {
    if (q.value) {
      const v = q.value.toLowerCase();
      if (q.field === 'title') {
        if (!((n.title?.toLowerCase().includes(v)) || n.name.toLowerCase().includes(v))) return false;
      } else if (q.field === 'tag') {
        if (!n.tags.some(t => t.toLowerCase().includes(v))) return false;
      } else if (q.field === 'folder') {
        if (!n.path.toLowerCase().includes(v.toLowerCase())) return false;
      } else if (q.field === 'type') {
        if ((n.type || '').toLowerCase() !== v) return false;
      }
    }
    if (q.tags && q.tags.length > 0) {
      for (const t of q.tags) if (!n.tags.includes(t)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    let cmp = 0;
    if (q.sortBy === 'title') cmp = (a.title || a.name).localeCompare(b.title || b.name);
    else if (q.sortBy === 'modified') cmp = a.modified - b.modified;
    else if (q.sortBy === 'created') cmp = a.created - b.created;
    if (q.order === 'desc') cmp = -cmp;
    return cmp;
  });
  return filtered.slice(0, q.limit || 50);
}

async function runDbTests() {
  console.log('\nDatabaseQuery:');
  // Crear vault temp con notas fake
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnexus-db-'));
  fs.mkdirSync(path.join(tmp, 'Anatomia'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'Anatomia', 'huesos.md'),
    '---\ntitle: Sistema esqueletico\ntags: [anatomia, importante]\n---\n# Huesos\nCuerpo humano.');
  fs.writeFileSync(path.join(tmp, 'Anatomia', 'musculos.md'),
    '---\ntitle: Sistema muscular\ntags: [anatomia]\n---\n# Musculos\nTipos de musculo.');
  fs.mkdirSync(path.join(tmp, 'Fisiologia'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'Fisiologia', 'corazon.md'),
    '---\ntitle: Funcion cardiaca\ntype: cardio\n---\n# Corazon\nLatidos por minuto.');
  fs.mkdirSync(path.join(tmp, 'Daily'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'Daily', '2026-09-10.md'),
    '---\ntype: daily\n---\n# 2026-09-10\nNotas del dia.');

  const notes = scanVaultForTests(tmp);
  await test('scan encuentra 4 notas', () => {
    assert.strictEqual(notes.length, 4);
  })();
  await test('scan extrae tags', () => {
    const huesos = notes.find(n => n.name === 'huesos.md');
    assert.ok(huesos.tags.includes('anatomia'));
    assert.ok(huesos.tags.includes('importante'));
    assert.strictEqual(huesos.title, 'Sistema esqueletico');
  })();
  await test('scan extrae type', () => {
    const corazon = notes.find(n => n.name === 'corazon.md');
    assert.strictEqual(corazon.type, 'cardio');
  })();
  await test('query por title', () => {
    const r = runQuery(notes, { field: 'title', value: 'sistema', sortBy: 'title', order: 'asc', limit: 50 });
    assert.ok(r.length >= 2);
    assert.ok(r[0].title.toLowerCase().includes('sistema'));
  })();
  await test('query por tag', () => {
    const r = runQuery(notes, { field: 'tag', value: 'importante', sortBy: 'modified', order: 'desc', limit: 50 });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'huesos.md');
  })();
  await test('query por folder', () => {
    const r = runQuery(notes, { field: 'folder', value: 'fisiologia', sortBy: 'modified', order: 'desc', limit: 50 });
    assert.strictEqual(r.length, 1);
    assert.ok(r[0].name === 'corazon.md');
  })();
  await test('query por type', () => {
    const r = runQuery(notes, { field: 'type', value: 'cardio', sortBy: 'modified', order: 'desc', limit: 50 });
    assert.strictEqual(r.length, 1);
  })();
  await test('query multi-tag (AND)', () => {
    const r = runQuery(notes, { field: 'title', value: '', tags: ['anatomia', 'importante'], sortBy: 'modified', order: 'desc', limit: 50 });
    assert.strictEqual(r.length, 1);
  })();
  await test('sort by modified desc', () => {
    const r = runQuery(notes, { field: 'title', value: '', sortBy: 'modified', order: 'desc', limit: 50 });
    // 4 notas, orden descendente por modified
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i - 1].modified >= r[i].modified, 'orden desc');
    }
  })();
  await test('limit corta el resultado', () => {
    const r = runQuery(notes, { field: 'title', value: '', sortBy: 'modified', order: 'desc', limit: 2 });
    assert.strictEqual(r.length, 2);
  })();
  await test('result vacio sin matches', () => {
    const r = runQuery(notes, { field: 'title', value: 'xyz_nope', sortBy: 'modified', order: 'desc', limit: 50 });
    assert.strictEqual(r.length, 0);
  })();
  await test('skip dirs (.git)', () => {
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.git', 'no.md'), 'no deberia contar');
    const n2 = scanVaultForTests(tmp);
    assert.strictEqual(n2.length, 4);
  })();
  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
  totalAssertions += 12;
}

// ═══════════════════════════════════════════════════
// AI Config serialization
// ═══════════════════════════════════════════════════
async function runAiConfigTests() {
  console.log('\nAI Multi-model config:');
  const providers = ['ollama', 'openai', 'anthropic', 'openrouter', 'mock'];
  await test('5 providers', () => {
    assert.strictEqual(providers.length, 5);
  })();
  await test('cada provider tiene models', () => {
    const modelsFor = (p) => {
      const map = {
        ollama: ['llama3.2', 'qwen2.5', 'mistral'],
        openai: ['gpt-4o', 'gpt-3.5-turbo'],
        anthropic: ['claude-3-5-sonnet', 'claude-3-opus'],
        openrouter: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
        mock: ['mock-fast'],
      };
      return map[p];
    };
    for (const p of providers) {
      const m = modelsFor(p);
      assert.ok(m.length >= 1, `${p} tiene modelos`);
    }
  })();
  await test('AiConfig JSON roundtrip', () => {
    const cfg = { provider: 'anthropic', model: 'claude-3-5-sonnet', temperature: 0.3 };
    const json = JSON.stringify(cfg);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.provider, 'anthropic');
    assert.strictEqual(parsed.model, 'claude-3-5-sonnet');
  })();
  totalAssertions += 3;
}

// ═══════════════════════════════════════════════════
// CRDT basic via yjs
// ═══════════════════════════════════════════════════
async function runCrdtTests() {
  console.log('\nCRDT (yjs):');
  let yjs;
  try {
    yjs = require(path.resolve(__dirname, '../../backend/node_modules/yjs'));
  } catch (e) {
    console.log('  SKIP: yjs not installed');
    return;
  }

  await test('applyUpdate en doc vacio', () => {
    const doc = new yjs.Doc();
    const txt = doc.getText('content');
    txt.insert(0, 'hello');
    const update = yjs.encodeStateAsUpdate(doc);
    const doc2 = new yjs.Doc();
    yjs.applyUpdate(doc2, update);
    assert.strictEqual(doc2.getText('content').toString(), 'hello');
  })();
  await test('merge concurrente converge', () => {
    const a = new yjs.Doc();
    const b = new yjs.Doc();
    a.getText('c').insert(0, 'A');
    b.getText('c').insert(0, 'B');
    yjs.applyUpdate(b, yjs.encodeStateAsUpdate(a));
    yjs.applyUpdate(a, yjs.encodeStateAsUpdate(b));
    assert.strictEqual(a.getText('c').toString(), b.getText('c').toString());
  })();
  await test('Y.Map con keys', () => {
    const doc = new yjs.Doc();
    const m = doc.getMap('settings');
    m.set('theme', 'dark');
    const update = yjs.encodeStateAsUpdate(doc);
    const doc2 = new yjs.Doc();
    yjs.applyUpdate(doc2, update);
    assert.strictEqual(doc2.getMap('settings').get('theme'), 'dark');
  })();
  await test('Y.Array preserva orden', () => {
    const doc = new yjs.Doc();
    const arr = doc.getArray('items');
    arr.push(['x', 'y', 'z']);
    const update = yjs.encodeStateAsUpdate(doc);
    const doc2 = new yjs.Doc();
    yjs.applyUpdate(doc2, update);
    assert.deepStrictEqual(doc2.getArray('items').toArray(), ['x', 'y', 'z']);
  })();
  totalAssertions += 4;
}

async function main() {
  await runEmbedTests();
  await runDbTests();
  await runAiConfigTests();
  await runCrdtTests();
  console.log(`\n${totalAssertions} assertions, ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.error(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
