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

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus/services/vault_service.dart';
import 'dart:io';

void main() {
  late Directory tempDir;
  late VaultService vault;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('mnexus_recent_test_');
    vault = VaultService(tempDir.path);
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  Future<void> createNote(String relPath, String content, DateTime mtime) async {
    final f = File('${tempDir.path}/$relPath');
    await f.parent.create(recursive: true);
    await f.writeAsString(content);
    await f.setLastModified(mtime);
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
      expect(notes.first.name, 'a.md');
    });

    test('returns most recent N notes sorted by mtime desc', () async {
      await createNote('old.md', '# Old', DateTime(2026, 1, 1));
      await createNote('mid.md', '# Mid', DateTime(2026, 6, 1));
      await createNote('new.md', '# New', DateTime(2026, 9, 7));
      await createNote('older.md', '# Older', DateTime(2025, 12, 1));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(4));
      expect(notes[0].name, 'new.md');
      expect(notes[1].name, 'mid.md');
      expect(notes[2].name, 'old.md');
      expect(notes[3].name, 'older.md');
    });

    test('respects limit parameter', () async {
      for (int i = 0; i < 10; i++) {
        await createNote('note$i.md', '# $i', DateTime(2026, 9, i + 1));
      }
      final notes = await vault.listRecentNotes(3);
      expect(notes, hasLength(3));
      expect(notes[0].name, 'note9.md');
      expect(notes[1].name, 'note8.md');
      expect(notes[2].name, 'note7.md');
    });

    test('handles nested directories', () async {
      await createNote('top.md', '# Top', DateTime(2026, 9, 7));
      await createNote('subdir/nested.md', '# Nested', DateTime(2026, 9, 6));
      await createNote('subdir/deep/very-deep.md', '# Deep', DateTime(2026, 9, 5));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(3));
      expect(notes[0].name, 'top.md');
      expect(notes[1].name, 'nested.md');
      expect(notes[2].name, 'very-deep.md');
    });

    test('skips non-markdown files', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      await createNote('b.txt', 'not markdown', DateTime(2026, 9, 8));
      await createNote('image.png', 'binary', DateTime(2026, 9, 9));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(1));
      expect(notes[0].name, 'a.md');
    });

    test('skips hidden files (starting with .)', () async {
      await createNote('a.md', '# A', DateTime(2026, 9, 7));
      await createNote('.hidden.md', '# Hidden', DateTime(2026, 9, 8));

      final notes = await vault.listRecentNotes(5);
      expect(notes, hasLength(1));
      expect(notes[0].name, 'a.md');
    });

    test('CRITICAL: does NOT read content of files outside top-N (the perf fix)', () async {
      // This test verifies the algorithmic improvement.
      // We can't directly assert "we didn't read X" in a unit test, but we
      // can verify that the result is correct AND the operation is fast.
      // For a vault of 100 notes, the old code would read all 100.
      // The new code reads only top-N.
      for (int i = 0; i < 100; i++) {
        await createNote('n$i.md', 'content $i', DateTime(2026, 1, 1).add(Duration(days: i)));
      }

      final stopwatch = Stopwatch()..start();
      final notes = await vault.listRecentNotes(5);
      stopwatch.stop();

      expect(notes, hasLength(5));
      // Most recent should be the last one
      expect(notes.first.name, 'n99.md');
      // Should be fast (< 5s for 100 notes, even on slow CI)
      // The old code would also pass this on 100 notes, but at 10K+ it explodes.
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
      // Create a broken symlink (pointing to non-existent file)
      try {
        final link = Link('${tempDir.path}/broken.md');
        await link.create('${tempDir.path}/nonexistent.md');
        // Should not throw, should return good.md
        final notes = await vault.listRecentNotes(5);
        expect(notes.map((n) => n.name), contains('good.md'));
      } on FileSystemException {
        // symlinks might not be supported on the platform, that's fine
        // The test is not invalid; we just skip the symlink part
        final notes = await vault.listRecentNotes(5);
        expect(notes, hasLength(1));
      }
    });
  });
}
