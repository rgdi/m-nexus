const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const tmpDb = path.join(os.tmpdir(), 'apkg-test-' + Date.now() + '.anki2');
const db = new Database(tmpDb);
db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT, models TEXT, tags TEXT, mod INTEGER);`);
db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);`);
db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, "left" INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);`);

const models = { '1607392319': { name: 'Basic', flds: [{ name: 'Front' }, { name: 'Back' }] } };
const decks = { '1': { id: 1, name: 'Default' } };
db.prepare('INSERT INTO col (id, decks, models, tags, mod) VALUES (1, ?, ?, ?, 0)').run(JSON.stringify(decks), JSON.stringify(models), '{}');
db.prepare("INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (1, 'abc', 1607392319, 0, 0, ' biology ', ?, 'Powerhouse', 0, 0, 'd')").run("Powerhouse\x1fMitochondrion");
db.prepare("INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (2, 'def', 1607392319, 0, 0, ' bio dna ', ?, 'DNA', 0, 0, 'd')").run("DNA\x1fDeoxyribonucleic acid");
db.prepare('INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)').run();
db.prepare('INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)').run();
db.close();

const apkg = path.join(os.tmpdir(), 'real-' + Date.now() + '.apkg');
const zip = new AdmZip();
zip.addLocalFile(tmpDb);
zip.writeZip(apkg);
fs.unlinkSync(tmpDb);

// Ahora usar el mismo codigo del servicio
const zip2 = new AdmZip(apkg);
const entries = zip2.getEntries();
const collectionEntry = entries.find(e => e.entryName === 'collection.anki2' || e.entryName === 'collection.anki21');
console.log('Entry:', collectionEntry?.entryName);

const tmp2 = path.join(os.tmpdir(), 'reopen-' + Date.now() + '.anki2');
fs.writeFileSync(tmp2, collectionEntry.getData());

const db2 = new Database(tmp2, { readonly: true });
try {
  const colRows = db2.prepare("SELECT id, decks, models, tags, mod FROM col").all();
  console.log('col rows:', colRows.length);
  console.log('col[0]:', JSON.stringify(colRows[0]).slice(0, 200));

  const noteRows = db2.prepare("SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes").all();
  console.log('note rows:', noteRows.length);
  console.log('note[0].flds:', JSON.stringify(noteRows[0].flds));

  const col = colRows[0] || {};
  let modelsObj = {};
  try { modelsObj = JSON.parse(col.models || '{}'); } catch(e) { console.log('models parse err:', e.message); }
  console.log('models keys:', Object.keys(modelsObj));
} finally {
  db2.close();
  fs.unlinkSync(tmp2);
}
