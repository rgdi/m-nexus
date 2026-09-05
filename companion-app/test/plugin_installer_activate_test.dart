// Tests para la activación automática del plugin (v0.36).
//
// v0.36: el PluginInstaller ahora edita .obsidian/community-plugins.json
// para que Obsidian reconozca el plugin automáticamente al próximo launch.

import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/plugin_installer.dart';

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  late Directory tmpDir;

  setUp(() async {
    tmpDir = await Directory.systemTemp.createTemp('plugin-activate-test-');
  });

  tearDown(() async {
    if (await tmpDir.exists()) {
      await tmpDir.delete(recursive: true);
    }
  });

  group('activatePluginInCommunityFile', () {
    test('crea community-plugins.json con [m-nexus] si no existe', () async {
      final installer = PluginInstaller();
      final result = await installer.activatePluginInCommunityFile(tmpDir.path);

      expect(result.ok, isTrue);
      expect(result.added, isTrue);
      expect(result.alreadyEnabled, isFalse);
      expect(result.filePath, endsWith('community-plugins.json'));

      // Verificar que el archivo se creó
      final file = File(result.filePath);
      expect(await file.exists(), isTrue);

      // Verificar contenido
      final content = await file.readAsString();
      final parsed = jsonDecode(content) as List<dynamic>;
      expect(parsed, contains('m-nexus'));
    });

    test('añade m-nexus a una lista existente', () async {
      // Crear .obsidian/community-plugins.json con otros plugins
      final obsidianDir = Directory('${tmpDir.path}/.obsidian');
      await obsidianDir.create(recursive: true);
      final file = File('${obsidianDir.path}/community-plugins.json');
      await file.writeAsString(jsonEncode(['other-plugin', 'calendar']));

      final installer = PluginInstaller();
      final result = await installer.activatePluginInCommunityFile(tmpDir.path);

      expect(result.ok, isTrue);
      expect(result.added, isTrue);
      expect(result.alreadyEnabled, isFalse);

      // Verificar
      final content = await file.readAsString();
      final parsed = jsonDecode(content) as List<dynamic>;
      expect(parsed, containsAll(['other-plugin', 'calendar', 'm-nexus']));
    });

    test('detecta que m-nexus ya está habilitado', () async {
      // Crear con m-nexus ya
      final obsidianDir = Directory('${tmpDir.path}/.obsidian');
      await obsidianDir.create(recursive: true);
      final file = File('${obsidianDir.path}/community-plugins.json');
      await file.writeAsString(jsonEncode(['m-nexus']));

      final installer = PluginInstaller();
      final result = await installer.activatePluginInCommunityFile(tmpDir.path);

      expect(result.ok, isTrue);
      expect(result.added, isFalse);
      expect(result.alreadyEnabled, isTrue);
    });

    test('hace backup si el JSON está corrupto', () async {
      final obsidianDir = Directory('${tmpDir.path}/.obsidian');
      await obsidianDir.create(recursive: true);
      final file = File('${obsidianDir.path}/community-plugins.json');
      await file.writeAsString('{ this is not valid json [');

      final installer = PluginInstaller();
      final result = await installer.activatePluginInCommunityFile(tmpDir.path);

      expect(result.ok, isTrue);
      expect(result.added, isTrue);

      // Verificar que hay un backup .bak
      final dir = Directory('${obsidianDir.path}');
      final entries = await dir.list().toList();
      final hasBackup = entries.any((e) => e.path.contains('.bak.'));
      expect(hasBackup, isTrue);
    });

    test('maneja archivo vacío', () async {
      final obsidianDir = Directory('${tmpDir.path}/.obsidian');
      await obsidianDir.create(recursive: true);
      final file = File('${obsidianDir.path}/community-plugins.json');
      await file.writeAsString('');

      final installer = PluginInstaller();
      final result = await installer.activatePluginInCommunityFile(tmpDir.path);

      expect(result.ok, isTrue);
      expect(result.added, isTrue);

      final content = await file.readAsString();
      final parsed = jsonDecode(content) as List<dynamic>;
      expect(parsed, contains('m-nexus'));
    });

    test('preserva el orden al añadir (al final)', () async {
      final obsidianDir = Directory('${tmpDir.path}/.obsidian');
      await obsidianDir.create(recursive: true);
      final file = File('${obsidianDir.path}/community-plugins.json');
      await file.writeAsString(jsonEncode(['dataview', 'templater']));

      final installer = PluginInstaller();
      await installer.activatePluginInCommunityFile(tmpDir.path);

      final content = await file.readAsString();
      final parsed = jsonDecode(content) as List<dynamic>;
      // m-nexus debe estar al final
      expect(parsed.last, 'm-nexus');
      expect(parsed, ['dataview', 'templater', 'm-nexus']);
    });

    test('el JSON escrito es válido y pretty-printed', () async {
      final installer = PluginInstaller();
      await installer.activatePluginInCommunityFile(tmpDir.path);

      final file = File('${tmpDir.path}/.obsidian/community-plugins.json');
      final content = await file.readAsString();
      // Verificar pretty-print (debe tener saltos de línea)
      expect(content, contains('\n'));
      // Verificar que se puede parsear
      final parsed = jsonDecode(content);
      expect(parsed, isA<List>());
    });
  });
}
