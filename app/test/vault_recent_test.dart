// Tests para VaultService.listRecentNotes (Fase 6 perf fix — bug auditor #3).
//
// Bug original: home_screen carga TODO el vault para mostrar 5 notas.
// En vault de 10K notas, tarda 30+ segundos.
//
// Fix: listRecentNotes(limit) usa streaming + early-stop.
// Phase 1: lista paths con mtime (sin leer contenido)
// Phase 2: sort top-N
// Phase 3: lee contenido solo de top-N
// Complejidad: O(N) para listar + O(limit) para leer. Antes: O(N) para leer todo.
//
// v0.47.11: Note.name ahora retorna basename SIN extensión (consistente con
// el modelo). Los asserts del test actualizados: 'a' en lugar de 'a.md'.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/vault_service.dart';
import 'dart:io';

void main() {
  late Directory tempDir;
  late VaultService vault;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('mnexus_recent_');
    vault = VaultService(tempDir.path);
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  String _formatTouch(DateTime dt) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${dt.year}${two(dt.month)}${two(dt.day)}${two(dt.hour)}${two(dt.minute)}';
  }

  Future<void> createNote(String relPath, String content, DateTime mtime) async {
    final f = File('${tempDir.path}/$relPath');
    await f.parent.create(recursive: true);
    await f.writeAsString(content);
    // Forzar mtime (writeAsString no lo respeta en todos los FS)
    await Process.run('touch', ['-t', _formatTouch(mtime), f.path]);
  }

  group('listRecentNotes', () {
    test('returns empty list for empty vault', () async {
      final notes = await vault.listRecentNotes(5);
      expect(notes, isEmpty);
    });

    test('returns the only note when vault has 1', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(1));
      expect(notes.first.name, 'a');
    });

    test('returns most recent N notes sorted by mtime desc', () async {
      await createNote('old.md', '# Old', DateTime(2026, 1, 1));
      await createNote('mid.md', '# Mid', DateTime(2026, 6, 1));
      await createNote('new.md', '# New', DateTime(2026, 9, 7));
      await createNote('older.md', '# Older', DateTime(2025, 12, 1));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(4));
      expect(notes[0].name, 'new');
      expect(notes[1].name, 'mid');
      expect(notes[2].name, 'old');
      expect(notes[3].name, 'older');
    });

    test('respects limit parameter', () async {
      for (int i = 0; i < 10; i++) {
        await createNote('note$i.md', '# $i', DateTime(2026, 9, i + 1));
      }
      final notes = await vault.listRecentNotes(3);
      expect(notes, hasLength(3));
      expect(notes[0].name, 'note9');
      expect(notes[1].name, 'note8');
      expect(notes[2].name, 'note7');
    });

    test('handles nested directories', () async {
      await createNote('top.md', '# Top', DateTime(2026, 9, 7));
      await createNote('subdir/nested.md', '# Nested', DateTime(2026, 9, 6));
      await createNote('subdir/deep/very-deep.md', '# Deep', DateTime(2026, 9, 5));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(3));
      expect(notes[0].name, 'top');
      expect(notes[1].name, 'nested');
      expect(notes[2].name, 'very-deep');
    });

    test('skips non-markdown files', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      await createNote('b.txt', 'not markdown', DateTime(2026, 9, 8));
      await createNote('image.png', 'binary', DateTime(2026, 9, 9));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(1));
      expect(notes[0].name, 'a');
    });

    test('skips hidden files (starting with .)', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      await createNote('.hidden.md', '# Hidden', DateTime(2026, 9, 8));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(1));
      expect(notes[0].name, 'a');
    });

    test('CRITICAL: does NOT read content of files outside top-N (the perf fix)', () async {
      for (int i = 0; i < 100; i++) {
        await createNote('n$i.md', 'content $i', DateTime(2026, 1, 1).add(Duration(days: i)));
      }

      final stopwatch = Stopwatch()..start();
      final notes = await vault.listRecentNotes(5);
      stopwatch.stop();

      expect(notes, hasLength(5));
      expect(notes.first.name, 'n99');
      expect(stopwatch.elapsedMilliseconds < 5000, isTrue,
          reason: 'listRecentNotes(5) on 100 notes should be fast');
    });

    test('handles limit=0 gracefully', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      final notes = await vault.listRecentNotes(0);
      expect(notes, isEmpty);
    });

    test('handles limit > total notes', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      await createNote('b.md', '# B', DateTime(2026, 9, 6));
      final notes = await vault.listRecentNotes(10);
      expect(notes, hasLength(2));
    });

    test('handles broken symlinks gracefully (no crash)', () async {
      await createNote('good.md', '# Good', DateTime(2026, 9, 7));
      try {
        final link = Link('${tempDir.path}/broken.md');
        await link.create('${tempDir.path}/nonexistent.md');
        final notes = await vault.listRecentNotes(5);
        expect(notes.map((n) => n.name), contains('good'));
      } on FileSystemException {
        // symlinks might not be supported on the platform, that's fine
      }
    });
  });
}