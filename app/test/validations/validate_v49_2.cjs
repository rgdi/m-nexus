// validate_v49_2.cjs
// Validates the vault move/rename/delete/folder logic added in v0.49.2.
//
// We can't run Flutter in the sandbox, so we re-implement the same algorithm
// in plain JS and verify all the edge cases (overwrite, missing parent, etc).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n--- ${name} ---`); }

function tmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnexus-v492-'));
  fs.writeFileSync(path.join(dir, 'note1.md'), '# A\n');
  fs.writeFileSync(path.join(dir, 'note2.md'), '# B\n');
  fs.mkdirSync(path.join(dir, 'Inbox'));
  fs.writeFileSync(path.join(dir, 'Inbox', 'draft.md'), '# D\n');
  fs.mkdirSync(path.join(dir, 'Empty'));
  return dir;
}

// Mirror VaultService.moveNote algorithm
function moveNote(vault, sourceRel, destRel) {
  const absSrc = path.join(vault, sourceRel);
  const absDest = path.join(vault, destRel);
  if (!fs.existsSync(absSrc)) throw new Error('Source not found: ' + sourceRel);
  if (fs.existsSync(absDest)) throw new Error('Destination already exists: ' + destRel);
  fs.mkdirSync(path.dirname(absDest), { recursive: true });
  fs.renameSync(absSrc, absDest);
  return absDest;
}

function renameNote(vault, sourceRel, newName) {
  const parent = path.dirname(sourceRel);
  const ext = path.extname(sourceRel);
  const newRel = path.join(parent, `${newName}${ext}`).replace(/\\/g, '/');
  return moveNote(vault, sourceRel, newRel);
}

function deleteNote(vault, rel) {
  const abs = path.join(vault, rel);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

function createFolder(vault, rel) {
  const abs = path.join(vault, rel);
  if (fs.existsSync(abs)) throw new Error('Folder already exists: ' + rel);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

function deleteFolder(vault, rel, recursive = false) {
  const abs = path.join(vault, rel);
  if (!fs.existsSync(abs)) throw new Error('Folder not found: ' + rel);
  if (recursive) {
    fs.rmSync(abs, { recursive: true, force: true });
  } else {
    const items = fs.readdirSync(abs);
    if (items.length > 0) throw new Error('Folder not empty');
    fs.rmdirSync(abs);
  }
}

function listFolders(vault) {
  const out = [];
  function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const r = path.join(rel, e.name).replace(/\\/g, '/');
        if (!r.startsWith('.')) out.push(r);
        walk(path.join(dir, e.name), r);
      }
    }
  }
  walk(vault, '');
  return out;
}

section('1. moveNote: same parent (acts as rename)');
{
  const v = tmpVault();
  const dest = moveNote(v, 'note1.md', 'renamed.md');
  assert(fs.existsSync(dest), 'renamed file exists');
  assert(!fs.existsSync(path.join(v, 'note1.md')), 'original is gone');
  assert(fs.readFileSync(dest, 'utf8') === '# A\n', 'content preserved');
  fs.rmSync(v, { recursive: true, force: true });
}

section('2. moveNote: into subfolder');
{
  const v = tmpVault();
  const dest = moveNote(v, 'note1.md', 'Inbox/note1.md');
  assert(fs.existsSync(dest), 'moved into Inbox');
  assert(!fs.existsSync(path.join(v, 'note1.md')), 'gone from root');
  fs.rmSync(v, { recursive: true, force: true });
}

section('3. moveNote: into NEW subfolder (recursive create)');
{
  const v = tmpVault();
  const dest = moveNote(v, 'note1.md', 'NewFolder/sub/note1.md');
  assert(fs.existsSync(dest), 'moved into NewFolder/sub/');
  assert(fs.existsSync(path.join(v, 'NewFolder', 'sub')), 'parent dirs created');
  fs.rmSync(v, { recursive: true, force: true });
}

section('4. moveNote: source does not exist -> error');
{
  const v = tmpVault();
  let threw = false;
  try { moveNote(v, 'ghost.md', 'something.md'); } catch { threw = true; }
  assert(threw, 'throws on missing source');
  fs.rmSync(v, { recursive: true, force: true });
}

section('5. moveNote: destination already exists -> error');
{
  const v = tmpVault();
  let threw = false;
  try { moveNote(v, 'note1.md', 'note2.md'); } catch { threw = true; }
  assert(threw, 'throws on existing destination');
  fs.rmSync(v, { recursive: true, force: true });
}

