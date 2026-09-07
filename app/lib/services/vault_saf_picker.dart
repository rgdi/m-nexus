// Cliente Dart para el MethodChannel "com.mnexus.app/vault" de Android.
// v0.45.1: habilita selección manual de vault vía SAF picker.
//
// API expuesta:
//   - String? getSavedPath()          → path SAF persistido (SharedPreferences nativo)
//   - Future<String?> pickVault()     → abre SAF picker, retorna URI o null
//   - Future<void> setSavedPath(p)    → guarda path manualmente (uso interno)

import 'package:flutter/services.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

class VaultSafPicker {
  static const _channel = MethodChannel('com.mnexus.app/vault');

  /// Devuelve el path SAF persistido en SharedPreferences nativas (o null).
  static Future<String?> getSavedPath() async {
    final r = await safeCallOrNull<String>(
      component: 'vault',
      code: 'EC-VAULT-SAF-001',
      message: 'getSafPath failed',
      category: ErrorCategory.vault,
      context: { 'channel': 'com.mnexus.app/vault', 'method': 'getSafPath' },
      op: () => _channel.invokeMethod<String>('getSafPath'),
    );
    return r;
  }

  /// Persiste un path SAF en SharedPreferences nativas.
  /// (Normalmente se llama desde MainActivity.onActivityResult, pero expongo
  /// el método por si el caller quiere sobreescribir el path.)
  static Future<void> setSavedPath(String path) async {
    await safeCallAsync<void>(
      component: 'vault',
      code: 'EC-VAULT-SAF-002',
      message: 'setSafPath failed',
      category: ErrorCategory.vault,
      context: { 'path': path, 'channel': 'com.mnexus.app/vault' },
      op: () => _channel.invokeMethod<void>('setSafPath', { 'path': path }),
    );
  }

  /// Abre el SAF picker (ACTION_OPEN_DOCUMENT_TREE). Devuelve el URI del folder
  /// elegido (persisted) o null si el usuario canceló.
  /// El MainActivity persiste el URI en SharedPreferences antes de devolver.
  static Future<String?> pickVault() async {
    AdvancedLogger.instance.info('vault_saf', 'pickVault called');
    final r = await safeCallOrNull<String>(
      component: 'vault',
      code: 'EC-VAULT-SAF-003',
      message: 'pickVault failed',
      category: ErrorCategory.vault,
      context: { 'channel': 'com.mnexus.app/vault', 'method': 'pickVault' },
      op: () => _channel.invokeMethod<String>('pickVault'),
    );
    AdvancedLogger.instance.info('vault_saf', 'pickVault returned', context: { 'path': r });
    return r;
  }
}
