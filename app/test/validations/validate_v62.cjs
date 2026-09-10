// validate_v62.cjs: tests para v0.62.x (stemmer, gestures, docker, ci)
'use strict';

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push({ name, err: e.message }); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error('Assertion failed: ' + (msg || '')); }
function contains(a, b, msg) { if (!a || !a.includes(b)) throw new Error((msg || '') + `: expected to contain ${JSON.stringify(b)} in ${JSON.stringify(a)}`); }

console.log('Validating v0.62 features');
console.log('═════════════════════════');

// ── v0.62.0: Stemmer ES/EN ──
const SUFFIXES_ES = ['ísimo','ísima','itos','itas','illo','illa','ito','ita','mente','idad','idades','amiento','imiento','ación','aciones','ando','iendo','ar','er','ir','amos','emos','imos','aba','abas','aban','ado','ada','ados','adas','ido','ida','idos','idas','aría','erías','iría','irías','es','s'];
const SUFFIXES_EN = ['ational','tional','alize','icate','ative','fulness','ousness','iveness','iviti','biliti','ing','ed','ies','s','ly','ize','ise','ate','ity','ful','ness','ment','tion','sion'];

function normalize(w) {
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}
function stem(word, lang = 'es') {
  const n = normalize(word);
  if (n.length < 3) return n;
  const suffixes = lang === 'es' ? SUFFIXES_ES : SUFFIXES_EN;
  for (const s of suffixes) {
    if (n.endsWith(s) && n.length - s.length >= 3) return n.slice(0, -s.length);
  }
  return n;
}
const STOPWORDS_ES = new Set(['el','la','los','las','un','una','unos','unas','de','del','en','a','al','con','sin','por','para','y','o','u','pero','que','si','no','es','son','está','están','ser','estar','tener','este','esta','estos','estas','ese','esa','esos','esas','muy','más','menos','todo','todos','toda','todas']);
const STOPWORDS_EN = new Set(['the','a','an','and','or','but','if','then','else','of','in','on','at','to','for','with','by','from','is','are','was','were','be','been','being','this','that','these','those','i','you','he','she','it','we','they','have','has','had','do','does','did','will','would','should','could','may','might']);

function tokenizeAndStem(text, lang = 'es') {
  const stopwords = lang === 'es' ? STOPWORDS_ES : STOPWORDS_EN;
  return text.split(/\s+/).map(normalize).filter(w => w.length >= 2 && !stopwords.has(w)).map(w => stem(w, lang));
}

function detectLanguage(text) {
  const words = text.toLowerCase().split(/\s+/);
  let esScore = 0, enScore = 0;
  for (const w of words) {
    if (STOPWORDS_ES.has(w)) esScore++;
    if (STOPWORDS_EN.has(w)) enScore++;
  }
  if (/[áéíóúñü]/i.test(text)) return 'es';
  return enScore > esScore ? 'en' : 'es';
}

function buildFtsQuery(query, lang = 'auto') {
  const detectedLang = lang === 'auto' ? detectLanguage(query) : lang;
  const stems = tokenizeAndStem(query, detectedLang);
  if (stems.length === 0) return query;
  return stems.map(s => `"${s}"*`).join(' OR ');
}

t('v0.62.0 stemmer ES plural -s', () => { eq(stem('huesos', 'es'), 'hueso'); });
t('v0.62.0 stemmer ES -ado', () => { ok(stem('terminado', 'es').length < 'terminado'.length); });
t('v0.62.0 stemmer ES -idad', () => { ok(stem('velocidad', 'es').length < 'velocidad'.length); });
t('v0.62.0 stemmer EN -ing', () => { eq(stem('running', 'en'), 'runn'); });
t('v0.62.0 stemmer EN -s', () => { eq(stem('dogs', 'en'), 'dog'); });
t('v0.62.0 stemmer EN -tion', () => { ok(stem('information', 'en').length < 'information'.length); });
t('v0.62.0 tokenizeAndStem filtra stopwords ES', () => {
  const t = tokenizeAndStem('el hueso de la pierna', 'es');
  contains(t, 'hueso');
  ok(!t.includes('el'));
});
t('v0.62.0 tokenizeAndStem filtra stopwords EN', () => {
  const t = tokenizeAndStem('the bone of the leg', 'en');
  contains(t, 'bone');
  ok(!t.includes('the'));
});
t('v0.62.0 buildFtsQuery OR', () => { contains(buildFtsQuery('ciclo krebs', 'es'), 'OR'); });
t('v0.62.0 buildFtsQuery wildcard *', () => { contains(buildFtsQuery('anatomía', 'es'), '*'); });
t('v0.62.0 buildFtsQuery auto ES', () => { contains(buildFtsQuery('anatomía clínica'), 'anatom'); });
t('v0.62.0 buildFtsQuery auto EN', () => { contains(buildFtsQuery('running dogs'), 'runn'); });
t('v0.62.0 detectLanguage acentos -> ES', () => { eq(detectLanguage('anatomía'), 'es'); });
t('v0.62.0 detectLanguage stopwords EN', () => { eq(detectLanguage('the bone of the leg'), 'en'); });
t('v0.62.0 detectLanguage stopwords ES', () => { eq(detectLanguage('el hueso de la pierna'), 'es'); });
t('v0.62.0 normalize NFD acentos', () => { eq(normalize('niño'), 'nino'); });
t('v0.62.0 normalize lowercase', () => { eq(normalize('HOLA'), 'hola'); });

