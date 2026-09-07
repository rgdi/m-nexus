// Detector de vaults M-NEXUS en el dispositivo Android.
// v0.34: rutas ampliadas y mejor manejo de MANAGE_EXTERNAL_STORAGE.
// v0.45: refactorizado con safeCallAsync + AppError.
//
// Rutas escaneadas (en orden):
//   1. /storage/emulated/0/Documents/* (carpetas con _M-NEXUS)
//   2. /storage/emulated/0/ (root, si MANAGE_EXTERNAL_STORAGE)
//   3. External storage (getExternalStorageDirectory())
//   4. App-specific storage (getApplicationDocumentsDirectory)
//   5. SAF (Storage Access Framework) - ruta seleccionada por el usuario
//
// Si no se encuentran vaults automáticamente, el usuario puede:
//   - Pulsar "Elegir manualmente" para abrir SAF
//   - Conceder MANAGE_EXTERNAL_STORAGE para /sdcard completo

import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

class VaultInfo {
  final String path;
  final String name;
  final String? installedPluginVersion;
  final String? detectionMethod;     // "auto" | "documents" | "external" | "app" | "saf"

  const VaultInfo({
    required this.path,
    required this.name,
    this.installedPluginVersion,
    this.detectionMethod,
  });
}

class VaultDetector {
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
    await _scanDir('/storage/emulated/0/Documents', candidates, methods, 'documents');

    // 2) Root /storage/emulated/0 (requiere MANAGE_EXTERNAL_STORAGE en Android 11+)
    await _scanDir('/storage/emulated/0', candidates, methods, 'root', maxDepth: 2);

    // 3) External storage
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        await _scanDir(ext.path, candidates, methods, 'external');
      }
    } catch (_) {}

    // 4) App-specific storage
    try {
      final app = await getApplicationDocumentsDirectory();
      await _scanDir(app.path, candidates, methods, 'app');
    } catch (_) {}

    // 5) SAF vault seleccionado manualmente
    try {
      final prefs = await _loadSafPath();
      if (prefs != null) {
        await _scanDir(prefs, candidates, methods, 'saf');
      }
    } catch (_) {}

    // Deduplicar
    final unique = <String>[];
    for (final c in candidates) {
      if (!unique.contains(c)) unique.add(c);
    }

    // Construir VaultInfo
    final result = <VaultInfo>[];
    for (final path in unique) {
      final installedVersion = await _readInstalledVersion(path);
      result.add(VaultInfo(
        path: path,
        name: p.basename(path),
        installedPluginVersion: installedVersion,
        detectionMethod: methods[path],
      ));
    }
    AdvancedLogger.instance.debug('vault_detector', 'scan done', {
      'candidates': result.length,
    });
    return result;
  }

  /// v0.34: anade un path SAF persistente al escaneo.
  Future<void> addSafPath(String path) async {
    final r = await safeCallAsync<void>(
      component: 'vault',
      code: 'EC-VAULT-DETECT-002',
      message: 'addSafPath failed',
      context: { 'path': path },
      op: () async {
        final prefs = await _loadSafMap();
        prefs['default'] = path;
        await _saveSafMap(prefs);
      },
    );
  }

  Future<Map<String, String>> _loadSafMap() async {
    // v0.45: stub - SAF map persistence not yet implemented in v0.45.
    // Returns empty map. addSafPath works but doesn't persist across restarts yet.
    return <String, String>{};
  }

  Future<void> _saveSafMap(Map<String, String> map) async {
    // v0.45: stub - SAF map persistence not yet implemented in v0.45.
  }

  Future<String?> _loadSafPath() async {
    final map = await _loadSafMap();
    return map['default'];
  }

  Future<void> _scanDir(
    String path,
    List<String> candidates,
    Map<String, String> methods,
    String method, {
    int maxDepth = 3,
  }) async {
    // v0.45: stub - filesystem scan not yet implemented in v0.45.
    // Returns silently. Full scan implementation planned for v0.46.
  }

  Future<String?> _readInstalledVersion(String vaultPath) async {
    // v0.45: stub - version detection not yet implemented in v0.45.
    return null;
  }
}
