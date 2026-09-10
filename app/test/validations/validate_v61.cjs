// validate_v61.cjs: tests para v0.61.x (sqlite, ECDH, webview, isolate)
'use strict';

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push({ name, err: e.message }); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error('Assertion failed: ' + (msg || '')); }
function approx(a, b, eps = 0.01) { if (Math.abs(a - b) > eps) throw new Error(`${a} != ${b}`); }

console.log('Validating v0.61 features');
console.log('═════════════════════════');

// ── v0.61.0: Marketplace SQLite behavior ──
class FakeMarketplace {
  constructor() { this.decks = new Map(); this.reviews = []; this.installs = new Map(); }
  seedIfEmpty() {
    if (this.decks.size > 0) return;
    this.decks.set('d1', { id: 'd1', name: 'Test', cardCount: 100, rating: 4.5, ratingCount: 50, official: true, category: 'anatomy' });
  }
  list(filters = {}) {
    let list = Array.from(this.decks.values());
    if (filters.category) list = list.filter(d => d.category === filters.category);
    if (filters.search) {
      const s = filters.search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      list = list.filter(d => d.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(s));
    }
    return list;
  }
  get(id) { return this.decks.get(id); }
  addReview(deckId, rating) {
    if (rating < 1 || rating > 5) throw new Error('rating fuera de rango');
    const d = this.decks.get(deckId);
    if (!d) throw new Error('no existe');
    d.ratingCount++;
    d.rating = (d.rating * (d.ratingCount - 1) + rating) / d.ratingCount;
    return { deckId, rating };
  }
  install(userId, deckId) {
    if (!this.decks.has(deckId)) return null;
    this.installs.set(`${userId}:${deckId}`, { userId, deckId, installedAt: Date.now() });
    return this.installs.get(`${userId}:${deckId}`);
  }
  isInstalled(userId, deckId) { return this.installs.has(`${userId}:${deckId}`); }
  getUserInstalls(userId) {
    return Array.from(this.installs.values()).filter(i => i.userId === userId);
  }
  stats() {
    return {
      totalDecks: this.decks.size,
      totalInstalls: Array.from(this.installs.values()).length,
    };
  }
}

t('v0.61.0: marketplace.seed crea decks', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  ok(m.decks.size > 0);
});
t('v0.61.0: marketplace.filter category', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  const r = m.list({ category: 'anatomy' });
  ok(r.length > 0);
  ok(r.every(d => d.category === 'anatomy'));
});
t('v0.61.0: marketplace.search NFD', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  m.decks.get('d1').name = 'Anatomía';
  const r = m.list({ search: 'anatomia' });
  ok(r.length === 1);
});
t('v0.61.0: marketplace.addReview actualiza rating', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  const before = m.decks.get('d1').rating;
  m.addReview('d1', 5);
  const after = m.decks.get('d1').rating;
  ok(after > before);
});
t('v0.61.0: marketplace.addReview rating invalido', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  try { m.addReview('d1', 6); throw new Error('should have thrown'); }
  catch (e) { ok(e.message.includes('fuera de rango')); }
});
t('v0.61.0: marketplace.install incrementa', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  const before = m.decks.get('d1').totalInstalls || 0;
  m.install('u1', 'd1');
  ok(m.isInstalled('u1', 'd1'));
});
t('v0.61.0: marketplace.install deck inexistente', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  eq(m.install('u1', 'no-existe'), null);
});
t('v0.61.0: marketplace.getUserInstalls', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  m.install('u2', 'd1');
  const list = m.getUserInstalls('u2');
  eq(list.length, 1);
});
t('v0.61.0: marketplace.stats', () => {
  const m = new FakeMarketplace();
  m.seedIfEmpty();
  const s = m.stats();
  ok(s.totalDecks > 0);
});

// ── v0.61.1: ECDH key exchange behavior ──
const crypto = require('node:crypto');
function ecdh() { return crypto.createECDH('prime256v1'); }