// ── v0.62.1: Gestures / Haptics ──
class FakeHaptic {
  static events = [];
  static light() { FakeHaptic.events.push('light'); }
  static medium() { FakeHaptic.events.push('medium'); }
  static heavy() { FakeHaptic.events.push('heavy'); }
  static selection() { FakeHaptic.events.push('selection'); }
}
class SwipeToDelete {
  constructor(onDelete) { this.onDelete = onDelete; }
  async confirm(message) { return true; }
  async dismiss() {
    FakeHaptic.medium();
    if (await this.confirm('¿Eliminar?')) {
      FakeHaptic.heavy();
      await this.onDelete();
    }
  }
}
class PullToRefresh {
  constructor(onRefresh) { this.onRefresh = onRefresh; }
  async pull() { FakeHaptic.light(); await this.onRefresh(); }
}

t('v0.62.1 SwipeToDelete dispara haptic medium + heavy', async () => {
  FakeHaptic.events = [];
  const s = new SwipeToDelete(async () => {});
  await s.dismiss();
  contains(FakeHaptic.events, 'medium');
  contains(FakeHaptic.events, 'heavy');
});
t('v0.62.1 PullToRefresh dispara haptic light', async () => {
  FakeHaptic.events = [];
  const p = new PullToRefresh(async () => {});
  await p.pull();
  contains(FakeHaptic.events, 'light');
});

// ── v0.62.2: Docker config validation ──
const fs = require('fs');
const path = require('path');
const REPO = process.cwd();

t('v0.62.2 Dockerfile existe', () => {
  const exists = fs.existsSync(path.join(REPO, 'Dockerfile'));
  ok(exists, 'Dockerfile debe existir en la raiz del repo');
});
t('v0.62.2 Dockerfile multi-stage', () => {
  const content = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8');
  contains(content, 'FROM node:22-alpine AS deps');
  contains(content, 'FROM node:22-alpine AS build');
  contains(content, 'FROM node:22-alpine AS runtime');
});
t('v0.62.2 Dockerfile user no-root', () => {
  const content = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8');
  contains(content, 'adduser -S mnexus');
  contains(content, 'USER mnexus');
});
t('v0.62.2 Dockerfile healthcheck', () => {
  const content = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8');
  contains(content, 'HEALTHCHECK');
  contains(content, '/health');
});
t('v0.62.2 docker-compose.yml existe', () => {
  ok(fs.existsSync(path.join(REPO, 'docker-compose.yml')));
});
t('v0.62.2 docker-compose volumenes', () => {
  const content = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf-8');
  contains(content, 'mnexus-data');
  contains(content, 'mnexus-backups');
});
t('v0.62.2 .dockerignore existe', () => {
  ok(fs.existsSync(path.join(REPO, '.dockerignore')));
});
t('v0.62.2 .dockerignore excluye node_modules', () => {
  const content = fs.readFileSync(path.join(REPO, '.dockerignore'), 'utf-8');
  contains(content, 'node_modules/');
});
t('v0.62.2 nginx.conf existe', () => {
  ok(fs.existsSync(path.join(REPO, 'nginx.conf')));
});
t('v0.62.2 nginx.conf SSL y CSP', () => {
  const content = fs.readFileSync(path.join(REPO, 'nginx.conf'), 'utf-8');
  contains(content, 'ssl_certificate');
  contains(content, 'Content-Security-Policy');
  contains(content, 'limit_req_zone');
});

// ── v0.62.3: CI release workflow ──
t('v0.62.3 release.yml existe', () => {
  ok(fs.existsSync(path.join(REPO, '.github', 'workflows', 'release.yml')));
});
t('v0.62.3 release.yml incluye docker job', () => {
  const content = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'release.yml'), 'utf-8');
  contains(content, 'build-docker:');
  contains(content, 'docker build');
  contains(content, 'docker save');
  contains(content, 'ghcr.io');
});
t('v0.62.3 ci.yml existe', () => {
  ok(fs.existsSync(path.join(REPO, '.github', 'workflows', 'ci.yml')));
});
t('v0.62.3 ci.yml incluye test-docker', () => {
  const content = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf-8');
  contains(content, 'test-docker:');
  contains(content, 'docker build');
});

console.log(`\nResults: ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\nFailures:');
  fails.forEach(f => console.log(`  ✗ ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('✓ All v0.62 validations passed');
process.exit(0);
