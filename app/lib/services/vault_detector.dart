// Detector de vaults M-NEXUS en el dispositivo Android.
// v0.34: rutas ampliadas y mejor manejo de MANAGE_EXTERNAL_STORAGE.
// v0.45.1: implementación real con SharedPreferences + SAF picker + filesystem scan.
//
// Rutas escaneadas (en orden):
//   1. /storage/emulated/0/Documents/* (carpetas con _M-NEXUS)
//   2. /storage/emulated/0/ (root, si MANAGE_EXTERNAL_STORAGE)
//   3. External storage (getExternalStorageDirectory())
//   4. App-specific storage (getApplicationDocumentsDirectory)
//   5. SAF (Storage Access Framework) - path persistido vía VaultSafPicker
//
// Si no se encuentran vaults automáticamente, el usuario puede:
//   - Pulsar "Elegir manualmente" para abrir SAF (call addSafPath)
//   - Conceder MANAGE_EXTERNAL_STORAGE para /sdcard completo

import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';
import 'vault_saf_picker.dart';

class VaultInfo {
  final String path;
  final String name;
  final String? installedPluginVersion;
  final String? detectionMethod;     // "auto" | "documents" | "root" | "external" | "app" | "saf"

  const VaultInfo({
    required this.path,
    required this.name,
    this.installedPluginVersion,
    this.detectionMethod,
  });
}

class VaultDetector {
  static const _kSafKey = 'saf_paths';          // JSON array of saved SAF paths
  static const _kDefaultSafKey = 'saf_default'; // default SAF path (string)

  /// Devuelve los vaults candidatos detectados en el dispositivo.
  Future<List<VaultInfo>> detectVaults() async {
    final r = await safeCallAsync<List<VaultInfo>>(
      component: 'vault',
      code: 'EC-VAULT-DETECT-001',
      message: 'detectVaults failed',
      op: () => _detectVaultsInner(),
    );
    return r.value ?? <VaultInfo>[];
  }

