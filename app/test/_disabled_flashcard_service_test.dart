// Tests para FlashcardService.

import 'dart:io';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride, TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/flashcard_service.dart';
import 'package:mnexus_app/core/constants.dart';
import 'package:path/path.dart' as p;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  debugDefaultTargetPlatformOverride = TargetPlatform.android;

  late Directory tmpDir;

  setUp(() async {
    tmpDir = await Directory.systemTemp.createTemp('fc-svc-test-');
  });

  tearDown(() async {
    if (await tmpDir.exists()) await tmpDir.delete(recursive: true);
  });

  group('FlashcardService.create', () {
    test('crea tarjeta en Drafts con metadata', () async {
      final svc = FlashcardService(tmpDir.path);
      final card = await svc.create(
        question: '¿Cuántas cavidades?',
        answer: '4',
        difficulty: 3,
      );
      expect(card.approved, isFalse);
      expect(card.question, '¿Cuántas cavidades?');
      expect(card.answer, '4');
      expect(card.difficulty, 3);
      expect(card.path.contains(AppConstants.flashcardsDrafts), isTrue);
      expect(await File(card.path).exists(), isTrue);
    });
  });

  group('FlashcardService.listAll', () {
    test('lista Drafts y Approved', () async {
      final svc = FlashcardService(tmpDir.path);
      await svc.create(question: 'Q1', answer: 'A1');
      await svc.create(question: 'Q2', answer: 'A2');
      final approvedDir = Directory(p.join(tmpDir.path, AppConstants.flashcardsApproved));
      await approvedDir.create(recursive: true);
      await File(p.join(approvedDir.path, 'manual.md')).writeAsString('''---
id: manual-1
question: Manual
answer: answer
difficulty: 3
---

# Manual

answer
''');
      final all = await svc.listAll();
      expect(all.length, 3);
      final drafts = all.where((c) => !c.approved).length;
      final approved = all.where((c) => c.approved).length;
      expect(drafts, 2);
      expect(approved, 1);
    });

    test('devuelve lista vacía si no hay tarjetas', () async {
      final svc = FlashcardService(tmpDir.path);
      expect(await svc.listAll(), isEmpty);
    });
  });

  group('FlashcardService.dueCards', () {
    test('incluye tarjetas con nextReview en el pasado', () async {
      final svc = FlashcardService(tmpDir.path);
      // Crear tarjeta que vence hoy
      final card = await svc.create(
        question: 'Q1', answer: 'A1', difficulty: 1,
      );
      // Forzar nextReview al pasado (sobrescribimos el archivo)
      await File(card.path).writeAsString('''---
id: ${card.id}
question: Q1
answer: A1
difficulty: 1
nextReview: 2020-01-01
---

# Q1

A1
''');
      final due = await svc.dueCards();
      expect(due.length, 1);
      expect(due.first.id, card.id);
    });
  });

  group('FlashcardService.approve', () {
    test('mueve tarjeta de Drafts a Approved', () async {
      final svc = FlashcardService(tmpDir.path);
      final card = await svc.create(question: 'Q', answer: 'A');
      expect(card.approved, isFalse);
      await svc.approve(card);
      // El archivo en Drafts no debe existir
      expect(await File(card.path).exists(), isFalse);
      // Debe existir en Approved
      final newPath = p.join(tmpDir.path, AppConstants.flashcardsApproved, p.basename(card.path));
      expect(await File(newPath).exists(), isTrue);
    });
  });

  group('FlashcardService.delete', () {
    test('elimina el archivo', () async {
      final svc = FlashcardService(tmpDir.path);
      final card = await svc.create(question: 'Q', answer: 'A');
      await svc.delete(card);
      expect(await File(card.path).exists(), isFalse);
    });
  });
}