section('6. renameNote: just changes name, keeps folder');
{
  const v = tmpVault();
  const dest = renameNote(v, 'Inbox/draft.md', 'final-draft');
  assert(dest.endsWith('Inbox/final-draft.md'), 'still in Inbox');
  assert(fs.existsSync(dest), 'renamed file exists');
  fs.rmSync(v, { recursive: true, force: true });
}

section('7. renameNote: keeps .md extension');
{
  const v = tmpVault();
  const dest = renameNote(v, 'note1.md', 'branded');
  assert(dest.endsWith('branded.md'), 'extension preserved');
  fs.rmSync(v, { recursive: true, force: true });
}

section('8. deleteNote: removes file');
{
  const v = tmpVault();
  deleteNote(v, 'note1.md');
  assert(!fs.existsSync(path.join(v, 'note1.md')), 'file removed');
  fs.rmSync(v, { recursive: true, force: true });
}

section('9. deleteNote: silent on missing file');
{
  const v = tmpVault();
  let threw = false;
  try { deleteNote(v, 'ghost.md'); } catch { threw = true; }
  assert(!threw, 'no-op on missing file');
  fs.rmSync(v, { recursive: true, force: true });
}

section('10. createFolder: simple');
{
  const v = tmpVault();
  const abs = createFolder(v, 'NewDir');
  assert(fs.existsSync(abs), 'folder created');
  assert(fs.statSync(abs).isDirectory(), 'is a directory');
  fs.rmSync(v, { recursive: true, force: true });
}

section('11. createFolder: nested creates parents');
{
  const v = tmpVault();
  const abs = createFolder(v, 'A/B/C');
  assert(fs.existsSync(abs), 'nested folder created');
  fs.rmSync(v, { recursive: true, force: true });
}

section('12. createFolder: existing folder -> error');
{
  const v = tmpVault();
  let threw = false;
  try { createFolder(v, 'Inbox'); } catch { threw = true; }
  assert(threw, 'throws on existing folder');
  fs.rmSync(v, { recursive: true, force: true });
}

section('13. deleteFolder: empty, non-recursive');
{
  const v = tmpVault();
  deleteFolder(v, 'Empty', false);
  assert(!fs.existsSync(path.join(v, 'Empty')), 'empty folder removed');
  fs.rmSync(v, { recursive: true, force: true });
}

section('14. deleteFolder: non-empty, non-recursive -> error');
{
  const v = tmpVault();
  let threw = false;
  try { deleteFolder(v, 'Inbox', false); } catch { threw = true; }
  assert(threw, 'throws on non-empty folder without recursive');
  assert(fs.existsSync(path.join(v, 'Inbox')), 'folder still exists after failed delete');
  fs.rmSync(v, { recursive: true, force: true });
}

section('15. deleteFolder: non-empty, recursive=true');
{
  const v = tmpVault();
  deleteFolder(v, 'Inbox', true);
  assert(!fs.existsSync(path.join(v, 'Inbox')), 'recursively removed');
  fs.rmSync(v, { recursive: true, force: true });
}

section('16. listFolders: excludes dotfiles');
{
  const v = tmpVault();
  fs.mkdirSync(path.join(v, '.hidden'));
  fs.mkdirSync(path.join(v, 'Visible'));
  const folders = listFolders(v);
  assert(folders.includes('Visible'), 'visible folder listed');
  assert(!folders.some((f) => f.startsWith('.')), 'hidden excluded');
  fs.rmSync(v, { recursive: true, force: true });
}

section('17. Realistic flow: rename -> move -> delete -> import');
{
  const v = tmpVault();
  // User renames a note
  renameNote(v, 'Inbox/draft.md', 'final');
  // Then moves it to root
  const moved = moveNote(v, 'Inbox/final.md', 'final.md');
  assert(moved.endsWith('final.md'), 'moved to root');
  // Then deletes it
  deleteNote(v, 'final.md');
  assert(!fs.existsSync(moved), 'finally removed');
  // Then creates a new folder for the import
  createFolder(v, 'Imported/biology');
  assert(fs.existsSync(path.join(v, 'Imported', 'biology')), 'import folder ready');
  fs.rmSync(v, { recursive: true, force: true });
}

console.log(`\n========================================`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
process.exit(0);
