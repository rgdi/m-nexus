// sync_worker.dart — worker background que hace auto-pull periódico.
// v0.62.18: corre cada N minutos y descarga notas del servidor. Las
// notas se persisten localmente vía VaultService.writeNote.

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'sync_service.dart';
import 'vault_service.dart';
import 'settings_service.dart';
import 'logger.dart';

class SyncWorker {
  static SyncWorker? _instance;
  static SyncWorker get instance => _instance ??= SyncWorker._();
  SyncWorker._();

  Timer? _timer;
  DateTime? _lastSync;
  bool _busy = false;
  bool get isRunning => _timer != null;

  /// Inicia el auto-pull cada [interval].
  void start({
    Duration interval = const Duration(minutes: 5),
    required String vaultPath,
  }) {
    stop();
    _timer = Timer.periodic(interval, (_) => _runOnce(vaultPath));
    // Primera ejecución inmediata.
    _runOnce(vaultPath);
    log.info('sync_worker', 'started', context: {'interval': '$interval'});
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    log.info('sync_worker', 'stopped');
  }

  Future<void> _runOnce(String vaultPath) async {
    if (_busy) return;
    final base = SettingsService.instance.current.backendUrl;
    if (base == null || base.isEmpty) return;
    _busy = true;
    try {
      final svc = SyncService(vaultPath);
      final vault = VaultService(vaultPath);
      final since = _lastSync ?? DateTime(2000);
      final result = await svc.pull(since);
      for (final n in result.notes) {
        try {
          await vault.writeNote(n.path, n.content);
        } catch (e) {
          log.warn('sync_worker', 'writeNote failed', context: {
            'path': n.path, 'err': '$e',
          });
        }
      }
      _lastSync = result.serverTime;
      log.info('sync_worker', 'pulled', context: {
        'count': result.notes.length, 'since': '$since',
      });
    } catch (e) {
      log.warn('sync_worker', 'pull failed', context: {'err': '$e'});
    } finally {
      _busy = false;
    }
  }

  /// Llama pull inmediato (para botón "Sync ahora" del UI).
  Future<void> pullNow(String vaultPath) => _runOnce(vaultPath);

  DateTime? get lastSync => _lastSync;
}