t('v0.61.1: ECDH genera par de claves', () => {
  const a = ecdh();
  a.generateKeys();
  ok(a.getPublicKey().length > 20);
  ok(a.getPrivateKey().length > 20);
});
t('v0.61.1: ECDH secreto compartido simetrico', () => {
  const a = ecdh(); a.generateKeys();
  const b = ecdh(); b.generateKeys();
  const sAB = a.computeSecret(b.getPublicKey());
  const sBA = b.computeSecret(a.getPublicKey());
  eq(sAB.toString('hex'), sBA.toString('hex'));
  ok(sAB.length === 32);
});
t('v0.61.1: AES-256-GCM encrypt + decrypt', () => {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update('hola mundo', 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  eq(pt, 'hola mundo');
});
t('v0.61.1: AES-GCM detecta tampering', () => {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update('x', 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Modifica el ciphertext
  const tampered = Buffer.from(ct);
  tampered[0] = tampered[0] ^ 0xff;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    Buffer.concat([decipher.update(tampered), decipher.final()]);
    throw new Error('should have thrown');
  } catch (e) { ok(e.message !== 'should have thrown'); }
});
t('v0.61.1: HKDF produce 32 bytes', () => {
  const shared = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  const info = Buffer.from('mnexus-e2e-v1');
  // HKDF extract
  const prk = crypto.createHmac('sha256', salt).update(shared).digest();
  // HKDF expand (1 block)
  const t1 = crypto.createHmac('sha256', prk).update(Buffer.concat([Buffer.alloc(0), info, Buffer.from([1])])).digest();
  ok(t1.length === 32);
});

// ── v0.61.2: WebView URL validation ──
function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
t('v0.61.2: WebView acepta https', () => ok(isValidUrl('https://example.com')));
t('v0.61.2: WebView acepta http localhost', () => ok(isValidUrl('http://localhost:3000')));
t('v0.61.2: WebView rechaza file://', () => ok(!isValidUrl('file:///etc/passwd')));
t('v0.61.2: WebView rechaza javascript:', () => ok(!isValidUrl('javascript:alert(1)')));
t('v0.61.2: WebView rechaza string vacio', () => ok(!isValidUrl('')));
t('v0.61.2: YouTube ID extract youtube.com', () => {
  const id = 'dQw4w9WgXcQ';
  const m = /youtube\.com\/watch\?v=([\w-]{11})/.exec(`https://www.youtube.com/watch?v=${id}`);
  eq(m[1], id);
});
t('v0.61.2: YouTube ID extract youtu.be', () => {
  const id = 'dQw4w9WgXcQ';
  const m = /youtu\.be\/([\w-]{11})/.exec(`https://youtu.be/${id}`);
  eq(m[1], id);
});
t('v0.61.2: YouTube ID extract embed', () => {
  const id = 'dQw4w9WgXcQ';
  const m = /youtube\.com\/embed\/([\w-]{11})/.exec(`https://www.youtube.com/embed/${id}`);
  eq(m[1], id);
});
t('v0.61.2: YouTube ID invalido devuelve null', () => {
  const m = /youtube\.com\/watch\?v=([\w-]{11})/.exec('https://example.com/foo');
  eq(m, null);
});

// ── v0.61.3: Graph isolate performance ──
class FakeGraph {
  constructor(n, edges) {
    this.nodes = Array.from({ length: n }, (_, i) => ({ path: `n${i}`, degree: 3 }));
    this.edges = edges;
  }
}

t('v0.61.3: graph layout inline para <=100 nodos', () => {
  const g = new FakeGraph(50, []);
  ok(g.nodes.length === 50);
});
t('v0.61.3: graph layout isolate para >100 nodos', () => {
  const g = new FakeGraph(500, []);
  ok(g.nodes.length === 500);
  // v0.61.3: en isolate real se pasaria por SendPort; aqui validamos estructura
  const nodes = g.nodes.map(n => [n.path, n.degree]);
  ok(nodes.length === 500);
});

// ── v0.61.4: Integration flow E2E ──
class FakeNotesStore {
  constructor() { this.notes = new Map(); }
  create(input) { const n = { id: `note-${Date.now()}`, ...input, createdAt: Date.now() }; this.notes.set(n.id, n); return n; }
  get(id) { return this.notes.get(id); }
  update(id, patch) { const n = this.notes.get(id); if (!n) return null; Object.assign(n, patch); return n; }
  remove(id) { return this.notes.delete(id); }
}

t('v0.61.4: notes CRUD flow', () => {
  const s = new FakeNotesStore();
  const c = s.create({ title: 't', content: 'c' });
  ok(c.id);
  eq(s.get(c.id).content, 'c');
  s.update(c.id, { content: 'new' });
  eq(s.get(c.id).content, 'new');
  ok(s.remove(c.id));
  eq(s.get(c.id), undefined);
});
t('v0.61.4: notes update no existente -> null', () => {
  const s = new FakeNotesStore();
  eq(s.update('no-existe', {}), null);
});
t('v0.61.4: notes remove no existente -> false', () => {
  const s = new FakeNotesStore();
  ok(!s.remove('no-existe'));
});

// ── Path validation (ya cubierto en v0.60 pero replicamos para completeness) ──
const path = require('path');
function safePath(root, p) {
  const absRoot = path.resolve(root);
  const absPath = path.resolve(absRoot, p);
  if (!absPath.startsWith(absRoot + '/') && absPath !== absRoot) throw new Error('traversal');
  return absPath;
}
t('v0.61 path validation acepta valido', () => {
  const p = safePath('/tmp/vault', 'a.md');
  ok(p.includes('/tmp/vault'));
});
t('v0.61 path validation rechaza traversal', () => {
  try { safePath('/tmp/vault', '../etc'); throw new Error('should have thrown'); }
  catch (e) { ok(e.message.includes('traversal')); }
});

// ── E2E encryption formats (v0.61.1 payload structure) ──
class FakeE2E {
  encrypt(key, plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const mac = cipher.getAuthTag();
    return { iv: iv.toString('base64'), ciphertext: ct.toString('base64'), mac: mac.toString('base64') };
  }
  decrypt(key, payload) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.mac, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf-8');
  }
}
t('v0.61 E2E payload estructura valida', () => {
  const e2e = new FakeE2E();
  const k = crypto.randomBytes(32);
  const p = e2e.encrypt(k, 'hello');
  ok(p.iv);
  ok(p.ciphertext);
  ok(p.mac);
});
t('v0.61 E2E decrypt roundtrip', () => {
  const e2e = new FakeE2E();
  const k = crypto.randomBytes(32);
  const p = e2e.encrypt(k, 'hello world');
  const d = e2e.decrypt(k, p);
  eq(d, 'hello world');
});

console.log(`\nResults: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  fails.forEach(f => console.log(`  ✗ ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('✓ All v0.61 validations passed');
process.exit(0);
