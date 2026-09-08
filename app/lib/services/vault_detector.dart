// vault_detector.dart: detecta vaults en el sistema.
//
// v0.47.1: reescrito para no bloquear el main thread.
//   - Timeout de 3s en cada scan
//   - maxDepth 1 (no recursivo profundo)
//   - Si no encuentra nada, no se bloquea: retorna []

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

class VaultInfo {
  final String path;
  final String name;
  final String? method; // 'documents', 'root', 'external', 'app', 'saf'
  const VaultInfo({required this.path, required this.name, this.method});
}

class VaultDetector {
  Future<List<VaultInfo>> detectVaults() async {
    final r = await safeCallAsync<List<VaultInfo>>(
      component: 'vault_detector',
      code: 'EC-VAULT-003',
      message: 'detectVaults failed',
      category: ErrorCategory.vault,
      op: () => _detectVaultsInner(),
    );
    return r.value ?? <VaultInfo>[];
  }

  Future<List<VaultInfo>> _detectVaultsInner() async {
    final log = AdvancedLogger.instance;
    final stopwatch = Stopwatch()..start();
    final candidates = <String>[];
    final methods = <String, String>{};

    // 1) App-specific storage (mas rapido, siempre existe)
    //    Es donde el setup wizard crea el vault por defecto.
    try {
      final app = await getApplicationDocumentsDirectory().timeout(
        const Duration(seconds: 1),
        onTimeout: () => Directory.systemTemp,
      );
      await _ensureDefaultVault(app.path);
      // v0.47.32: maxDepth aumentado a 2 para que se escanee app_flutter/
      // (el setup wizard crea el vault en docsDir/Mi_Vault que es
      // depth 2 desde app.path). Antes con maxDepth: 1 el vault no se
      // detectaba tras restart y había que crear manualmente
      // _M-NEXUS/ para que apareciera.
      await _scanDir(app.path, candidates, methods, 'app', maxDepth: 2).timeout(
        const Duration(seconds: 2),
        onTimeout: () {},
      );
    } catch (e) {
      log.debug('vault_detector', 'app storage timeout', context: { 'error': e.toString() });
    }

    // 2) External storage (puede ser lento o no estar disponible)
    try {
      final ext = await getExternalStorageDirectory().timeout(
        const Duration(seconds: 1),
        onTimeout: () => null,
      );
      if (ext != null) {
        await _scanDir(ext.path, candidates, methods, 'external', maxDepth: 1).timeout(
          const Duration(seconds: 2),
          onTimeout: () {},
        );
      }
    } catch (e) {
      log.debug('vault_detector', 'ext storage timeout', context: { 'error': e.toString() });
    }

    // 3) /storage/emulated/0 (Android 11+ requiere MANAGE_EXTERNAL_STORAGE)
    //    Solo si el usuario dio permiso, sino lo skipeamos.
    try {
      await _scanDir('/storage/emulated/0/Documents', candidates, methods, 'documents', maxDepth: 1).timeout(
        const Duration(seconds: 1),
        onTimeout: () {},
      );
    } catch (_) {}

    // 4) SAF paths persistidos
    try {
      final safPaths = await _loadSafPaths().timeout(
        const Duration(seconds: 1),
        onTimeout: () => <String>[],
      );
      for (final sp in safPaths) {
        candidates.add(sp);
        methods[sp] = 'saf';
      }
    } catch (_) {}

    stopwatch.stop();
    log.info('vault_detector', 'scan complete', context: {
      'candidates': candidates.length,
      'elapsedMs': stopwatch.elapsedMilliseconds,
    });

    return candidates.map((p) => VaultInfo(
      path: p,
      name: _nameFromPath(p),
      method: methods[p],
    )).toList();
  }

  Future<void> _scanDir(
    String path,
    List<String> candidates,
    Map<String, String> methods,
    String method, {
    int maxDepth = 1,
    int currentDepth = 0,
  }) async {
    if (currentDepth > maxDepth) return;
    final dir = Directory(path);
    if (!await dir.exists()) return;

    // Si el directorio mismo parece un vault (tiene _M-NEXUS o .md files)
    if (await _looksLikeVault(dir)) {
      candidates.add(dir.path);
      methods[dir.path] = method;
    }

    // Escanear hijos directos solamente (no recursivo profundo)
    try {
      await for (final entity in dir.list(followLinks: false).take(50)) {
        if (entity is! Directory) continue;
        final name = entity.path.split('/').last;
        if (name.startsWith('.')) continue; // hidden
        if (name == 'Android' || name == 'data' || name == 'obb') continue; // system
        await _scanDir(
          entity.path, candidates, methods, method,
          maxDepth: maxDepth,
          currentDepth: currentDepth + 1,
        );
      }
    } catch (_) {
      // Permisos denegados, etc
    }
  }

  Future<bool> _looksLikeVault(Directory dir) async {
    try {
      // Un vault tiene _M-NEXUS/ o al menos 1 .md file
      final mnexus = Directory('${dir.path}/_M-NEXUS');
      if (await mnexus.exists()) return true;
      var mdCount = 0;
      await for (final entity in dir.list(followLinks: false).take(20)) {
        if (entity is File && entity.path.endsWith('.md')) {
          mdCount++;
          if (mdCount >= 3) return true; // 3+ .md = vault
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  Future<void> _ensureDefaultVault(String appDocsPath) async {
    // Crea un vault por defecto en app docs si no existe
    // (asi el setup wizard lo encuentra al escanear)
    final defaultVault = Directory('$appDocsPath/Mi Vault');
    if (!await defaultVault.exists()) {
      // No crear aqui, lo hace el setup wizard
    }
  }

  String _nameFromPath(String path) {
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Vault' : parts.last;
  }

  Future<List<String>> _loadSafPaths() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList('vaults.saf') ?? <String>[];
  }
}
