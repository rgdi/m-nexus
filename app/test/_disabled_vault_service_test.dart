// Tests para VaultService.

import 'dart:io';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride, TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/vault_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  debugDefaultTargetPlatformOverride = TargetPlatform.android;

  late Directory tmpDir;

  setUp(() async {
    tmpDir = await Directory.systemTemp.createTemp('vault-svc-test-');
  });

  tearDown(() async {
    if (await tmpDir.exists()) await tmpDir.delete(recursive: true);
  });

  group('VaultService.createNote', () {
    test('crea nota con frontmatter', () async {
      final svc = VaultService(tmpDir.path);
      final path = await svc.createNote(
        folder: 'Inbox',
        title: 'Mi primera nota',
        content: '# Hola\n\nEsto es una nota de prueba.',
      );
      final note = await svc.readNote(path);
      expect(note, isNotNull);
      expect(note!.title, 'Mi primera nota');
      expect(note.frontmatter['title'], 'Mi primera nota');
      expect(note.content.contains('Hola'), isTrue);
      expect(note.tags, isEmpty);
    });

    test('extrae tags inline #', () async {
      final svc = VaultService(tmpDir.path);
      final path = await svc.createNote(
        folder: '',
        title: 'Tags test',
        content: 'Esto es #anatomía y también #cardio #cap-1',
      );
      final note = await svc.readNote(path);
      expect(note!.tags, containsAll(['anatomía', 'cardio', 'cap-1']));
    });

    test('extrae wikilinks [[]]', () async {
      final svc = VaultService(tmpDir.path);
      final path = await svc.createNote(
        folder: '',
        title: 'Links test',
        content: 'Ver [[Nota A]] y [[Nota B|alias]].',
      );
      final note = await svc.readNote(path);
      expect(note!.links, containsAll(['Nota A', 'Nota B']));
    });

    test('extrae tags de frontmatter', () async {
      final svc = VaultService(tmpDir.path);
      final path = await svc.createNote(
        folder: '',
        title: 'FM tags',
        content: 'body',
        frontmatter: {'tags': 'uno dos tres'},
      );
      final note = await svc.readNote(path);
      expect(note!.tags, containsAll(['uno', 'dos', 'tres']));
    });
  });

  group('VaultService.parseFrontmatter', () {
    test('parsea body y frontmatter', () {
      final raw = '''---
title: Test
tags: a b
---

# Body

content''';
      final r = VaultService.parseFrontmatter(raw);
      expect(r.frontmatter['title'], 'Test');
      expect(r.frontmatter['tags'], 'a b');
      expect(r.body.contains('# Body'), isTrue);
    });

    test('sin frontmatter devuelve raw', () {
      final raw = '# Body\n\ncontent';
      final r = VaultService.parseFrontmatter(raw);
      expect(r.frontmatter, isEmpty);
      expect(r.body, raw);
    });

    test('frontmatter incompleto (sin cierre) devuelve raw', () {
      final raw = '---\ntitle: Test\n\n# Body';
      final r = VaultService.parseFrontmatter(raw);
      expect(r.frontmatter, isEmpty);
      expect(r.body, raw);
    });
  });

  group('VaultService.search', () {
    test('encuentra notas por contenido', () async {
      final svc = VaultService(tmpDir.path);
      await svc.createNote(folder: '', title: 'Anatomía',
        content: 'El corazón tiene 4 cavidades.');
      await svc.createNote(folder: '', title: 'Física',
        content: 'La velocidad de la luz es constante.');
      final results = await svc.search('corazón');
      expect(results.length, 1);
      expect(results.first.title, 'Anatomía');
    });

    test('encuentra por tag', () async {
      final svc = VaultService(tmpDir.path);
      await svc.createNote(folder: '', title: 'A',
        content: 'contenido #importante aquí');
      await svc.createNote(folder: '', title: 'B',
        content: 'otro contenido');
      final results = await svc.search('importante');
      expect(results.length, 1);
      expect(results.first.title, 'A');
    });

    test('devuelve vacío si no hay matches', () async {
      final svc = VaultService(tmpDir.path);
      await svc.createNote(folder: '', title: 'X', content: 'algo');
      expect(await svc.search('nope'), isEmpty);
    });
  });

  group('VaultService.countNotes', () {
    test('cuenta solo archivos .md', () async {
      final svc = VaultService(tmpDir.path);
      await svc.createNote(folder: '', title: 'A', content: 'a');
      await svc.createNote(folder: '', title: 'B', content: 'b');
      // Crear un archivo no-md
      await File('${tmpDir.path}/other.txt').writeAsString('no');
      expect(await svc.countNotes(), 2);
    });
  });
}