  Future<List<VaultInfo>> _detectVaultsInner() async {
    AdvancedLogger.instance.debug('vault_detector', 'scan start');
    final candidates = <String>[];
    final methods = <String, String>{};  // path -> method

    // 1) /storage/emulated/0/Documents (carpeta de documentos en Android)
    await _scanDir('/storage/emulated/0/Documents', candidates, methods, 'documents', maxDepth: 2);

    // 2) Root /storage/emulated/0 (requiere MANAGE_EXTERNAL_STORAGE en Android 11+)
    await _scanDir('/storage/emulated/0', candidates, methods, 'root', maxDepth: 2);

    // 3) External storage
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        await _scanDir(ext.path, candidates, methods, 'external', maxDepth: 2);
      }
    } catch (e) {
      AdvancedLogger.instance.debug('vault_detector', 'external storage unavailable', context: { 'error': e.toString() });
    }

    // 4) App-specific storage - siempre crear vault por defecto si no hay nada
    bool hasNonSaf = false;
    for (final c in candidates) {
      if (methods[c] != 'saf') { hasNonSaf = true; break; }
    }
    try {
      final app = await getApplicationDocumentsDirectory();
      await _ensureDefaultVault(app.path);
      await _scanDir(app.path, candidates, methods, 'app', maxDepth: 3);
    } catch (e) {
      AdvancedLogger.instance.debug('vault_detector', 'app docs storage unavailable', context: { 'error': e.toString() });
    }

    // 5) SAF paths persistidos (v0.45.1)
    final safPaths = await _loadSafPaths();
    for (final sp in safPaths) {
      // Para SAF, el "path" es un content URI. No podemos escanearlo desde Dart
      // (no hay filesystem), pero sí lo aceptamos como candidato si la app lo
      // configuró explícitamente. VaultService lo manejará vía content resolver.
      candidates.add(sp);
      methods[sp] = 'saf';
    }

    // Deduplicar
    final unique = <String>[];
    for (final c in candidates) {
      if (!unique.contains(c)) unique.add(c);
    }

    // Construir VaultInfo
    final result = <VaultInfo>[];
    for (final path in unique) {
      final isSaf = methods[path] == 'saf';
      final installedVersion = isSaf ? null : await _readInstalledVersion(path);
      result.add(VaultInfo(
        path: path,
        name: isSaf ? 'SAF: ${p.basename(Uri.parse(path).path)}' : p.basename(path),
        installedPluginVersion: installedVersion,
        detectionMethod: methods[path],
      ));
    }
    AdvancedLogger.instance.debug('vault_detector', 'scan done', context: { 'candidates': result.length });
    return result;
  }

  /// v0.45.1: añade un path SAF persistente al escaneo.
  /// Usado por la UI después de pickVault() para registrar la elección.
  Future<void> addSafPath(String path) async {
    final r = await safeCallAsync<void>(
      component: 'vault',
      code: 'EC-VAULT-DETECT-002',
      message: 'addSafPath failed',
      context: { 'path': path },
      op: () async {
        // Persistir en SharedPreferences nativas (vía MethodChannel) para que
        // la URI sea válida tras reinicios (con takePersistableUriPermission).
        await VaultSafPicker.setSavedPath(path);
        // Y también guardar en SharedPreferences de Dart como respaldo + lista
        // (permite múltiples SAF paths en el futuro).
        final prefs = await SharedPreferences.getInstance();
        final list = prefs.getStringList(_kSafKey) ?? <String>[];
        if (!list.contains(path)) {
          list.add(path);
          await prefs.setStringList(_kSafKey, list);
        }
        await prefs.setString(_kDefaultSafKey, path);
      },
    );
  }

  /// Quita un path SAF de la lista persistida.
  Future<void> removeSafPath(String path) async {
    await safeCallAsync<void>(
      component: 'vault',
      code: 'EC-VAULT-DETECT-003',
      message: 'removeSafPath failed',
      context: { 'path': path },
      op: () async {
        final prefs = await SharedPreferences.getInstance();
        final list = prefs.getStringList(_kSafKey) ?? <String>[];
        list.remove(path);
        await prefs.setStringList(_kSafKey, list);
        if (prefs.getString(_kDefaultSafKey) == path) {
          await prefs.remove(_kDefaultSafKey);
        }
      },
    );
  }

  /// Carga todos los paths SAF persistidos (Dart SharedPreferences).
  Future<List<String>> _loadSafPaths() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_kSafKey) ?? <String>[];
  }

  /// v0.45.1: scan recursivo que busca carpetas de vault.
  /// Heurística: una carpeta es vault si contiene un archivo `.mnexus` o si su
  /// nombre termina en `_M-NEXUS` o `M-NEXUS`. Limitado por maxDepth para no
  /// colgarse en /sdcard.
  Future<void> _scanDir(
    String path,
    List<String> candidates,
    Map<String, String> methods,
    String method, {
    int maxDepth = 2,
  }) async {
    if (maxDepth < 0) return;
    Directory? dir;
    try {
      dir = Directory(path);
      if (!await dir.exists()) return;
    } catch (_) {
      return;  // permission denied, etc.
    }
    try {
      await for (final entity in dir.list(followLinks: false)) {
        if (entity is Directory) {
          final name = p.basename(entity.path);
          // Heurística 1: nombre de carpeta indica vault
          if (_isVaultName(name)) {
            candidates.add(entity.path);
            methods[entity.path] = method;
            continue;  // no recursar dentro
          }
          // Heurística 2: archivo marcador .mnexus dentro
          try {
            final marker = File('${entity.path}/.mnexus');
            if (await marker.exists()) {
              candidates.add(entity.path);
              methods[entity.path] = method;
              continue;
            }
          } catch (_) {}
          // Recursar
          await _scanDir(entity.path, candidates, methods, method, maxDepth: maxDepth - 1);
        }
      }
    } catch (e) {
      AdvancedLogger.instance.debug('vault_detector', 'scan error', context: { 'path': path, 'error': e.toString() });
    }
  }

  bool _isVaultName(String name) {
    final n = name.toLowerCase();
    return n.endsWith('_m-nexus') ||
           n.endsWith('-m-nexus') ||
           n == 'm-nexus' ||
           n == 'mnexus' ||
           n.contains('m-nexus') && n.length < 40;
  }

  /// v0.45.1: crea un vault por defecto en <appDocs>/M-NEXUS/ si no existe
  /// ninguno. Es la red de seguridad para que el usuario siempre tenga un vault
  /// funcional desde el primer launch, sin tener que configurar nada.
  Future<void> _ensureDefaultVault(String appDocsPath) async {
    try {
      final defaultPath = '$appDocsPath/M-NEXUS';
      final dir = Directory(defaultPath);
      if (await dir.exists()) return;  // ya existe
      await dir.create(recursive: true);
      // Marker
      final marker = File('$defaultPath/.mnexus');
      await marker.writeAsString('v0.45.1
');
      // Welcome note
      final welcome = File('$defaultPath/Bienvenido.md');
      if (!await welcome.exists()) {
        await welcome.writeAsString(_welcomeContent);
      }
      AdvancedLogger.instance.info('vault_detector', 'default vault created', context: { 'path': defaultPath });
    } catch (e) {
      AdvancedLogger.instance.warn('vault_detector', 'default vault creation failed', context: { 'error': e.toString() });
    }
  }

  static const String _welcomeContent = '''# Bienvenido a M-NEXUS

Este es tu vault personal. Acá se guardan todas tus notas, flashcards y
configuraciones.

## Primeros pasos

1. Creá notas con el botón **+** en la pestaña Vault.
2. Generá flashcards desde tus notas (botón de tarjetas en la nota).
3. Configurá un calendario en **Ajustes > Calendar** para vincular eventos.
4. Configurá el backend en **Ajustes > Backend** para sync entre dispositivos.

## Más ayuda

- Documentación: https://github.com/rgdi/m-nexus
- Reportar un bug: https://github.com/rgdi/m-nexus/issues

¡Éxitos con tus estudios! 🚀
''';

  /// Lee la versión del plugin instalada leyendo `.mnexus-version` o
  /// `.obsidian/plugins/m-nexus/manifest.json` (campo version).
  Future<String?> _readInstalledVersion(String vaultPath) async {
    try {
      final f1 = File('$vaultPath/.mnexus-version');
      if (await f1.exists()) {
        final v = (await f1.readAsString()).trim();
        if (v.isNotEmpty) return v;
      }
      final manifest = File('$vaultPath/.obsidian/plugins/m-nexus/manifest.json');
      if (await manifest.exists()) {
        final content = await manifest.readAsString();
        final m = RegExp(r'"version"\s*:\s*"([^"]+)"').firstMatch(content);
        if (m != null) return m.group(1);
      }
    } catch (_) {}
    return null;
  }
}
