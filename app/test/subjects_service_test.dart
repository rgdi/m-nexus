// Tests para SubjectsService.loadAll — v0.48.7 bugfix.

import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/subjects_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmpDir;

  setUp(() async {
    tmpDir = await Directory.systemTemp.createTemp('subj-test-');
  });

  tearDown(() async {
    if (await tmpDir.exists()) await tmpDir.delete(recursive: true);
  });

  test('loadAll retorna [] si no existe subjects.json', () async {
    final svc = SubjectsService();
    final all = await svc.loadAll(tmpDir.path);
    expect(all, isEmpty);
  });

  test('loadAll parsea formato Array (legacy)', () async {
    final dir = Directory('${tmpDir.path}/_M-NEXUS');
    await dir.create(recursive: true);
    await File('${dir.path}/subjects.json').writeAsString('''[
      {"id": "anatomia", "name": "Anatomía", "color": 4294213491, "active": true, "createdAt": "2026-09-08"}
    ]''');
    final svc = SubjectsService();
    final all = await svc.loadAll(tmpDir.path);
    expect(all.length, 1);
    expect(all.first.name, 'Anatomía');
  });

  test('loadAll parsea formato {subjects: [...]} (v0.48+ bugfix)', () async {
    final dir = Directory('${tmpDir.path}/_M-NEXUS');
    await dir.create(recursive: true);
    await File('${dir.path}/subjects.json').writeAsString('''{
      "subjects": [
        {"id": "anatomia", "name": "Anatomía", "color": 4294213491, "active": true, "createdAt": "2026-09-08"},
        {"id": "bioquimica", "name": "Bioquímica", "color": 4282777462, "active": true, "createdAt": "2026-09-08"}
      ]
    }''');
    final svc = SubjectsService();
    final all = await svc.loadAll(tmpDir.path);
    expect(all.length, 2);
    expect(all.map((s) => s.name).toList(), containsAll(['Anatomía', 'Bioquímica']));
  });

  test('loadAll retorna [] si JSON inválido', () async {
    final dir = Directory('${tmpDir.path}/_M-NEXUS');
    await dir.create(recursive: true);
    await File('${dir.path}/subjects.json').writeAsString('esto no es JSON');
    final svc = SubjectsService();
    final all = await svc.loadAll(tmpDir.path);
    expect(all, isEmpty);
  });
}
