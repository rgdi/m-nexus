// Tests para DailyNoteService.

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/daily_note_service.dart';
import 'package:path/path.dart' as p;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmpDir;
  late DailyNoteService svc;

  setUp(() async {
    tmpDir = await Directory.systemTemp.createTemp('daily-test-');
    svc = DailyNoteService(tmpDir.path);
  });

  tearDown(() async {
    if (await tmpDir.exists()) await tmpDir.delete(recursive: true);
  });

  test('openOrCreate crea nota del día si no existe', () async {
    final fixedDate = DateTime(2026, 9, 9);
    final path = await svc.openOrCreate(date: fixedDate);
    expect(await File(path).exists(), isTrue);
    expect(path.endsWith('2026-09-09.md'), isTrue);
  });

  test('openOrCreate retorna path existente sin duplicar', () async {
    final date = DateTime(2026, 1, 1);
    final p1 = await svc.openOrCreate(date: date);
    final p2 = await svc.openOrCreate(date: date);
    expect(p1, p2);
    // Sólo 1 archivo creado.
    final files = await Directory(p.join(tmpDir.path, 'Daily')).list().toList();
    expect(files.length, 1);
  });

  test('frontmatter tiene title, type, date, created', () async {
    final date = DateTime(2026, 3, 15);
    final path = await svc.openOrCreate(date: date);
    final content = await File(path).readAsString();
    expect(content, contains('title: 2026-03-15'));
    expect(content, contains('type: daily'));
    expect(content, contains('date: 2026-03-15'));
    expect(content, contains('created:'));
  });

  test('body tiene secciones Tareas, Notas, Ideas, Para repasar', () async {
    final path = await svc.openOrCreate(date: DateTime(2026, 1, 1));
    final content = await File(path).readAsString();
    expect(content, contains('Tareas'));
    expect(content, contains('Notas'));
    expect(content, contains('Ideas'));
    expect(content, contains('Para repasar'));
  });

  test('listAll ordena más recientes primero', () async {
    await svc.openOrCreate(date: DateTime(2026, 1, 1));
    await svc.openOrCreate(date: DateTime(2026, 6, 1));
    await svc.openOrCreate(date: DateTime(2026, 3, 15));
    final all = await svc.listAll();
    expect(all.length, 3);
    expect(all[0], endsWith('2026-06-01.md'));
    expect(all[1], endsWith('2026-03-15.md'));
    expect(all[2], endsWith('2026-01-01.md'));
  });

  test('listDates devuelve DateTimes válidos', () async {
    await svc.openOrCreate(date: DateTime(2026, 1, 1));
    await svc.openOrCreate(date: DateTime(2026, 6, 1));
    final dates = await svc.listDates();
    expect(dates.length, 2);
    expect(dates.contains(DateTime(2026, 1, 1)), isTrue);
    expect(dates.contains(DateTime(2026, 6, 1)), isTrue);
  });
}
