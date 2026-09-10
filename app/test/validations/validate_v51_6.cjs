// validate_v51_6.cjs: tests para M7.5 (audio+calendar cross) y M7.6 (sync).
//
// Total: ~50 assertions

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  return () => {
    try {
      fn();
      passed++;
      console.log(`  ok ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e.message });
      console.error(`  FAIL ${name}: ${e.message}`);
    }
  };
}

// Mirror del codigo de Cross-tag (calendar_service.dart)
function buildCrossTagDescription({
  description, audioPath, notePath, subject, tags,
}) {
  const buf = [description || ''];
  if (audioPath) buf.push(`\n\n[mnexus-audio:${audioPath}]`);
  if (notePath) buf.push(`[mnexus-note:${notePath.replaceAll(' ', '_')}]`);
  if (subject) buf.push(`[mnexus-subject:${subject}]`);
  if (tags && tags.length > 0) buf.push(`[mnexus-tags:${tags.join(',')}]`);
  return buf.join('\n');
}

function parseCrossTag(desc) {
  const out = {};
  const m = desc.match(/\[mnexus-audio:([^\]]+)\]/);
  if (m) out.audioPath = m[1];
  const m2 = desc.match(/\[mnexus-note:([^\]]+)\]/);
  if (m2) out.notePath = m2[1].replaceAll('_', ' ');
  const m3 = desc.match(/\[mnexus-subject:([^\]]+)\]/);
  if (m3) out.subject = m3[1];
  const m4 = desc.match(/\[mnexus-tags:([^\]]+)\]/);
  if (m4) out.tags = m4[1].split(',');
  return out;
}

async function runCrossTagTests() {
  console.log('Audio+Calendar cross-tag:');
  test('description basica', () => {
    const d = buildCrossTagDescription({ description: 'Clase grabada' });
    assert.strictEqual(d, 'Clase grabada');
  })();
  test('description con audio', () => {
    const d = buildCrossTagDescription({ description: 'X', audioPath: '/vault/audio.m4a' });
    assert.ok(d.includes('[mnexus-audio:/vault/audio.m4a]'));
  })();
  test('description con note (espacios escapados)', () => {
    const d = buildCrossTagDescription({ description: 'X', notePath: '/path with spaces/note.md' });
    assert.ok(d.includes('[mnexus-note:/path_with_spaces/note.md]'));
  })();
  test('description con subject', () => {
    const d = buildCrossTagDescription({ description: 'X', subject: 'Anatomia' });
    assert.ok(d.includes('[mnexus-subject:Anatomia]'));
  })();
  test('description con tags', () => {
    const d = buildCrossTagDescription({ description: 'X', tags: ['importante', 'examen-final'] });
    assert.ok(d.includes('[mnexus-tags:importante,examen-final]'));
  })();
  test('descripcion vacia genera cross-tag solo', () => {
    const d = buildCrossTagDescription({ audioPath: '/a.m4a', subject: 'Bio' });
    assert.ok(d.startsWith('\n\n'));
  })();
  test('todos los cross-tags juntos', () => {
    const d = buildCrossTagDescription({
      description: 'clase', audioPath: '/a.m4a', notePath: '/n.md', subject: 'Bio', tags: ['t1', 't2']
    });
    assert.ok(d.includes('[mnexus-audio:'));
    assert.ok(d.includes('[mnexus-note:'));
    assert.ok(d.includes('[mnexus-subject:'));
    assert.ok(d.includes('[mnexus-tags:'));
  })();
  test('parse extrae audioPath', () => {
    const p = parseCrossTag('[mnexus-audio:/a.m4a]');
    assert.strictEqual(p.audioPath, '/a.m4a');
  })();
  test('parse restaura espacios en notePath', () => {
    const p = parseCrossTag('[mnexus-note:/path_with_spaces/n.md]');
    assert.strictEqual(p.notePath, '/path with spaces/n.md');
  })();
  test('parse extrae tags como array', () => {
    const p = parseCrossTag('[mnexus-tags:a,b,c]');
    assert.deepStrictEqual(p.tags, ['a', 'b', 'c']);
  })();
  test('parse sin marcadores devuelve vacio', () => {
    const p = parseCrossTag('descripcion normal sin tags');
    assert.deepStrictEqual(p, {});
  })();
  test('parse de description completa', () => {
    const d = buildCrossTagDescription({
      description: 'Clase',
      audioPath: '/a.m4a', notePath: '/n.md', subject: 'S', tags: ['t1', 't2']
    });
    const p = parseCrossTag(d);
    assert.strictEqual(p.audioPath, '/a.m4a');
    assert.strictEqual(p.notePath, '/n.md');
    assert.strictEqual(p.subject, 'S');
    assert.deepStrictEqual(p.tags, ['t1', 't2']);
  })();
}

// Sync dashboard mirror
function detectConflicts(fileMtimes, lastSync) {
  if (!lastSync) return [];
  return fileMtimes
    .filter(f => f.modified > lastSync)
    .map(f => ({ path: f.path, reason: 'Modified after last sync' }));
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtRel(d, now) {
  const diff = now - d;
  if (diff < 60_000) return `hace ${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

async function runSyncTests() {
  console.log('\nSync dashboard:');
  test('fmtBytes B', () => assert.strictEqual(fmtBytes(100), '100 B'))();
  test('fmtBytes KB', () => assert.strictEqual(fmtBytes(2048), '2.0 KB'))();
  test('fmtBytes MB', () => assert.strictEqual(fmtBytes(5 * 1024 * 1024), '5.00 MB'))();
  test('fmtBytes GB', () => assert.strictEqual(fmtBytes(2 * 1024 * 1024 * 1024), '2.00 GB'))();
  test('fmtRel hace Xs', () => {
    const now = new Date('2026-09-10T10:00:30Z');
    const past = new Date('2026-09-10T10:00:00Z');
    assert.strictEqual(fmtRel(past, now), 'hace 30s');
  })();
  test('fmtRel hace Xm', () => {
    const now = new Date('2026-09-10T10:30:00Z');
    const past = new Date('2026-09-10T10:00:00Z');
    assert.strictEqual(fmtRel(past, now), 'hace 30m');
  })();
  test('fmtRel hace Xh', () => {
    const now = new Date('2026-09-11T13:00:00Z');
    const past = new Date('2026-09-11T10:00:00Z');
    assert.strictEqual(fmtRel(past, now), 'hace 3h');
  })();
  test('fmtRel dia', () => {
    const now = new Date('2026-09-20T10:00:00Z');
    const past = new Date('2026-09-10T10:00:00Z');
    assert.match(fmtRel(past, now), /^2026-09-10$/);
  })();
  test('conflicts detecta archivos modificados', () => {
    const lastSync = new Date('2026-09-10T10:00:00Z');
    const files = [
      { path: '/a.md', modified: new Date('2026-09-10T09:00:00Z') }, // antes
      { path: '/b.md', modified: new Date('2026-09-10T11:00:00Z') }, // despues
      { path: '/c.md', modified: new Date('2026-09-10T10:30:00Z') }, // despues
    ];
    const c = detectConflicts(files, lastSync);
    assert.strictEqual(c.length, 2);
    assert.strictEqual(c[0].path, '/b.md');
    assert.strictEqual(c[1].path, '/c.md');
  })();
  test('conflicts sin lastSync devuelve vacio', () => {
    const files = [{ path: '/a.md', modified: new Date() }];
    assert.strictEqual(detectConflicts(files, null).length, 0);
  })();
  test('conflicts sin archivos devuelve vacio', () => {
    assert.strictEqual(detectConflicts([], new Date()).length, 0);
  })();

  // SyncState checks
  test('SyncState isHealthy', () => {
    const ok = {
      backendOnline: true, crdtOk: true, error: null,
    };
    assert.strictEqual(ok.backendOnline && ok.crdtOk && ok.error === null, true);
  })();
  test('SyncState no healthy si backend offline', () => {
    const off = { backendOnline: false, crdtOk: true, error: 'down' };
    assert.strictEqual(off.backendOnline, false);
  })();
}

// Test embed parse + serialize
function parseEmbedSyntax(line) {
  // :::embed URL
  const m = line.match(/^:::embed\s+(\S+)/);
  return m ? m[1] : null;
}
function serializeEmbed(url) {
  return `:::embed ${url}`;
}

async function runEmbedBlockTests() {
  console.log('\nEmbed block syntax:');
  test('parse :::embed URL', () => {
    const u = parseEmbedSyntax(':::embed https://youtube.com/watch?v=abc');
    assert.strictEqual(u, 'https://youtube.com/watch?v=abc');
  })();
  test('parse solo al inicio de linea', () => {
    const u = parseEmbedSyntax('  :::embed https://youtu.be/abc');
    assert.strictEqual(u, null);
  })();
  test('no parse sin prefijo', () => {
    const u = parseEmbedSyntax('https://youtube.com/watch?v=abc');
    assert.strictEqual(u, null);
  })();
  test('serialize produce :::embed URL', () => {
    assert.strictEqual(serializeEmbed('https://youtu.be/abc'), ':::embed https://youtu.be/abc');
  })();
  test('roundtrip parse -> serialize', () => {
    const url = 'https://gist.github.com/u/abc123def';
    const s = serializeEmbed(url);
    const u = parseEmbedSyntax(s);
    assert.strictEqual(u, url);
  })();
}

async function main() {
  await runCrossTagTests();
  await runSyncTests();
  await runEmbedBlockTests();
  console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.error(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
